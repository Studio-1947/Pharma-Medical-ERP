import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PwaRegister } from "@/components/shared/pwa-register";

/**
 * Minimal stand-ins for the bits of the ServiceWorker API the component drives.
 * Only `state`, `postMessage` and the two event targets matter here.
 */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = "installed";
  postMessage = vi.fn();

  /** Mimics the browser moving the worker through its lifecycle. */
  setState(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  registration = new FakeRegistration();
  register = vi.fn().mockImplementation(async () => this.registration);

  /** The worker takes control of the page, as `clients.claim()` does. */
  claim(worker: FakeWorker) {
    this.controller = worker;
    this.dispatchEvent(new Event("controllerchange"));
  }
}

let container: FakeContainer;
let reload: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

/** Applying an update navigates; a chunk-error self-heal reloads in place. */
const wentToNewBuild = () =>
  assign.mock.calls.length === 1 && assign.mock.calls[0]?.[0] === "/login";

beforeEach(() => {
  vi.useFakeTimers();
  container = new FakeContainer();
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
    writable: true,
  });

  reload = vi.fn();
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload, assign },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Renders and lets the async `register()` promise chain settle. */
async function mount() {
  render(<PwaRegister />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Drives a new build from `installing` through to a parked `waiting` worker. */
async function deployNewBuild() {
  const next = new FakeWorker();
  next.state = "installing";
  container.registration.installing = next;
  container.registration.dispatchEvent(new Event("updatefound"));
  await act(async () => {
    next.setState("installed");
  });
  container.registration.waiting = next;
  return next;
}

describe("PwaRegister update handover", () => {
  it("does not reload when the first worker claims a page that loaded uncontrolled", async () => {
    await mount();

    await act(async () => {
      container.claim(new FakeWorker());
    });

    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends the tab to the entry screen on Update after a late claim", async () => {
    // Regression: `hadController` used to be snapshotted at mount. A tab that
    // loaded before any worker existed kept that snapshot at false for its whole
    // life, so the handover after Update was ignored and the button span for
    // ever instead of reloading.
    await mount();

    await act(async () => {
      container.claim(new FakeWorker());
    });

    const next = await deployNewBuild();
    expect(screen.getByText("A new version is ready")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Update" }).click();
    });

    expect(next.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(assign).not.toHaveBeenCalled();

    await act(async () => {
      container.claim(next);
    });

    expect(wentToNewBuild()).toBe(true);
  });

  it("navigates once even when several handover signals arrive", async () => {
    await mount();
    await act(async () => {
      container.claim(new FakeWorker());
    });
    const next = await deployNewBuild();

    await act(async () => {
      screen.getByRole("button", { name: "Update" }).click();
    });

    await act(async () => {
      next.setState("activated");
      container.claim(next);
      container.dispatchEvent(
        Object.assign(new Event("message"), { data: { type: "SW_ACTIVATED" } }),
      );
      vi.advanceTimersByTime(10_000);
    });

    expect(assign).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves for the new build anyway if the worker never hands over", async () => {
    await mount();
    await act(async () => {
      container.claim(new FakeWorker());
    });
    await deployNewBuild();

    await act(async () => {
      screen.getByRole("button", { name: "Update" }).click();
    });
    expect(assign).not.toHaveBeenCalled();

    // The worker swallowed SKIP_WAITING; the failsafe still gets the user onto
    // the new build rather than leaving the button spinning.
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });

    expect(wentToNewBuild()).toBe(true);
  });

  it("leaves immediately when the waiting worker is already gone", async () => {
    await mount();
    await act(async () => {
      container.claim(new FakeWorker());
    });
    const next = await deployNewBuild();

    // Another tab applied the update while this prompt sat on screen.
    next.state = "redundant";

    await act(async () => {
      screen.getByRole("button", { name: "Update" }).click();
    });

    expect(next.postMessage).not.toHaveBeenCalled();
    expect(wentToNewBuild()).toBe(true);
  });
});

/**
 * A backgrounded tab applies a pending update on its own, which is how a
 * counter terminal that stays open for days ever picks up a deploy. That same
 * reload throws away anything held only in component state, so the idle path
 * has to be able to tell "nobody is doing anything" from "a half-built bill is
 * sitting on screen".
 */
describe("PwaRegister idle auto-apply", () => {
  /** Hides the tab and lets the idle timer run out. */
  async function goIdle() {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
  }

  /** Puts a node on the page for one assertion and takes it away again. */
  function withNode(html: string) {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return () => host.remove();
  }

  async function armedTab() {
    await mount();
    await act(async () => {
      container.claim(new FakeWorker());
    });
    return deployNewBuild();
  }

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("applies the pending update on an idle tab with nothing in flight", async () => {
    const next = await armedTab();

    await goIdle();

    expect(next.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("holds off while a screen declares unsaved work", async () => {
    const next = await armedTab();
    const cleanup = withNode('<div data-pharmerp-unsaved="otc-counter-sale"></div>');

    await goIdle();

    expect(next.postMessage).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    cleanup();
  });

  it("holds off while a dialog is open", async () => {
    const next = await armedTab();
    const cleanup = withNode('<div role="dialog"><p>Goods Received Note</p></div>');

    await goIdle();

    expect(next.postMessage).not.toHaveBeenCalled();
    cleanup();
  });

  it("holds off while a field holds text the user has not submitted", async () => {
    const next = await armedTab();
    const cleanup = withNode('<input type="text" value="BATCH-4471" />');

    await goIdle();

    expect(next.postMessage).not.toHaveBeenCalled();
    cleanup();
  });

  it("still applies when the only populated field is a search box", async () => {
    // Otherwise a search term left in the box would pin a terminal to an old
    // build indefinitely, which is the failure this whole path exists to avoid.
    const next = await armedTab();
    const cleanup = withNode('<input type="search" value="parace" />');

    await goIdle();

    expect(next.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    cleanup();
  });

  it("ignores empty and disabled fields", async () => {
    const next = await armedTab();
    const cleanup = withNode(
      '<input type="text" value="   " /><input type="text" value="x" disabled />' +
        '<textarea></textarea><select><option selected>box</option></select>',
    );

    await goIdle();

    expect(next.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    cleanup();
  });
});

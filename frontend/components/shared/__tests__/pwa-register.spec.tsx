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

beforeEach(() => {
  vi.useFakeTimers();
  container = new FakeContainer();
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
    writable: true,
  });

  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
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
  });

  it("reloads on Update in a tab that was claimed after it loaded", async () => {
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
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      container.claim(next);
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once even when several handover signals arrive", async () => {
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

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads anyway if the worker never hands over", async () => {
    await mount();
    await act(async () => {
      container.claim(new FakeWorker());
    });
    await deployNewBuild();

    await act(async () => {
      screen.getByRole("button", { name: "Update" }).click();
    });
    expect(reload).not.toHaveBeenCalled();

    // The worker swallowed SKIP_WAITING; the failsafe still gets the user onto
    // the new build rather than leaving the button spinning.
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads immediately when the waiting worker is already gone", async () => {
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
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import axios from "axios";

/**
 * Refresh tokens are single-use: the server rotates the presented token away
 * and issues a new one, so presenting the same token twice looks like a
 * replay. A page load used to do exactly that — the session bootstrap
 * refreshed on mount while the shell's first request 401'd on the stale
 * access token and refreshed too — and the loser was answered by revoking the
 * whole family, which signed the operator out after every deploy.
 *
 * What is guarded here is that one page load presents a refresh token once,
 * however many callers want a new access token at the same moment.
 */

async function loadModule() {
  vi.resetModules();
  return await import("@/lib/api-client");
}

const unauthorized = () =>
  Object.assign(new Error("Unauthorized"), {
    isAxiosError: true,
    response: { status: 401, data: {} },
  });

const serverError = () =>
  Object.assign(new Error("Bad Gateway"), {
    isAxiosError: true,
    response: { status: 502, data: {} },
  });

const networkError = () =>
  Object.assign(new Error("Network Error"), {
    isAxiosError: true,
    response: undefined,
  });

let location: { href: string; pathname: string };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("pharmerp_access_token", "stale-access");
  localStorage.setItem("pharmerp_refresh_token", "R1");

  location = { href: "", pathname: "/dashboard" };
  Object.defineProperty(window, "location", {
    value: location,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fails every first attempt with a 401 and serves the retry.
 *  The rejection carries `config`, as a real axios error does — the
 *  interceptor reads `_retry` off it. */
function adapterThatNeedsRefresh() {
  return (config: any) => {
    if (!config._retry) return Promise.reject(Object.assign(unauthorized(), { config }));
    return Promise.resolve({
      data: { ok: true },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    });
  };
}

function mockRefreshOk() {
  return vi
    .spyOn(axios, "post")
    .mockResolvedValue({ data: { accessToken: "A2", refreshToken: "R2" } } as any);
}

describe("token refresh is made once per page load", () => {
  it("collapses two concurrent 401s onto a single refresh request", async () => {
    const post = mockRefreshOk();
    const { apiClient } = await loadModule();
    apiClient.defaults.adapter = adapterThatNeedsRefresh();

    await Promise.all([
      apiClient.get("/settings"),
      apiClient.get("/inventory/medicines"),
    ]);

    // Two refreshes would mean the second presents an already-rotated R1.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]).toEqual({ refreshToken: "R1" });
  });

  it("makes the session bootstrap and a 401 share one in-flight refresh", async () => {
    // Held open so the two genuinely overlap, the way a real round trip does.
    let release: (v: any) => void = () => {};
    const post = vi.spyOn(axios, "post").mockReturnValue(
      new Promise((r) => {
        release = r;
      }) as any,
    );
    const { apiClient, bootstrapSession } = await loadModule();
    apiClient.defaults.adapter = adapterThatNeedsRefresh();

    // The real pairing: SessionBootstrap runs on mount while the shell layout
    // fires its first request with the expired access token.
    const boot = bootstrapSession();
    const call = apiClient.get("/settings");
    // A macrotask, so every microtask in between has run: the adapter has
    // rejected with its 401 and the interceptor has already asked for a
    // refresh. Releasing earlier would settle the first request before the
    // second one ever got the chance to join it.
    await new Promise((r) => setTimeout(r, 0));

    release({ data: { accessToken: "A2", refreshToken: "R2" } });
    expect(await boot).toBe("ok");
    await call;

    // Two requests here would mean the second presents an already-rotated R1,
    // which the server reads as a replay.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("never presents the same refresh token twice, even across separate refreshes", async () => {
    // The invariant that actually matters. Deduping covers the overlapping
    // case; when a refresh has already finished, the next one must pick up the
    // token it wrote rather than the one it rotated away.
    let n = 1;
    const post = vi.spyOn(axios, "post").mockImplementation(async () => {
      n += 1;
      return { data: { accessToken: `A${n}`, refreshToken: `R${n}` } } as any;
    });
    const { bootstrapSession } = await loadModule();

    await bootstrapSession();
    await bootstrapSession();
    await bootstrapSession();

    const presented = post.mock.calls.map((c: any) => c[1].refreshToken);
    expect(presented).toEqual(["R1", "R2", "R3"]);
    expect(new Set(presented).size).toBe(presented.length);
  });

  it("retries the original request with the new token, not the stale one", async () => {
    mockRefreshOk();
    const { apiClient } = await loadModule();

    const sent: string[] = [];
    apiClient.defaults.adapter = (config: any) => {
      sent.push(config.headers["Authorization"]);
      if (!config._retry) return Promise.reject(Object.assign(unauthorized(), { config }));
      return Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
    };

    await apiClient.get("/settings");

    expect(sent[0]).toBe("Bearer stale-access");
    expect(sent[1]).toBe("Bearer A2");
  });

  it("persists the rotated pair everywhere the app reads tokens from", async () => {
    localStorage.setItem(
      "pharmerp-auth",
      JSON.stringify({ state: { accessToken: "stale-access", refreshToken: "R1" } }),
    );
    mockRefreshOk();
    const { bootstrapSession } = await loadModule();

    await bootstrapSession();

    expect(localStorage.getItem("pharmerp_access_token")).toBe("A2");
    expect(localStorage.getItem("pharmerp_refresh_token")).toBe("R2");
    // The Zustand store must not keep serving the token that was just rotated
    // away, or the next reload presents a dead one.
    const store = JSON.parse(localStorage.getItem("pharmerp-auth")!);
    expect(store.state.accessToken).toBe("A2");
    expect(store.state.refreshToken).toBe("R2");
  });

  it("starts a fresh request once the previous refresh has settled", async () => {
    const post = mockRefreshOk();
    const { bootstrapSession } = await loadModule();

    await bootstrapSession();
    await bootstrapSession();

    // Deduping must not latch: a later refresh is a separate need, not a
    // repeat of the one that already finished.
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("a rejected refresh is told apart from an unreachable one", () => {
  it("holds the session when the API is restarting", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(serverError());
    const { bootstrapSession } = await loadModule();

    // A deploy must not sign every open counter out mid-shift.
    expect(await bootstrapSession()).toBe("unreachable");
    expect(localStorage.getItem("pharmerp_refresh_token")).toBe("R1");
  });

  it("holds the session when nothing answered at all", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(networkError());
    const { bootstrapSession } = await loadModule();

    expect(await bootstrapSession()).toBe("unreachable");
  });

  it("ends the session when the server rejects the token", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(unauthorized());
    const { bootstrapSession } = await loadModule();

    expect(await bootstrapSession()).toBe("unauthorized");
  });

  it("ends the session on a 2xx that carried no token, instead of retrying it", async () => {
    // Not a transport failure, so the bootstrap's backoff loop would spin on
    // it for ever if this were reported as unreachable.
    vi.spyOn(axios, "post").mockResolvedValue({ data: {} } as any);
    const { bootstrapSession } = await loadModule();

    expect(await bootstrapSession()).toBe("unauthorized");
  });

  it("reports unauthorized when there is no refresh token to present", async () => {
    localStorage.removeItem("pharmerp_refresh_token");
    const post = vi.spyOn(axios, "post");
    const { bootstrapSession } = await loadModule();

    expect(await bootstrapSession()).toBe("unauthorized");
    expect(post).not.toHaveBeenCalled();
  });

  it("clears the session and leaves the page when a 401 cannot be refreshed", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(unauthorized());
    const { apiClient } = await loadModule();
    apiClient.defaults.adapter = adapterThatNeedsRefresh();

    await apiClient.get("/settings").catch(() => {});

    expect(localStorage.getItem("pharmerp_access_token")).toBeNull();
    expect(location.href).toBe("/login");
  });
});

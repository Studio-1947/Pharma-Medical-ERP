import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import axios from "axios";

/**
 * The interceptor under test is installed as a module side effect, so the
 * module is imported fresh per test after the environment is staged.
 */
async function loadClient() {
  vi.resetModules();
  return (await import("@/lib/api-client")).apiClient;
}

/** A transport failure: no response ever came back. */
const networkError = () =>
  Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined });

let location: { href: string; pathname: string };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("pharmerp_access_token", "access-token");
  localStorage.setItem("pharmerp_refresh_token", "refresh-token");

  location = { href: "", pathname: "/billing" };
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

/** Runs one request that fails at the transport layer. */
async function failingRequest(client: Awaited<ReturnType<typeof loadClient>>) {
  client.defaults.adapter = () => Promise.reject(networkError());
  await client.get("/inventory/medicines/otc-supplies").catch(() => {});
  // The reachability check is deliberately not awaited by the interceptor.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("api client: API unreachable", () => {
  it("ends the session when /health confirms the API is down", async () => {
    const probe = vi.spyOn(axios, "get").mockRejectedValue(networkError());
    const client = await loadClient();

    await failingRequest(client);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(String(probe.mock.calls[0]?.[0])).toMatch(/\/health$/);
    expect(location.href).toBe("/login");
    expect(localStorage.getItem("pharmerp_access_token")).toBeNull();
  });

  it("keeps the session when /health still answers", async () => {
    // One request failed, but the API is up -- signing the counter out here
    // would be the mid-shift logout this check exists to avoid.
    vi.spyOn(axios, "get").mockResolvedValue({ status: 200, data: {} });
    const client = await loadClient();

    await failingRequest(client);

    expect(location.href).toBe("");
    expect(localStorage.getItem("pharmerp_access_token")).toBe("access-token");
  });

  it("leaves an offline device alone so it can keep billing into the queue", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const probe = vi.spyOn(axios, "get").mockRejectedValue(networkError());
    const client = await loadClient();

    await failingRequest(client);

    expect(probe).not.toHaveBeenCalled();
    expect(location.href).toBe("");
  });

  it("does not bounce a page that is already on login", async () => {
    location.pathname = "/login";
    const probe = vi.spyOn(axios, "get").mockRejectedValue(networkError());
    const client = await loadClient();

    await failingRequest(client);

    expect(probe).not.toHaveBeenCalled();
    expect(location.href).toBe("");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * What happens to the page when the session bootstrap is rejected.
 *
 * Clearing the store is not enough to leave a protected route. Middleware only
 * runs on a navigation, and the dashboard renders its skeleton whenever the
 * store has no role — so it never mounts, never fires a request, and the 401
 * that would have redirected never happens. The result was an operator left
 * watching an empty skeleton indefinitely, which is what a rejected refresh
 * after a deploy looked like on screen.
 */

const bootstrapSession = vi.fn();
vi.mock("@/lib/api-client", () => ({
  bootstrapSession: () => bootstrapSession(),
  apiClient: { get: vi.fn(), post: vi.fn() },
  queryKeys: {},
}));

const logout = vi.fn();
let authState: { isAuthenticated: boolean } = { isAuthenticated: true };
vi.mock("@/stores/auth.store", () => ({
  useAuthStore: () => ({ ...authState, logout }),
}));

let pathname = "/dashboard";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

vi.mock("@/components/ui/toast", () => ({
  ToastProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/components/shared/navigation-progress", () => ({
  NavigationProgress: () => null,
}));
vi.mock("@/lib/navigation-context", () => ({
  NavigationProvider: ({ children }: any) => <>{children}</>,
}));

import { Providers } from "../providers";

let location: { href: string };

beforeEach(() => {
  bootstrapSession.mockReset();
  logout.mockReset();
  push.mockReset();
  pathname = "/dashboard";
  authState = { isAuthenticated: true };

  location = { href: "" };
  Object.defineProperty(window, "location", {
    value: location,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session bootstrap: a rejected refresh must not strand the page", () => {
  it("leaves the protected route when the session is rejected", async () => {
    bootstrapSession.mockResolvedValue("unauthorized");

    render(<Providers><div>app</div></Providers>);

    await waitFor(() => expect(logout).toHaveBeenCalled());
    // The whole bug: without this the operator sat on /dashboard watching a
    // skeleton, because nothing else on the page re-checks auth.
    await waitFor(() => expect(location.href).toBe("/login?from=%2Fdashboard"));
  });

  it("carries the route it came from, so the operator lands back where they were", async () => {
    pathname = "/billing/pos";
    bootstrapSession.mockResolvedValue("unauthorized");

    render(<Providers><div>app</div></Providers>);

    await waitFor(() =>
      expect(location.href).toBe("/login?from=%2Fbilling%2Fpos"),
    );
  });

  it("does not bounce a page that is already on login", async () => {
    pathname = "/login";
    bootstrapSession.mockResolvedValue("unauthorized");

    render(<Providers><div>app</div></Providers>);

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(location.href).toBe("");
  });

  it("holds the session and retries while the API is restarting", async () => {
    bootstrapSession.mockResolvedValue("unreachable");

    render(<Providers><div>app</div></Providers>);

    await waitFor(() => expect(bootstrapSession).toHaveBeenCalled());
    // A deploy must not sign a counter out mid-shift, so neither the store nor
    // the location may be touched here.
    expect(logout).not.toHaveBeenCalled();
    expect(location.href).toBe("");
  });

  it("stays put on a healthy session", async () => {
    bootstrapSession.mockResolvedValue("ok");

    render(<Providers><div>app</div></Providers>);

    await waitFor(() => expect(bootstrapSession).toHaveBeenCalled());
    expect(logout).not.toHaveBeenCalled();
    expect(location.href).toBe("");
  });

  it("never refreshes for a visitor who was not signed in", async () => {
    authState = { isAuthenticated: false };

    render(<Providers><div>app</div></Providers>);

    await waitFor(() => expect(bootstrapSession).not.toHaveBeenCalled());
  });
});

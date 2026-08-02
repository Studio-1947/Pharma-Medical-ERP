"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/shared/sidebar";
import { Header } from "@/components/shared/header";
import { usePermissions } from "@/hooks/use-permissions";
import { permissionForPath } from "@/lib/nav-items";
import { useNavigation } from "@/lib/navigation-context";
import { ShieldOff } from "lucide-react";

/**
 * Blocks a route the current role has no permission for.
 *
 * Hiding the sidebar link was never a control — typing the URL loaded the page
 * regardless, so a cashier could open the Doctor Panel and a doctor the
 * settings screen. The API is the real boundary and rejects those calls, but
 * rendering a screen full of failing requests reads as a broken app rather than
 * a closed door.
 */
function AccessDenied() {
  const { navigate } = useNavigation();

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <ShieldOff className="w-6 h-6 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold">You do not have access to this page</h1>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Your role does not include this module. Contact an administrator if you
        believe this is a mistake.
      </p>
      <button
        onClick={() => navigate("/dashboard")}
        className="mt-5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Back to dashboard
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const { can, role } = usePermissions();

  // Close the drawer whenever navigation commits
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const required = permissionForPath(pathname);
  // `role` is empty until the auth store rehydrates from localStorage. Denying
  // during that window would flash AccessDenied on every hard reload, so an
  // unresolved role falls through to the page, which the API still guards.
  const allowed = !required || !role || can(required);

  return (
    <div className="flex h-dvh overflow-hidden relative">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">
          {allowed ? children : <AccessDenied />}
        </main>
      </div>
    </div>
  );
}

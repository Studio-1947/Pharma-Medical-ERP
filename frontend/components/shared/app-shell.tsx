"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/shared/sidebar";
import { Header } from "@/components/shared/header";
import { usePermissions } from "@/hooks/use-permissions";
import { permissionForPath } from "@/lib/nav-items";
import { useNavigation } from "@/lib/navigation-context";
import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { ShieldOff, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Blocks a route the current role has no permission for.
 */
function AccessDenied() {
  const { navigate } = useNavigation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center mb-5 text-rose-600 shadow-sm">
        <ShieldOff className="w-8 h-8" />
      </div>
      <h1 className="text-xl font-bold text-slate-900 tracking-tight">Access Restricted</h1>
      <p className="text-sm font-medium text-slate-500 mt-2 max-w-md leading-relaxed">
        Your role does not have permission to view this module. Please contact an administrator if you need access.
      </p>
      <Button
        variant="primary"
        size="md"
        className="mt-6"
        leftIcon={<ArrowLeft size={16} />}
        onClick={() => navigate("/dashboard")}
      >
        Return to Dashboard
      </Button>
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
  const allowed = !required || !role || can(required);

  return (
    <div className="flex h-dvh overflow-hidden relative bg-slate-100">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <ImpersonationBanner />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-slate-50 via-slate-100/60 to-emerald-50/20">
          <div className="max-w-7xl mx-auto space-y-6">
            {allowed ? children : <AccessDenied />}
          </div>
        </main>
      </div>
    </div>
  );
}


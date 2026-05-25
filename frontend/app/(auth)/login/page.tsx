import { LoginForm } from "@/components/modules/auth/login-form";
import { Suspense } from "react";
import Image from "next/image";
import { ShieldCheck, Package, Receipt, BarChart3 } from "lucide-react";

const features = [
  {
    icon: Package,
    title: "Smart Inventory",
    desc: "FEFO batch tracking with expiry alerts and auto-reorder",
  },
  {
    icon: Receipt,
    title: "Fast POS Billing",
    desc: "Barcode scanning, GST calculation, split payments",
  },
  {
    icon: ShieldCheck,
    title: "Schedule H Compliance",
    desc: "Prescription verification and controlled drug registry",
  },
  {
    icon: BarChart3,
    title: "Actionable Reports",
    desc: "Sales trends, stock valuation, GSTR-1 export",
  },
];

export default function LoginPage() {
  return (
    <div className="min-h-screen flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[42%] bg-gradient-to-br from-emerald-800 via-teal-800 to-cyan-900 flex-col justify-between p-12 text-white relative overflow-hidden select-none">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-white/5" />
        <div className="absolute top-1/2 right-0 w-64 h-64 rounded-full bg-teal-600/20 -translate-y-1/2 translate-x-1/2" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <Image src="/logo.svg" alt="Radha Madhav Medical Hall" width={40} height={40} className="rounded-xl" priority />
            <span className="text-2xl font-bold tracking-tight">Radha Madhav Medical Hall</span>
          </div>
          <p className="text-emerald-200 text-sm">
            Pharmacy Management System
          </p>
        </div>

        <div className="relative space-y-5">
          <p className="text-3xl font-semibold leading-snug text-white/90">
            Run your pharmacy<br />
            with precision and<br />
            confidence.
          </p>
          <div className="space-y-4 pt-2">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} className="text-emerald-200" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="text-xs text-emerald-200/80 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <p className="text-xs text-emerald-300/60">
            Trusted by pharmacy chains across India
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 dark:bg-background">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <Image src="/logo.svg" alt="Radha Madhav Medical Hall" width={32} height={32} className="rounded-lg" priority />
            <span className="text-xl font-bold text-emerald-800 dark:text-emerald-400">
              Radha Madhav Medical Hall
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">
              Welcome back
            </h1>
            <p className="text-gray-500 dark:text-muted-foreground mt-1 text-sm">
              Sign in to access your pharmacy dashboard
            </p>
          </div>

          <Suspense fallback={<div className="animate-pulse h-64 bg-muted rounded-xl" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

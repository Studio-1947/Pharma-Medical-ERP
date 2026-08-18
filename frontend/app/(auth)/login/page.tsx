import { LoginForm } from "@/components/modules/auth/login-form";
import { Suspense } from "react";
import Image from "next/image";
import { ShieldCheck, Package, Receipt, BarChart3, Activity, Building2 } from "lucide-react";

const features = [
  {
    icon: Package,
    title: "Smart Inventory & FEFO",
    desc: "Batch tracking with expiry alerts and automated reordering",
  },
  {
    icon: Receipt,
    title: "Fast POS Billing & GST",
    desc: "Barcode scanning, split payments, and instant receipt print",
  },
  {
    icon: ShieldCheck,
    title: "Schedule H Compliance",
    desc: "Prescription verification and controlled drug registry",
  },
  {
    icon: BarChart3,
    title: "Analytics & GSTR-1",
    desc: "Sales trends, stock valuation, and tax filing exports",
  },
];

export default function LoginPage() {
  return (
    <div className="min-h-screen flex bg-slate-950 font-sans selection:bg-emerald-500 selection:text-white">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[48%] bg-gradient-to-b from-slate-950 via-slate-900 to-emerald-950 flex-col justify-between p-12 lg:p-16 text-white relative overflow-hidden select-none border-r border-slate-800/60">
        {/* Animated ambient glow spheres */}
        <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-[30rem] h-[30rem] rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full bg-teal-500/10 blur-2xl pointer-events-none" />

        {/* Brand header */}
        <div className="relative z-10">
          <div className="flex items-center gap-3.5 mb-3">
            <Image
              src="/logo.svg"
              alt="Radha Madhav Medical Hall"
              width={44}
              height={44}
              className="rounded-2xl ring-2 ring-emerald-500/40 shadow-glow"
              priority
            />
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-white leading-tight">
                Radha Madhav Medical Hall
              </h1>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                Enterprise Pharmacy Management ERP
              </p>
            </div>
          </div>
        </div>

        {/* Center showcase */}
        <div className="relative z-10 space-y-6 my-auto py-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-wider">
            <Activity className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
            Healthcare Technology Standard
          </div>
          <h2 className="text-3xl lg:text-4xl font-black leading-tight tracking-tight text-white">
            Precision control for your pharmacy & medical chain.
          </h2>
          <p className="text-sm font-medium text-slate-400 leading-relaxed max-w-md">
            Complete billing, inventory, compliance, and multi-branch management in one unified cloud system.
          </p>

          <div className="grid grid-cols-2 gap-3.5 pt-2">
            {features.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 hover:border-emerald-500/30 hover:bg-white/10 transition-all duration-200 group"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-2.5 group-hover:scale-110 transition-transform">
                  <Icon size={18} />
                </div>
                <p className="text-xs font-bold text-white tracking-wide">{title}</p>
                <p className="text-[11px] font-medium text-slate-400 mt-1 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer status */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-5">
          <span className="flex items-center gap-2 font-medium">
            <Building2 size={14} className="text-emerald-400" />
            Multi-Branch Enterprise Sync
          </span>
          <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-glow" />
            System Live
          </span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-gradient-to-br from-slate-50 via-slate-100/70 to-emerald-50/20 relative">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />

        <div className="w-full max-w-md relative z-10">
          {/* Glass Card */}
          <div className="glass-panel bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-glass-lg rounded-3xl p-8 sm:p-10 animate-in fade-in zoom-in-95 duration-300">
            {/* Logo header */}
            <div className="flex flex-col items-center text-center mb-8">
              {/* The brand panel beside this card is hidden below lg, so on
                  phones this is the only branding on the screen. It carries the
                  full lockup there and falls back to the mark alone on desktop,
                  where the panel already states the name. */}
              <Image
                src="/logo-full.svg"
                alt="Radha Madhav Medical Hall"
                width={129}
                height={68}
                className="lg:hidden h-16 w-auto max-w-[80%] mb-5"
                priority
              />
              <div className="hidden lg:flex w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-0.5 shadow-md shadow-emerald-600/20 mb-4 items-center justify-center">
                <Image
                  src="/logo.svg"
                  alt="Radha Madhav Medical Hall"
                  width={48}
                  height={48}
                  className="rounded-xl"
                  priority
                />
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                Welcome Back
              </h1>
              <p className="text-xs font-semibold text-slate-500 mt-1">
                Sign in to your Pharmacy ERP control portal
              </p>
            </div>

            <Suspense fallback={<div className="animate-pulse h-64 bg-slate-100 rounded-2xl" />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}


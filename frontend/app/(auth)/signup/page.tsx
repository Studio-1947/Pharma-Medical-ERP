import { SignupForm } from "@/components/modules/auth/signup-form";
import { Users, Clock, Globe, Lock } from "lucide-react";
import Image from "next/image";

const highlights = [
  {
    icon: Users,
    title: "Role-based access",
    desc: "Pharmacists, cashiers, and managers each see only what they need",
  },
  {
    icon: Clock,
    title: "Shift management",
    desc: "Attendance tracking and performance reports per staff member",
  },
  {
    icon: Globe,
    title: "Multi-branch ready",
    desc: "Manage multiple pharmacy locations from a single dashboard",
  },
  {
    icon: Lock,
    title: "Audit trail",
    desc: "Every action is logged — full accountability and compliance",
  },
];

export default function SignupPage() {
  return (
    <div className="min-h-screen flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[42%] bg-gradient-to-br from-violet-800 via-purple-800 to-indigo-900 flex-col justify-between p-12 text-white relative overflow-hidden select-none">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-white/5" />
        <div className="absolute top-1/2 right-0 w-64 h-64 rounded-full bg-violet-600/20 -translate-y-1/2 translate-x-1/2" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <Image src="/logo.svg" alt="Radha Madhav Medical Hall" width={40} height={40} className="rounded-xl" priority />
            <span className="text-2xl font-bold tracking-tight">Radha Madhav Medical Hall</span>
          </div>
          <p className="text-violet-200 text-sm">
            Pharmacy Management System
          </p>
        </div>

        <div className="relative space-y-5">
          <p className="text-3xl font-semibold leading-snug text-white/90">
            Join your team<br />
            and get started<br />
            in minutes.
          </p>
          <div className="space-y-4 pt-2">
            {highlights.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} className="text-violet-200" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="text-xs text-violet-200/80 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <p className="text-xs text-violet-300/60">
            Secure, HIPAA-aligned pharmacy operations
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 dark:bg-background overflow-y-auto">
        <div className="w-full max-w-sm py-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <Image src="/logo.svg" alt="Radha Madhav Medical Hall" width={32} height={32} className="rounded-lg" priority />
            <span className="text-xl font-bold text-violet-800 dark:text-violet-400">
              Radha Madhav Medical Hall
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">
              Create your account
            </h1>
            <p className="text-gray-500 dark:text-muted-foreground mt-1 text-sm">
              Fill in your details to request access
            </p>
          </div>

          <SignupForm />
        </div>
      </div>
    </div>
  );
}

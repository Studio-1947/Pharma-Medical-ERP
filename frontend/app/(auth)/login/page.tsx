import { LoginForm } from "@/components/modules/auth/login-form";
import { Suspense } from "react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-full max-w-md p-8 bg-card rounded-xl shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary">PharmERP</h1>
          <p className="text-muted-foreground mt-1">Sign in to your account</p>
        </div>
        <Suspense fallback={<div className="animate-pulse h-64 bg-muted rounded-lg" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

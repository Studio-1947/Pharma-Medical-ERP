import { SignupForm } from "@/components/modules/auth/signup-form";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-full max-w-md p-8 bg-card rounded-xl shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary">PharmERP</h1>
          <p className="text-muted-foreground mt-1">Create your account</p>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}

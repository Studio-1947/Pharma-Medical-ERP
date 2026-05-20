import { Skeleton } from "@/components/ui/skeleton";

export default function PatientsLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 flex gap-4">
          {["28%", "18%", "14%", "10%", "14%", "10%"].map((w, i) => (
            <Skeleton key={i} className="h-4 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-b flex gap-4 items-center">
            <div className="flex items-center gap-3" style={{ width: "28%" }}>
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-3 w-3/4 rounded" />
              </div>
            </div>
            <Skeleton className="h-4 rounded" style={{ width: "18%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "14%" }} />
            <Skeleton className="h-5 w-12 rounded-full" style={{ width: "10%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "14%" }} />
            <Skeleton className="h-7 w-16 rounded-md ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

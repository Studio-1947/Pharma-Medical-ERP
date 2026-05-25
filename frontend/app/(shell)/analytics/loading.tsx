import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="space-y-1">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-60" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-5 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-52 w-full rounded-lg" />
          </div>
        ))}
      </div>

      {/* Bottom table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 flex gap-4">
          {["30%", "15%", "15%", "15%", "10%"].map((w, i) => (
            <Skeleton key={i} className="h-4 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-5 py-3 border-b last:border-0 flex gap-4 items-center">
            <Skeleton className="h-4 rounded" style={{ width: "30%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-5 w-12 rounded-full ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Report type tabs */}
      <div className="flex border-b gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-t-lg" />
        ))}
      </div>

      {/* Date range filters */}
      <div className="flex gap-3 flex-wrap">
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg ml-auto" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 flex gap-4">
          {["20%", "15%", "15%", "15%", "15%", "10%"].map((w, i) => (
            <Skeleton key={i} className="h-4 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-b last:border-0 flex gap-4 items-center">
            <Skeleton className="h-4 rounded" style={{ width: "20%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "10%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

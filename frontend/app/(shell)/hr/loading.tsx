import { Skeleton } from "@/components/ui/skeleton";

export default function HrLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Tab bar */}
      <div className="flex border-b gap-1">
        <Skeleton className="h-9 w-28 rounded-t-lg" />
        <Skeleton className="h-9 w-28 rounded-t-lg" />
        <Skeleton className="h-9 w-24 rounded-t-lg" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 flex gap-4">
          {["30%", "18%", "15%", "15%", "12%"].map((w, i) => (
            <Skeleton key={i} className="h-4 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-b last:border-0 flex gap-4 items-center">
            <div className="flex items-center gap-3" style={{ width: "30%" }}>
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <Skeleton className="h-4 flex-1 rounded" />
            </div>
            <Skeleton className="h-4 rounded" style={{ width: "18%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-5 w-16 rounded-full" style={{ width: "15%" }} />
            <Skeleton className="h-7 w-16 rounded-md ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

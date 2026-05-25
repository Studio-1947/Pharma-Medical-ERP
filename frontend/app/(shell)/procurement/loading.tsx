import { Skeleton } from "@/components/ui/skeleton";

export default function ProcurementLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {/* Tab bar */}
      <div className="flex border-b gap-1">
        <Skeleton className="h-9 w-28 rounded-t-lg" />
        <Skeleton className="h-9 w-36 rounded-t-lg" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-9 w-64 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 flex gap-4">
          {["28%", "18%", "15%", "12%", "12%"].map((w, i) => (
            <Skeleton key={i} className="h-4 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-b last:border-0 flex gap-4 items-center">
            <Skeleton className="h-4 rounded" style={{ width: "28%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "18%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "12%" }} />
            <Skeleton className="h-5 w-16 rounded-full ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

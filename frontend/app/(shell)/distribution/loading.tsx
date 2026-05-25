import { Skeleton } from "@/components/ui/skeleton";

export default function DistributionLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 flex gap-4">
          {["20%", "15%", "15%", "15%", "12%", "12%"].map((w, i) => (
            <Skeleton key={i} className="h-4 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-b last:border-0 flex gap-4 items-center">
            <Skeleton className="h-4 rounded" style={{ width: "20%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-4 rounded" style={{ width: "15%" }} />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-md ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

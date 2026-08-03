import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="space-y-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Tab bar */}
      <div className="flex border-b gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-t-lg" />
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white divide-y">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4" style={{ width: "26%" }} />
            <Skeleton className="h-4" style={{ width: "16%" }} />
            <Skeleton className="h-4" style={{ width: "18%" }} />
            <Skeleton className="h-4" style={{ width: "12%" }} />
            <Skeleton className="h-4" style={{ width: "20%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

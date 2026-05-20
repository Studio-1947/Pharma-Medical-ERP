import { Skeleton } from "@/components/ui/skeleton";

export default function PosLoading() {
  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)] animate-in fade-in duration-300">
      {/* Left panel */}
      <div className="flex-1 flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex-1 rounded-xl border bg-white p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-b">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Right cart panel */}
      <div className="w-96 flex flex-col border rounded-xl bg-white">
        <div className="px-4 py-3.5 border-b flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-5 w-12 rounded-full ml-auto" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 pb-4 border-b">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-4" />
              </div>
              <Skeleton className="h-3 w-24" />
              <div className="flex items-center justify-between mt-1">
                <Skeleton className="h-7 w-20 rounded-md" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t p-4 space-y-2">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="flex justify-between pt-1 border-t">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>
        <div className="px-4 pb-4 flex gap-2">
          <Skeleton className="flex-1 h-10 rounded-lg" />
          <Skeleton className="flex-1 h-10 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

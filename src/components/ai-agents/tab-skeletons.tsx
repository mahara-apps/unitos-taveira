import { Skeleton } from "@/components/ui/skeleton";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-neutral-950/60 p-5">{children}</div>;
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-neutral-950/60 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Shell>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-16 rounded-md" />
            ))}
          </div>
        </Shell>
        <Shell>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </Shell>
      </div>
    </div>
  );
}

export function StrategySkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Shell>
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-1.5 h-4 w-full" />
            </div>
          ))}
        </div>
      </Shell>
      <Shell>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-4 w-3/4" />
        <div className="mt-4 flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-14 rounded-md" />
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <Skeleton className="h-3 w-24" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-12 rounded-md" />
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="h-3 w-24" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-12 rounded-md" />
              ))}
            </div>
          </div>
        </div>
      </Shell>
    </div>
  );
}

export function TargetSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Shell key={i}>
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-3/4" />
              <div className="mt-3 flex flex-wrap gap-1">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-5 w-14 rounded-md" />
                ))}
              </div>
            </Shell>
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="h-4 w-48" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Shell key={i}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-2/3" />
            </Shell>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MarketSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-neutral-950/60 p-5">
            <Skeleton className="h-4 w-28" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-3 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Shell>
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Shell>
    </div>
  );
}

export function TopicsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-950/60 p-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <Skeleton className="mt-2 h-4 w-2/3" />
            <Skeleton className="mt-1.5 h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      ))}
    </div>
  );
}

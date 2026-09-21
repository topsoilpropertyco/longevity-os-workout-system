/**
 * Skeletons reserve the EXACT final height of what they replace — zero layout
 * shift is a requirement, not a nicety (PRD §9).
 */
export function Skeleton({ h, w = '100%', r = 12, className = '' }: { h: number | string; w?: number | string; r?: number; className?: string }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ height: typeof h === 'number' ? `${h}px` : h, width: typeof w === 'number' ? `${w}px` : w, borderRadius: r }}
      aria-hidden="true"
    />
  );
}

/** Today card placeholder — same 312px body the real card occupies. */
export function TodayCardSkeleton() {
  return (
    <div className="card p-5" style={{ minHeight: 312 }}>
      <div className="flex items-center gap-4">
        <Skeleton h={96} w={96} r={999} />
        <div className="flex-1 space-y-2">
          <Skeleton h={14} w="45%" />
          <Skeleton h={26} w="85%" />
          <Skeleton h={14} w="70%" />
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <Skeleton h={16} w="92%" />
        <Skeleton h={16} w="64%" />
      </div>
      <div className="mt-6">
        <Skeleton h={56} r={999} />
      </div>
    </div>
  );
}

export function TileSkeleton() {
  return (
    <div className="card p-4" style={{ minHeight: 116 }}>
      <Skeleton h={11} w="60%" />
      <div className="mt-3">
        <Skeleton h={28} w="50%" />
      </div>
      <div className="mt-3">
        <Skeleton h={22} w="100%" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 3, rowHeight = 72 }: { rows?: number; rowHeight?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={rowHeight} r={18} />
      ))}
    </div>
  );
}

export default Skeleton;

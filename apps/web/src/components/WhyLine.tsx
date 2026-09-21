/**
 * Normalize for comparison: the engine composes the why line FROM the reasons,
 * so a reason is very often already inside it word for word. Printing both is
 * how the recovery card ended up saying "HRV is 17.1% below your 28-day
 * baseline" twice, once in white and once in grey directly beneath it.
 */
function said(haystack: string, needle: string): boolean {
  const norm = (t: string) =>
    t.toLowerCase().replace(/[.,—·]/g, '').replace(/\s+/g, ' ').trim();
  const h = norm(haystack);
  const n = norm(needle);
  if (!n) return true;
  if (h.includes(n)) return true;
  // Also catch the case where the why kept only the tail of a longer reason.
  return n.length > 30 && h.includes(n.slice(-30));
}

/** The one line Seth reads before deciding to show up. Never more than two. */
export default function WhyLine({
  children,
  reasons,
  tone = 'default',
}: {
  children: React.ReactNode;
  reasons?: string[];
  tone?: 'default' | 'quiet';
}) {
  const whyText = typeof children === 'string' ? children : '';
  const extra = (reasons ?? []).filter((r) => !said(whyText, r));

  return (
    <div className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="mt-[0.45rem] h-[3px] w-5 shrink-0 rounded-full"
        style={{ background: tone === 'quiet' ? 'var(--line)' : 'var(--accent)' }}
      />
      <div>
        <p
          className="text-[0.9375rem] leading-snug"
          style={{ color: tone === 'quiet' ? 'var(--ink-2)' : 'var(--ink)' }}
        >
          {children}
        </p>
        {extra.length > 0 && (
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
            {extra.join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}

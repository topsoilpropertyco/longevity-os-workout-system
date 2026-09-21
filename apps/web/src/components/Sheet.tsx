'use client';

import { useEffect, useRef } from 'react';

/**
 * Bottom sheet. Thumb-reachable, safe-area aware, dismissible by backdrop,
 * Escape, or the grabber. No library — a dialog element and 40 lines.
 */
export default function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxHeight = '82%',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  maxHeight?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title ?? 'Sheet'}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-fade-in absolute inset-0 h-full w-full"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      />
      <div
        ref={ref}
        className="animate-sheet-in absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[1.75rem] border-t shadow-sheet"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--line)',
          maxHeight,
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)',
        }}
      >
        <div className="flex justify-center pt-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="tap flex items-center justify-center"
          >
            <span className="block h-1.5 w-11 rounded-full" style={{ background: 'var(--line)' }} />
          </button>
        </div>
        {(title || subtitle) && (
          <header className="px-5 pb-3 pt-1">
            {title && <h2 className="text-xl">{title}</h2>}
            {subtitle && (
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
                {subtitle}
              </p>
            )}
          </header>
        )}
        <div className="sheet-scroll overflow-y-auto px-5 pb-2">
          {children}
        </div>
      </div>
    </div>
  );
}

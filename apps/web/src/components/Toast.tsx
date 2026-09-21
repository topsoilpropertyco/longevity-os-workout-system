'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastTone = 'neutral' | 'good' | 'warn' | 'bad';
type ToastItem = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed left-0 right-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 0.75rem)' }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="animate-rise-in max-w-sm rounded-full border px-4 py-2 text-sm font-semibold shadow-card"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--line)',
              color:
                t.tone === 'good'
                  ? 'var(--good)'
                  : t.tone === 'warn'
                    ? 'var(--warn)'
                    : t.tone === 'bad'
                      ? 'var(--bad)'
                      : 'var(--ink)',
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

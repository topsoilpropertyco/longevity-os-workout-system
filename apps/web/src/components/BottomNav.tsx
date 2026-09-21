'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string; icon: React.ReactNode };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const items: Item[] = [
  {
    href: '/',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px]">
        <circle cx="12" cy="12" r="8.2" {...stroke} />
        <path d="M12 7.4V12l3 1.8" {...stroke} />
      </svg>
    ),
  },
  {
    href: '/week',
    label: 'Week',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px]">
        <rect x="3.5" y="5.5" width="17" height="14" rx="3.2" {...stroke} />
        <path d="M3.5 10h17M8.5 3.8v3.4M15.5 3.8v3.4" {...stroke} />
      </svg>
    ),
  },
  {
    href: '/dashboard',
    label: 'Stats',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px]">
        <path d="M4 19V9.5M10 19V5M16 19v-6M20.5 19H3.5" {...stroke} />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Setup',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px]">
        <path d="M5 7.5h14M5 12h14M5 16.5h14" {...stroke} />
        <circle cx="9" cy="7.5" r="2" {...stroke} />
        <circle cx="15" cy="16.5" r="2" {...stroke} />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname() || '/';
  // The session runtime owns the whole screen; its own bar replaces the nav.
  // Sign-in hides it too: every destination behind it is locked, so a row of
  // taps that all bounce back here is worse than no bar at all.
  if (
    pathname.startsWith('/session/') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/sign-in')
  ) {
    return null;
  }

  return (
    <nav className="app-nav" aria-label="Primary">
      <ul className="mx-auto flex max-w-xl items-stretch justify-between px-3">
        {items.map((it) => {
          const active = it.href === '/' ? pathname === '/' : pathname.startsWith(it.href);
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className="flex h-[4.25rem] min-w-tap flex-col items-center justify-center gap-1 transition-colors"
                style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
              >
                <span
                  className="flex h-8 w-14 items-center justify-center rounded-full transition-colors"
                  style={{ background: active ? 'var(--accent-soft)' : 'transparent' }}
                >
                  {it.icon}
                </span>
                <span className="text-[0.6875rem] font-semibold tracking-wide">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import 'server-only';

import { cookies } from 'next/headers';
import type { SelfReport, Slider1to5 } from './engine-bridge';
import { HOME_LOCATION } from './fixtures/demo';

/**
 * Sticky, zero-friction preferences. They live in cookies so the today card is
 * correct on the very first paint with no round-trip and no database — and they
 * are mirrored into Supabase by the server actions when it is configured.
 */
export const PREF_COOKIE = {
  budget: 'lo_budget',
  location: 'lo_location',
  self: 'lo_self',
  theme: 'lo_theme',
  onboarded: 'lo_onboarded',
} as const;

export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type DayPrefs = {
  budgetMin: number;
  locationId: string;
  selfReport?: SelfReport;
  onboarded: boolean;
};

function clampSlider(n: number): Slider1to5 {
  return Math.min(5, Math.max(1, Math.round(n))) as Slider1to5;
}

export async function readPrefs(today: string): Promise<DayPrefs> {
  const store = await cookies();
  const budget = Number(store.get(PREF_COOKIE.budget)?.value ?? '45');
  const locationId = store.get(PREF_COOKIE.location)?.value ?? HOME_LOCATION.id;
  const onboarded = store.get(PREF_COOKIE.onboarded)?.value === '1';

  let selfReport: SelfReport | undefined;
  const raw = store.get(PREF_COOKIE.self)?.value;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SelfReport>;
      if (parsed.date === today && parsed.soreness && parsed.energy && parsed.stress) {
        selfReport = {
          date: today,
          soreness: clampSlider(parsed.soreness),
          energy: clampSlider(parsed.energy),
          stress: clampSlider(parsed.stress),
        };
      }
    } catch {
      // A malformed cookie is the same as no cookie.
    }
  }

  return {
    budgetMin: Number.isFinite(budget) && budget > 0 ? budget : 45,
    locationId,
    onboarded,
    ...(selfReport ? { selfReport } : {}),
  };
}

/**
 * Re-export of the Supabase-row → engine-`Program` mappers.
 *
 * They live in `@longevity/db` because that is the seam they belong to, and
 * because keeping them there lets the round-trip check in
 * `scripts/check-program-roundtrip.ts` exercise them against a real database
 * without importing anything from this app. This file exists so screens and
 * `plan-input.ts` go on importing from `@/lib/*` like everything else.
 */
export { toProgram, toProgramProgress, toPhases, toDays } from '@longevity/db';
export type { ProgramRowish, ProgramStepRowish, ProgramProgressRowish } from '@longevity/db';

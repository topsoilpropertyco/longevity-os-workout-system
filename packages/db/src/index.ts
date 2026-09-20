/**
 * @longevity/db — the Supabase schema contract for the Longevity OS.
 *
 * This package is TYPES ONLY. It deliberately carries no runtime dependency on
 * @supabase/supabase-js: the web app and the Mac mini worker each create their
 * own client and parameterise it with `Database` from here, so there is exactly
 * one description of the schema and no second copy of the SDK.
 *
 *   import { createClient } from "@supabase/supabase-js";
 *   import type { Database, Tables } from "@longevity/db";
 *
 *   const supabase = createClient<Database>(url, key);
 *   const { data } = await supabase.from("sessions").select("*");
 *   //    data: Tables<"sessions">[] | null
 *
 * Regenerate `src/types.ts` with the command in its header once the Supabase
 * project is linked. Until then the hand-written file is the contract.
 */

export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  TableName,
  UserRow,
  LocationRow,
  LocationEquipmentRow,
  EquipmentCatalogRow,
  ExerciseRow,
  ExerciseMediaRow,
  PlanRow,
  PlanDayRow,
  PlanBlockRow,
  SessionRow,
  SessionExerciseRow,
  SetRow,
  CardioLogRow,
  StravaActivityRow,
  OuraDailyRow,
  SelfReportRow,
  BodyMetricRow,
  InjuryRow,
  InjuryCheckinRow,
  ProgramRow,
  ProgramStepRow,
  ProgramProgressRow,
  GoalSettingsRow,
  LlmJobRow,
  BotMessageRow,
  ImportRow,
  IntegrationTokenRow,
  LocationPresetRow,
  CronRunRow,
} from "./types";

/**
 * The four location presets seeded by 0004_seed_presets.sql. Pass one to the
 * `apply_location_preset` RPC. Seth clones `planet_fitness_standard` per club.
 */
export const LOCATION_PRESETS = [
  "home",
  "planet_fitness_standard",
  "crossfit_box_typical",
  "bodyweight_only",
] as const;
export type LocationPresetSlug = (typeof LOCATION_PRESETS)[number];

/**
 * A job left `queued` past this many seconds is taken over by the Vercel
 * Gemini fallback (CLAUDE.md invariant 3). Mirrors the `deadline_at` default
 * in 0001_init.sql — change both together.
 */
export const LLM_JOB_DEADLINE_S = 60;

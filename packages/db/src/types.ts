/**
 * @longevity/db — the Supabase Database contract
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ REGENERATE, once the project is linked:                                   │
 * │                                                                           │
 * │   npx supabase gen types typescript --local > packages/db/src/types.ts    │
 * │                                                                           │
 * │ (or `--project-id <ref>` against the hosted project.) Until then THIS     │
 * │ HAND-WRITTEN FILE IS THE CONTRACT. It was written directly against        │
 * │ supabase/migrations/0001…0011 and matches them column for column,         │
 * │ including nullability and which columns have defaults. If you change a    │
 * │ migration, change this file in the same commit.                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Conventions carried over from packages/engine/src/types.ts, which is the
 * source of truth for the domain vocabulary:
 *   · load_lb    — TOTAL load in POUNDS. Dumbbell pairs sum both hands.
 *   · distance_mi — MILES. Never km.
 *   · `date` columns are ISO `YYYY-MM-DD` strings in the athlete's timezone;
 *     `*_at` columns are ISO 8601 UTC instants. Postgres hands both to the JS
 *     client as strings, so that is how they are typed here.
 *   · `numeric` arrives as a JS number through PostgREST. Values in this schema
 *     are small enough (7,2 / 8,3 / 12,2) that precision is not a concern.
 *   · Shared reference tables (equipment_catalog, exercises, exercise_media,
 *     programs, program_steps, location_presets, location_preset_equipment)
 *     have a NULLABLE user_id: null = global row, non-null = Seth's own.
 *
 * Usage:
 *   import type { Database, Tables, TablesInsert, Enums } from "@longevity/db";
 *   const supabase = createClient<Database>(url, key);
 *   type Session = Tables<"sessions">;
 *   type NewSet  = TablesInsert<"sets">;
 *   type Region  = Enums<"region">;
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      body_metrics: {
        Row: {
          id: string
          user_id: string
          date: string
          weight_lb: number
          body_fat_pct: number | null
          lean_mass_lb: number | null
          source: string
          photo_url: string | null
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          weight_lb: number
          body_fat_pct?: number | null
          lean_mass_lb?: number | null
          source?: string
          photo_url?: string | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          weight_lb?: number
          body_fat_pct?: number | null
          lean_mass_lb?: number | null
          source?: string
          photo_url?: string | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "body_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      bot_messages: {
        Row: {
          id: string
          user_id: string
          direction: string
          channel: string
          kind: string
          chat_id: string | null
          telegram_message_id: number | null
          body: string | null
          payload: Json
          media_url: string | null
          session_id: string | null
          llm_job_id: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          direction: string
          channel?: string
          kind?: string
          chat_id?: string | null
          telegram_message_id?: number | null
          body?: string | null
          payload?: Json
          media_url?: string | null
          session_id?: string | null
          llm_job_id?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          direction?: string
          channel?: string
          kind?: string
          chat_id?: string | null
          telegram_message_id?: number | null
          body?: string | null
          payload?: Json
          media_url?: string | null
          session_id?: string | null
          llm_job_id?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_messages_llm_job_id_fkey"
            columns: ["llm_job_id"]
            isOneToOne: false
            referencedRelation: "llm_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      cardio_logs: {
        Row: {
          id: string
          user_id: string
          session_id: string | null
          date: string
          modality: Database["public"]["Enums"]["cardio_modality"]
          structure: string | null
          duration_min: number | null
          distance_mi: number | null
          avg_hr: number | null
          max_hr: number | null
          zone_minutes: Json
          rpe: number | null
          source: string
          strava_activity_id: string | null
          prescribed: Json | null
          compliance: number | null
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_id?: string | null
          date: string
          modality: Database["public"]["Enums"]["cardio_modality"]
          structure?: string | null
          duration_min?: number | null
          distance_mi?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          zone_minutes?: Json
          rpe?: number | null
          source?: string
          strava_activity_id?: string | null
          prescribed?: Json | null
          compliance?: number | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string | null
          date?: string
          modality?: Database["public"]["Enums"]["cardio_modality"]
          structure?: string | null
          duration_min?: number | null
          distance_mi?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          zone_minutes?: Json
          rpe?: number | null
          source?: string
          strava_activity_id?: string | null
          prescribed?: Json | null
          compliance?: number | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cardio_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cardio_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      cron_runs: {
        Row: {
          id: number
          job_name: string
          ran_at: string
          status: string
          detail: Json
          user_id: string | null
        }
        Insert: {
          id?: number
          job_name: string
          ran_at?: string
          status?: string
          detail?: Json
          user_id?: string | null
        }
        Update: {
          id?: number
          job_name?: string
          ran_at?: string
          status?: string
          detail?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cron_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      equipment_catalog: {
        Row: {
          id: string
          user_id: string | null
          slug: Database["public"]["Enums"]["equipment_slug"]
          display_name: string
          category: string
          notes: string | null
          image_url: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          slug: Database["public"]["Enums"]["equipment_slug"]
          display_name: string
          category: string
          notes?: string | null
          image_url?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          slug?: Database["public"]["Enums"]["equipment_slug"]
          display_name?: string
          category?: string
          notes?: string | null
          image_url?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_catalog_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      exercise_media: {
        Row: {
          id: string
          user_id: string | null
          exercise_id: string
          gif_url: string | null
          thumb_url: string | null
          image_urls: string[]
          attribution: string | null
          source: Database["public"]["Enums"]["media_source"]
          width_px: number | null
          height_px: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          exercise_id: string
          gif_url?: string | null
          thumb_url?: string | null
          image_urls?: string[]
          attribution?: string | null
          source?: Database["public"]["Enums"]["media_source"]
          width_px?: number | null
          height_px?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          exercise_id?: string
          gif_url?: string | null
          thumb_url?: string | null
          image_urls?: string[]
          attribution?: string | null
          source?: Database["public"]["Enums"]["media_source"]
          width_px?: number | null
          height_px?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_media_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_media_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      exercises: {
        Row: {
          id: string
          user_id: string | null
          slug: string
          name: string
          aliases: string[]
          pattern: Database["public"]["Enums"]["movement_pattern"]
          force: Database["public"]["Enums"]["force_kind"]
          mechanic: Database["public"]["Enums"]["mechanic_kind"]
          level: Database["public"]["Enums"]["level_kind"]
          equipment: Database["public"]["Enums"]["equipment_slug"][]
          region_loads: Json
          load_style: Database["public"]["Enums"]["load_style"]
          barbell_free: boolean
          eccentric_dominant: boolean
          plyo_contacts_per_rep: number
          kot_step: string | null
          cue: string | null
          instructions: string[]
          preferred_alternatives: string[]
          contraindicated_with: string[]
          rehab_for: Database["public"]["Enums"]["region"][]
          source: Database["public"]["Enums"]["media_source"]
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          slug: string
          name: string
          aliases?: string[]
          pattern: Database["public"]["Enums"]["movement_pattern"]
          force?: Database["public"]["Enums"]["force_kind"]
          mechanic?: Database["public"]["Enums"]["mechanic_kind"]
          level?: Database["public"]["Enums"]["level_kind"]
          equipment?: Database["public"]["Enums"]["equipment_slug"][]
          region_loads?: Json
          load_style?: Database["public"]["Enums"]["load_style"]
          barbell_free?: boolean
          eccentric_dominant?: boolean
          plyo_contacts_per_rep?: number
          kot_step?: string | null
          cue?: string | null
          instructions?: string[]
          preferred_alternatives?: string[]
          contraindicated_with?: string[]
          rehab_for?: Database["public"]["Enums"]["region"][]
          source?: Database["public"]["Enums"]["media_source"]
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          slug?: string
          name?: string
          aliases?: string[]
          pattern?: Database["public"]["Enums"]["movement_pattern"]
          force?: Database["public"]["Enums"]["force_kind"]
          mechanic?: Database["public"]["Enums"]["mechanic_kind"]
          level?: Database["public"]["Enums"]["level_kind"]
          equipment?: Database["public"]["Enums"]["equipment_slug"][]
          region_loads?: Json
          load_style?: Database["public"]["Enums"]["load_style"]
          barbell_free?: boolean
          eccentric_dominant?: boolean
          plyo_contacts_per_rep?: number
          kot_step?: string | null
          cue?: string | null
          instructions?: string[]
          preferred_alternatives?: string[]
          contraindicated_with?: string[]
          rehab_for?: Database["public"]["Enums"]["region"][]
          source?: Database["public"]["Enums"]["media_source"]
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercises_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      goal_settings: {
        Row: {
          id: string
          user_id: string
          mode: Database["public"]["Enums"]["goal_mode"]
          vertical_jump_focus: boolean
          warmup_min: number
          cooldown_min: number
          warmup_outside_budget: boolean
          default_budget_min: number
          default_location_id: string | null
          active_program_id: string | null
          weekly_template: Json
          bot_brief_hour_local: number
          bot_brief_minute_local: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          mode?: Database["public"]["Enums"]["goal_mode"]
          vertical_jump_focus?: boolean
          warmup_min?: number
          cooldown_min?: number
          warmup_outside_budget?: boolean
          default_budget_min?: number
          default_location_id?: string | null
          active_program_id?: string | null
          weekly_template?: Json
          bot_brief_hour_local?: number
          bot_brief_minute_local?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          mode?: Database["public"]["Enums"]["goal_mode"]
          vertical_jump_focus?: boolean
          warmup_min?: number
          cooldown_min?: number
          warmup_outside_budget?: boolean
          default_budget_min?: number
          default_location_id?: string | null
          active_program_id?: string | null
          weekly_template?: Json
          bot_brief_hour_local?: number
          bot_brief_minute_local?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_settings_active_program_id_fkey"
            columns: ["active_program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_settings_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      imports: {
        Row: {
          id: string
          user_id: string
          source: string
          filename: string | null
          storage_path: string | null
          status: string
          mapping: Json
          row_count: number | null
          matched_count: number | null
          unmatched: Json
          error: string | null
          applied_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source?: string
          filename?: string | null
          storage_path?: string | null
          status?: string
          mapping?: Json
          row_count?: number | null
          matched_count?: number | null
          unmatched?: Json
          error?: string | null
          applied_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          source?: string
          filename?: string | null
          storage_path?: string | null
          status?: string
          mapping?: Json
          row_count?: number | null
          matched_count?: number | null
          unmatched?: Json
          error?: string | null
          applied_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      injuries: {
        Row: {
          id: string
          user_id: string
          region: Database["public"]["Enums"]["region"]
          label: string
          onset: string | null
          kind: string
          current_pain: number
          aggravators: string[]
          notes: string | null
          resolved_on: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          region: Database["public"]["Enums"]["region"]
          label: string
          onset?: string | null
          kind?: string
          current_pain?: number
          aggravators?: string[]
          notes?: string | null
          resolved_on?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          region?: Database["public"]["Enums"]["region"]
          label?: string
          onset?: string | null
          kind?: string
          current_pain?: number
          aggravators?: string[]
          notes?: string | null
          resolved_on?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "injuries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      injury_checkins: {
        Row: {
          id: string
          user_id: string
          injury_id: string
          date: string
          pain: number
          note: string | null
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          injury_id: string
          date: string
          pain: number
          note?: string | null
          source?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          injury_id?: string
          date?: string
          pain?: number
          note?: string | null
          source?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "injury_checkins_injury_id_fkey"
            columns: ["injury_id"]
            isOneToOne: false
            referencedRelation: "injuries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "injury_checkins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      integration_tokens: {
        Row: {
          id: string
          user_id: string
          provider: string
          access_token: string | null
          refresh_token: string | null
          expires_at: string | null
          scope: string | null
          external_account_id: string | null
          meta: Json
          last_sync_at: string | null
          last_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          access_token?: string | null
          refresh_token?: string | null
          expires_at?: string | null
          scope?: string | null
          external_account_id?: string | null
          meta?: Json
          last_sync_at?: string | null
          last_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          access_token?: string | null
          refresh_token?: string | null
          expires_at?: string | null
          scope?: string | null
          external_account_id?: string | null
          meta?: Json
          last_sync_at?: string | null
          last_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      worker_heartbeat: {
        Row: {
          worker_id: string
          last_seen: string
          detail: Json
          created_at: string
        }
        Insert: {
          worker_id: string
          last_seen?: string
          detail?: Json
          created_at?: string
        }
        Update: {
          worker_id?: string
          last_seen?: string
          detail?: Json
          created_at?: string
        }
        Relationships: []
      }
      llm_jobs: {
        Row: {
          id: string
          user_id: string
          kind: string
          payload: Json
          result: Json | null
          status: Database["public"]["Enums"]["llm_job_status"]
          claimed_by: string | null
          claimed_at: string | null
          deadline_at: string
          attempts: number
          max_attempts: number
          error: string | null
          priority: number
          created_at: string
          updated_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          kind: string
          payload?: Json
          result?: Json | null
          status?: Database["public"]["Enums"]["llm_job_status"]
          claimed_by?: string | null
          claimed_at?: string | null
          deadline_at?: string
          attempts?: number
          max_attempts?: number
          error?: string | null
          priority?: number
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          status?: Database["public"]["Enums"]["llm_job_status"]
          claimed_by?: string | null
          claimed_at?: string | null
          deadline_at?: string
          attempts?: number
          max_attempts?: number
          error?: string | null
          priority?: number
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      location_equipment: {
        Row: {
          id: string
          user_id: string
          location_id: string
          equipment: Database["public"]["Enums"]["equipment_slug"]
          available: boolean
          min_lb: number | null
          max_lb: number | null
          increment_lb: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          location_id: string
          equipment: Database["public"]["Enums"]["equipment_slug"]
          available?: boolean
          min_lb?: number | null
          max_lb?: number | null
          increment_lb?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          location_id?: string
          equipment?: Database["public"]["Enums"]["equipment_slug"]
          available?: boolean
          min_lb?: number | null
          max_lb?: number | null
          increment_lb?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_equipment_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_equipment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      location_preset_equipment: {
        Row: {
          id: string
          user_id: string | null
          preset_id: string
          equipment: Database["public"]["Enums"]["equipment_slug"]
          available: boolean
          min_lb: number | null
          max_lb: number | null
          increment_lb: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          preset_id: string
          equipment: Database["public"]["Enums"]["equipment_slug"]
          available?: boolean
          min_lb?: number | null
          max_lb?: number | null
          increment_lb?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          preset_id?: string
          equipment?: Database["public"]["Enums"]["equipment_slug"]
          available?: boolean
          min_lb?: number | null
          max_lb?: number | null
          increment_lb?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_preset_equipment_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "location_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_preset_equipment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      location_presets: {
        Row: {
          id: string
          user_id: string | null
          slug: string
          name: string
          kind: Database["public"]["Enums"]["location_kind"]
          bar_weight_lb: number
          smith_bar_weight_lb: number
          overhead_min: number
          description: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          slug: string
          name: string
          kind?: Database["public"]["Enums"]["location_kind"]
          bar_weight_lb?: number
          smith_bar_weight_lb?: number
          overhead_min?: number
          description?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          slug?: string
          name?: string
          kind?: Database["public"]["Enums"]["location_kind"]
          bar_weight_lb?: number
          smith_bar_weight_lb?: number
          overhead_min?: number
          description?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_presets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      locations: {
        Row: {
          id: string
          user_id: string
          name: string
          kind: Database["public"]["Enums"]["location_kind"]
          bar_weight_lb: number
          smith_bar_weight_lb: number
          overhead_min: number
          is_default: boolean
          notes: string | null
          preset_slug: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          kind?: Database["public"]["Enums"]["location_kind"]
          bar_weight_lb?: number
          smith_bar_weight_lb?: number
          overhead_min?: number
          is_default?: boolean
          notes?: string | null
          preset_slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          kind?: Database["public"]["Enums"]["location_kind"]
          bar_weight_lb?: number
          smith_bar_weight_lb?: number
          overhead_min?: number
          is_default?: boolean
          notes?: string | null
          preset_slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      oura_daily: {
        Row: {
          id: string
          user_id: string
          date: string
          readiness_score: number | null
          sleep_score: number | null
          activity_score: number | null
          hrv_ms: number | null
          resting_hr: number | null
          body_temp_deviation_c: number | null
          respiratory_rate: number | null
          steps: number | null
          active_calories: number | null
          met_minutes: number | null
          vo2max: number | null
          cardiovascular_age: number | null
          stress_high_min: number | null
          resilience: string | null
          raw: Json | null
          synced_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          readiness_score?: number | null
          sleep_score?: number | null
          activity_score?: number | null
          hrv_ms?: number | null
          resting_hr?: number | null
          body_temp_deviation_c?: number | null
          respiratory_rate?: number | null
          steps?: number | null
          active_calories?: number | null
          met_minutes?: number | null
          vo2max?: number | null
          cardiovascular_age?: number | null
          stress_high_min?: number | null
          resilience?: string | null
          raw?: Json | null
          synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          readiness_score?: number | null
          sleep_score?: number | null
          activity_score?: number | null
          hrv_ms?: number | null
          resting_hr?: number | null
          body_temp_deviation_c?: number | null
          respiratory_rate?: number | null
          steps?: number | null
          active_calories?: number | null
          met_minutes?: number | null
          vo2max?: number | null
          cardiovascular_age?: number | null
          stress_high_min?: number | null
          resilience?: string | null
          raw?: Json | null
          synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oura_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_blocks: {
        Row: {
          id: string
          user_id: string
          plan_day_id: string
          block_index: number
          kind: string
          title: string | null
          estimated_min: number | null
          exercises: Json
          cardio: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          plan_day_id: string
          block_index: number
          kind: string
          title?: string | null
          estimated_min?: number | null
          exercises?: Json
          cardio?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          plan_day_id?: string
          block_index?: number
          kind?: string
          title?: string | null
          estimated_min?: number | null
          exercises?: Json
          cardio?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_blocks_plan_day_id_fkey"
            columns: ["plan_day_id"]
            isOneToOne: false
            referencedRelation: "plan_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_blocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_days: {
        Row: {
          id: string
          user_id: string
          plan_id: string
          date: string
          day_index: number
          is_today: boolean
          session_type: Database["public"]["Enums"]["session_type"]
          title: string | null
          why: string | null
          location_id: string | null
          estimated_min: number | null
          deload: boolean
          notes: string[]
          payload: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          plan_id: string
          date: string
          day_index: number
          is_today?: boolean
          session_type: Database["public"]["Enums"]["session_type"]
          title?: string | null
          why?: string | null
          location_id?: string | null
          estimated_min?: number | null
          deload?: boolean
          notes?: string[]
          payload?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          plan_id?: string
          date?: string
          day_index?: number
          is_today?: boolean
          session_type?: Database["public"]["Enums"]["session_type"]
          title?: string | null
          why?: string | null
          location_id?: string | null
          estimated_min?: number | null
          deload?: boolean
          notes?: string[]
          payload?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_days_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_days_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      plans: {
        Row: {
          id: string
          user_id: string
          generated_at: string
          plan_date: string
          week_start: string | null
          signature: string
          engine_version: string | null
          readiness: Json | null
          ledger: Json | null
          deload: Json | null
          weekly: Json | null
          input_digest: Json | null
          warnings: string[]
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          generated_at?: string
          plan_date: string
          week_start?: string | null
          signature: string
          engine_version?: string | null
          readiness?: Json | null
          ledger?: Json | null
          deload?: Json | null
          weekly?: Json | null
          input_digest?: Json | null
          warnings?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          generated_at?: string
          plan_date?: string
          week_start?: string | null
          signature?: string
          engine_version?: string | null
          readiness?: Json | null
          ledger?: Json | null
          deload?: Json | null
          weekly?: Json | null
          input_digest?: Json | null
          warnings?: string[]
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      program_progress: {
        Row: {
          id: string
          user_id: string
          program_id: string
          cycle: number
          is_active: boolean
          met: Json
          current_step_ids: string[]
          phase_id: string | null
          week_in_phase: number | null
          started_on: string | null
          completed_on: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          program_id: string
          cycle?: number
          is_active?: boolean
          met?: Json
          current_step_ids?: string[]
          phase_id?: string | null
          week_in_phase?: number | null
          started_on?: string | null
          completed_on?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          program_id?: string
          cycle?: number
          is_active?: boolean
          met?: Json
          current_step_ids?: string[]
          phase_id?: string | null
          week_in_phase?: number | null
          started_on?: string | null
          completed_on?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_progress_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      program_steps: {
        Row: {
          id: string
          user_id: string | null
          program_id: string
          step_key: string
          step_order: number
          name: string
          standard_text: string | null
          standard: Json | null
          exercise_slug: string | null
          substitutions: Json
          prerequisites: string[]
          block: string | null
          phase_id: string | null
          progressions: Json
          demo_url: string | null
          per_side: boolean
          rest_s: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          program_id: string
          step_key: string
          step_order: number
          name: string
          standard_text?: string | null
          standard?: Json | null
          exercise_slug?: string | null
          substitutions?: Json
          prerequisites?: string[]
          block?: string | null
          phase_id?: string | null
          progressions?: Json
          demo_url?: string | null
          per_side?: boolean
          rest_s?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          program_id?: string
          step_key?: string
          step_order?: number
          name?: string
          standard_text?: string | null
          standard?: Json | null
          exercise_slug?: string | null
          substitutions?: Json
          prerequisites?: string[]
          block?: string | null
          phase_id?: string | null
          progressions?: Json
          demo_url?: string | null
          per_side?: boolean
          rest_s?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_steps_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_steps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      programs: {
        Row: {
          id: string
          user_id: string | null
          slug: string
          name: string
          description: string | null
          ordering: string
          days_per_week_min: number
          days_per_week_max: number
          blocks: Json
          target_cycles: number
          source: string | null
          attribution: string | null
          phases: Json
          days: Json
          current_phase_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          slug: string
          name: string
          description?: string | null
          ordering?: string
          days_per_week_min?: number
          days_per_week_max?: number
          blocks?: Json
          target_cycles?: number
          source?: string | null
          attribution?: string | null
          phases?: Json
          days?: Json
          current_phase_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          slug?: string
          name?: string
          description?: string | null
          ordering?: string
          days_per_week_min?: number
          days_per_week_max?: number
          blocks?: Json
          target_cycles?: number
          source?: string | null
          attribution?: string | null
          phases?: Json
          days?: Json
          current_phase_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      self_reports: {
        Row: {
          id: string
          user_id: string
          date: string
          soreness: number
          energy: number
          stress: number
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          soreness: number
          energy: number
          stress: number
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          soreness?: number
          energy?: number
          stress?: number
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "self_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      session_exercises: {
        Row: {
          id: string
          user_id: string
          session_id: string
          exercise_id: string
          order_index: number
          swapped_from: string | null
          superset_with: string | null
          block_kind: string | null
          program_step_id: string | null
          why: string | null
          note: string | null
          estimated_min: number | null
          prediction: Json | null
          prescribed: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_id: string
          exercise_id: string
          order_index: number
          swapped_from?: string | null
          superset_with?: string | null
          block_kind?: string | null
          program_step_id?: string | null
          why?: string | null
          note?: string | null
          estimated_min?: number | null
          prediction?: Json | null
          prescribed?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string
          exercise_id?: string
          order_index?: number
          swapped_from?: string | null
          superset_with?: string | null
          block_kind?: string | null
          program_step_id?: string | null
          why?: string | null
          note?: string | null
          estimated_min?: number | null
          prediction?: Json | null
          prescribed?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_program_step_id_fkey"
            columns: ["program_step_id"]
            isOneToOne: false
            referencedRelation: "program_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_superset_with_fkey"
            columns: ["superset_with"]
            isOneToOne: false
            referencedRelation: "session_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_swapped_from_fkey"
            columns: ["swapped_from"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      sessions: {
        Row: {
          id: string
          user_id: string
          date: string
          type: Database["public"]["Enums"]["session_type"]
          location_id: string | null
          plan_day_id: string | null
          title: string | null
          why: string | null
          duration_min: number | null
          started_at: string | null
          ended_at: string | null
          completed: boolean
          note: string | null
          source: string
          readiness_score: number | null
          readiness_band: string | null
          tonnage_lb: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          type: Database["public"]["Enums"]["session_type"]
          location_id?: string | null
          plan_day_id?: string | null
          title?: string | null
          why?: string | null
          duration_min?: number | null
          started_at?: string | null
          ended_at?: string | null
          completed?: boolean
          note?: string | null
          source?: string
          readiness_score?: number | null
          readiness_band?: string | null
          tonnage_lb?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          type?: Database["public"]["Enums"]["session_type"]
          location_id?: string | null
          plan_day_id?: string | null
          title?: string | null
          why?: string | null
          duration_min?: number | null
          started_at?: string | null
          ended_at?: string | null
          completed?: boolean
          note?: string | null
          source?: string
          readiness_score?: number | null
          readiness_band?: string | null
          tonnage_lb?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_plan_day_id_fkey"
            columns: ["plan_day_id"]
            isOneToOne: false
            referencedRelation: "plan_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      sets: {
        Row: {
          id: string
          user_id: string
          session_exercise_id: string
          set_index: number
          reps: number | null
          load_lb: number | null
          rpe: number | null
          completed: boolean
          duration_s: number | null
          distance_mi: number | null
          is_warmup: boolean
          is_assisted: boolean
          rest_s: number | null
          logged_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_exercise_id: string
          set_index: number
          reps?: number | null
          load_lb?: number | null
          rpe?: number | null
          completed?: boolean
          duration_s?: number | null
          distance_mi?: number | null
          is_warmup?: boolean
          is_assisted?: boolean
          rest_s?: number | null
          logged_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_exercise_id?: string
          set_index?: number
          reps?: number | null
          load_lb?: number | null
          rpe?: number | null
          completed?: boolean
          duration_s?: number | null
          distance_mi?: number | null
          is_warmup?: boolean
          is_assisted?: boolean
          rest_s?: number | null
          logged_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sets_session_exercise_id_fkey"
            columns: ["session_exercise_id"]
            isOneToOne: false
            referencedRelation: "session_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      strava_activities: {
        Row: {
          id: string
          user_id: string
          strava_activity_id: number
          athlete_id: number | null
          name: string | null
          sport_type: string | null
          start_date: string | null
          start_date_local: string | null
          local_date: string | null
          distance_mi: number | null
          moving_time_s: number | null
          elapsed_time_s: number | null
          total_elevation_gain_ft: number | null
          average_hr: number | null
          max_hr: number | null
          average_speed_mph: number | null
          calories: number | null
          has_heartrate: boolean
          streams_summary: Json | null
          zone_minutes: Json
          raw: Json | null
          cardio_log_id: string | null
          synced_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          strava_activity_id: number
          athlete_id?: number | null
          name?: string | null
          sport_type?: string | null
          start_date?: string | null
          start_date_local?: string | null
          local_date?: string | null
          distance_mi?: number | null
          moving_time_s?: number | null
          elapsed_time_s?: number | null
          total_elevation_gain_ft?: number | null
          average_hr?: number | null
          max_hr?: number | null
          average_speed_mph?: number | null
          calories?: number | null
          has_heartrate?: boolean
          streams_summary?: Json | null
          zone_minutes?: Json
          raw?: Json | null
          cardio_log_id?: string | null
          synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          strava_activity_id?: number
          athlete_id?: number | null
          name?: string | null
          sport_type?: string | null
          start_date?: string | null
          start_date_local?: string | null
          local_date?: string | null
          distance_mi?: number | null
          moving_time_s?: number | null
          elapsed_time_s?: number | null
          total_elevation_gain_ft?: number | null
          average_hr?: number | null
          max_hr?: number | null
          average_speed_mph?: number | null
          calories?: number | null
          has_heartrate?: boolean
          streams_summary?: Json | null
          zone_minutes?: Json
          raw?: Json | null
          cardio_log_id?: string | null
          synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strava_activities_cardio_log_id_fkey"
            columns: ["cardio_log_id"]
            isOneToOne: false
            referencedRelation: "cardio_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strava_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      users: {
        Row: {
          id: string
          email: string | null
          display_name: string | null
          birth_date: string | null
          height_in: number | null
          bodyweight_lb: number | null
          hr_max: number | null
          hr_max_source: string | null
          resting_hr: number | null
          standing_reach_in: number | null
          timezone: string
          telegram_chat_id: string | null
          onboarded_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email?: string | null
          display_name?: string | null
          birth_date?: string | null
          height_in?: number | null
          bodyweight_lb?: number | null
          hr_max?: number | null
          hr_max_source?: string | null
          resting_hr?: number | null
          standing_reach_in?: number | null
          timezone?: string
          telegram_chat_id?: string | null
          onboarded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          display_name?: string | null
          birth_date?: string | null
          height_in?: number | null
          bodyweight_lb?: number | null
          hr_max?: number | null
          hr_max_source?: string | null
          resting_hr?: number | null
          standing_reach_in?: number | null
          timezone?: string
          telegram_chat_id?: string | null
          onboarded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_location_preset: {
        Args: {
          p_user_id: string;
          p_preset_slug: string;
          p_name?: string | null;
          p_overwrite?: boolean;
        }
        Returns: string
      }
      program_phase_ids: {
        Args: { p_phases: Json }
        Returns: string[]
      }
      start_program: {
        Args: { p_user_id: string; p_slug: string; p_on?: string }
        Returns: string
      }
      cron_post: {
        Args: { p_path: string; p_body?: Json }
        Returns: boolean
      }
      cron_oura_sync: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cron_strava_reconcile: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cron_weekly_rollup: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cron_keepalive: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: {
      cardio_modality: "run" | "walk" | "ruck" | "bike" | "row" | "ski_erg" | "elliptical" | "stair" | "swim" | "other"
      equipment_slug: "bodyweight" | "dumbbell" | "adjustable_dumbbell" | "barbell" | "ez_curl_bar" | "fixed_barbell" | "trap_bar" | "smith_machine" | "power_rack" | "bench_flat" | "bench_adjustable" | "nordic_support" | "pull_up_bar" | "dip_station" | "assisted_pullup_machine" | "cable_machine" | "functional_trainer" | "selectorized_machine" | "leg_press" | "leg_extension" | "leg_curl" | "hip_abductor_adductor" | "calf_machine" | "back_extension_bench" | "chest_press_machine" | "shoulder_press_machine" | "lat_pulldown" | "seated_row" | "pec_deck" | "ab_crunch_machine" | "kettlebell" | "resistance_bands" | "suspension_trainer" | "medicine_ball" | "slam_ball" | "stability_ball" | "bosu" | "foam_roller" | "yoga_mat" | "slant_board" | "tibialis_bar" | "sled" | "plyo_box" | "jump_rope" | "treadmill" | "elliptical" | "arc_trainer" | "stair_climber" | "stationary_bike" | "recumbent_bike" | "rower" | "ski_erg" | "assault_bike" | "track_or_open_space" | "outdoor_route" | "rings" | "ab_wheel" | "battle_rope" | "sledgehammer" | "tire" | "arm_ergometer" | "ghd" | "bumper_plates" | "chalk" | "wall_space"
      force_kind: "push" | "pull" | "static" | "unknown"
      goal_mode: "maintain" | "tone" | "bulk" | "six_pack" | "strength" | "power" | "endurance" | "rehab" | "vo2_focus" | "fat_loss"
      level_kind: "beginner" | "intermediate" | "expert"
      llm_job_status: "queued" | "claimed" | "succeeded" | "failed" | "fallback"
      load_style: "total_dumbbell_pair" | "single_implement" | "barbell" | "smith" | "stack" | "bodyweight" | "assisted" | "band" | "none"
      location_kind: "home" | "planet_fitness" | "crossfit_box" | "bodyweight_only" | "other"
      mechanic_kind: "compound" | "isolation" | "unknown"
      media_source: "free-exercise-db" | "gym-visual" | "curated" | "kot"
      movement_pattern: "squat" | "hinge" | "lunge" | "horizontal_push" | "vertical_push" | "horizontal_pull" | "vertical_pull" | "carry" | "rotation" | "anti_extension" | "anti_rotation" | "anti_lateral_flexion" | "jump" | "sprint" | "gait" | "isolation_upper" | "isolation_lower" | "mobility" | "cardio_steady" | "cardio_interval"
      region: "knees_quads" | "posterior_chain" | "low_back" | "shoulders" | "elbows_forearms" | "calves_achilles" | "spine" | "chest" | "upper_back" | "core" | "hips_glutes" | "neck"
      session_type: "strength" | "kot" | "power" | "vo2" | "zone2" | "sprint" | "mobility" | "recovery" | "external"
      swap_difficulty: "easier" | "same" | "harder"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
};

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers, in the shape Supabase's generator ships them.
 * ─────────────────────────────────────────────────────────────────────────── */

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];

export type TableName = keyof PublicSchema["Tables"];

/* ───────────────────────────────────────────────────────────────────────────
 * Named row aliases for the tables everything touches. Saves a generic in the
 * places we read most often.
 * ─────────────────────────────────────────────────────────────────────────── */

export type UserRow             = Tables<"users">;
export type LocationRow         = Tables<"locations">;
export type LocationEquipmentRow = Tables<"location_equipment">;
export type EquipmentCatalogRow = Tables<"equipment_catalog">;
export type ExerciseRow         = Tables<"exercises">;
export type ExerciseMediaRow    = Tables<"exercise_media">;
export type PlanRow             = Tables<"plans">;
export type PlanDayRow          = Tables<"plan_days">;
export type PlanBlockRow        = Tables<"plan_blocks">;
export type SessionRow          = Tables<"sessions">;
export type SessionExerciseRow  = Tables<"session_exercises">;
export type SetRow              = Tables<"sets">;
export type CardioLogRow        = Tables<"cardio_logs">;
export type StravaActivityRow   = Tables<"strava_activities">;
export type OuraDailyRow        = Tables<"oura_daily">;
export type SelfReportRow       = Tables<"self_reports">;
export type BodyMetricRow       = Tables<"body_metrics">;
export type InjuryRow           = Tables<"injuries">;
export type InjuryCheckinRow    = Tables<"injury_checkins">;
export type WorkerHeartbeatRow  = Tables<"worker_heartbeat">;
export type ProgramRow          = Tables<"programs">;
export type ProgramStepRow      = Tables<"program_steps">;
export type ProgramProgressRow  = Tables<"program_progress">;
export type GoalSettingsRow     = Tables<"goal_settings">;
export type LlmJobRow           = Tables<"llm_jobs">;
export type BotMessageRow       = Tables<"bot_messages">;
export type ImportRow           = Tables<"imports">;
export type IntegrationTokenRow = Tables<"integration_tokens">;
export type LocationPresetRow   = Tables<"location_presets">;
export type CronRunRow          = Tables<"cron_runs">;

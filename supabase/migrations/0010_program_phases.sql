-- ═════════════════════════════════════════════════════════════════════════════
-- 0010_program_phases.sql — Longevity OS · programs run in phases
-- ═════════════════════════════════════════════════════════════════════════════
-- 0001 modelled a program as a flat, ordered list of steps with prerequisites.
-- That was right for a checklist and wrong for Knees Over Toes, which is three
-- sequential phases — ZERO, DENSE, STANDARDS — each with its own duration, its
-- own weekday templates, its own session length and its own rule for how load
-- is chosen. Seth does not pick from a list of 69 things; he does Monday of
-- ZERO, week 1.
--
-- Everything here is ADDITIVE. Every column is nullable or defaulted, so a
-- program that has no phases (the flat kind 0001 assumed) still reads and
-- writes exactly as before. Nothing is dropped and nothing is renamed.
--
-- Mirrors the additive changes to `ProgramPhase`, `ProgramDay`, `PhaseLoadRule`
-- and the optional fields on `Program` / `ProgramStep` / `ProgramProgress` in
-- packages/engine/src/types.ts. scripts/check-contracts.ts holds the two sides
-- together.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. programs — the phase list, the weekday templates, and where he is now
-- ─────────────────────────────────────────────────────────────────────────────
-- Both are jsonb rather than tables of their own. A phase and a weekday
-- template are read whole, always, and only ever rewritten by regenerating the
-- program from `programs/kot/program.json`. Normalizing them would buy joins
-- nobody performs and cost an atomic rewrite.

alter table public.programs
  add column if not exists phases jsonb not null default '[]'::jsonb,
  add column if not exists days   jsonb not null default '[]'::jsonb,
  -- The phase the athlete is in when no per-user progress row says otherwise.
  -- For KOT this is 'zero': everyone starts at the beginning.
  add column if not exists current_phase_id text;

comment on column public.programs.phases is
  'ProgramPhase[]: [{"id":"zero","name":"ZERO","order":1,"weeks":12,"days_per_week":3,"weekdays":[1,3,5],"session_min":[10,20],"load_rule":{"kind":"bodyweight_only"},"description":"..."}]. Empty for a flat program.';
comment on column public.programs.days is
  'ProgramDay[]: one per (phase, weekday). [{"phase_id":"zero","weekday":1,"title":"ZERO — Monday","focus":"Same Workout","blocks":[{"title":"Warm-Up","step_ids":["zero-bodyweight-walk-warm-up"]}],"demo_url":"..."}]. Weekday follows the engine and JS Date.getDay(): 0 = Sunday … 6 = Saturday, so 1 = Monday. It matches ISO for Monday–Friday and differs only for Sunday, which no phase currently trains — do not let that coincidence turn into an assumption.';
comment on column public.programs.current_phase_id is
  'Default phase id for a cold start — the phase a brand-new athlete begins in. Per-athlete position lives in program_progress.phase_id.';

-- A phase id referenced anywhere must exist in `phases`. Cheap to check here,
-- impossible to reconstruct once a plan has silently fallen back to phase one.
create or replace function public.program_phase_ids(p_phases jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(x->>'id'), '{}'::text[])
  from jsonb_array_elements(coalesce(p_phases, '[]'::jsonb)) as x
$$;

comment on function public.program_phase_ids(jsonb) is
  'The phase ids declared in a programs.phases document, as a text[]. Used by the constraints below so a dangling phase_id cannot be stored.';

alter table public.programs
  drop constraint if exists programs_current_phase_known;
alter table public.programs
  add constraint programs_current_phase_known check (
    current_phase_id is null
    or current_phase_id = any (public.program_phase_ids(phases))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. program_steps — which phase a step belongs to, and how it is performed
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.program_steps
  add column if not exists phase_id     text,
  -- Ordered, coarsest first: what "harder" means for this step. Free text, one
  -- string per rung — the engine shows the next rung, it does not parse them.
  add column if not exists progressions jsonb not null default '[]'::jsonb,
  add column if not exists demo_url     text,
  -- True when the prescribed reps are PER SIDE. 20 steps in KOT are.
  add column if not exists per_side     boolean not null default false,
  add column if not exists rest_s       integer;

alter table public.program_steps
  drop constraint if exists program_steps_rest_nonneg;
alter table public.program_steps
  add constraint program_steps_rest_nonneg check (rest_s is null or rest_s >= 0);

alter table public.program_steps
  drop constraint if exists program_steps_progressions_is_array;
alter table public.program_steps
  add constraint program_steps_progressions_is_array
    check (jsonb_typeof(progressions) = 'array');

comment on column public.program_steps.phase_id is
  'Which programs.phases[].id this step belongs to. Null on a flat program.';
comment on column public.program_steps.per_side is
  'Reps in `standard` are per side. "5 reps" on an ATG split squat means 5 each leg — ten sets of work, not five.';
comment on column public.program_steps.rest_s is
  'Prescribed rest. Null means the engine chooses from the block and the goal mode.';

create index if not exists program_steps_phase_idx
  on public.program_steps (program_id, phase_id, step_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. program_progress — where the athlete actually is
-- ─────────────────────────────────────────────────────────────────────────────
-- `week_in_phase` is what drives DENSE's load ramp: week 1 bodyweight, week 2
-- at 25% of bodyweight, +5% a week after that. It counts weeks IN THE PHASE,
-- not weeks in the program, and it resets to 1 on every phase transition.

alter table public.program_progress
  add column if not exists phase_id      text,
  add column if not exists week_in_phase integer;

alter table public.program_progress
  drop constraint if exists program_progress_week_positive;
alter table public.program_progress
  add constraint program_progress_week_positive
    check (week_in_phase is null or week_in_phase >= 1);

comment on column public.program_progress.phase_id is
  'The phase this athlete is in. Null falls back to programs.current_phase_id.';
comment on column public.program_progress.week_in_phase is
  '1-based week WITHIN the phase — the input to a percent_bw_ramp load rule. Resets to 1 when the phase changes.';

-- Enforced with a trigger rather than a check constraint: the valid set lives
-- in another table, which a check constraint may not read.
create or replace function public.program_progress_phase_guard()
returns trigger
language plpgsql
as $$
declare known text[];
begin
  if new.phase_id is null then
    return new;
  end if;

  select public.program_phase_ids(p.phases) into known
  from public.programs p where p.id = new.program_id;

  if known is null or array_length(known, 1) is null then
    raise exception
      'program_progress.phase_id = % but program % declares no phases',
      new.phase_id, new.program_id;
  end if;

  if not (new.phase_id = any (known)) then
    raise exception
      'program_progress.phase_id = % is not one of the program''s phases (%)',
      new.phase_id, array_to_string(known, ', ');
  end if;

  return new;
end $$;

drop trigger if exists program_progress_phase_guard on public.program_progress;
create trigger program_progress_phase_guard
  before insert or update of phase_id, program_id on public.program_progress
  for each row execute function public.program_progress_phase_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Starting a program
-- ─────────────────────────────────────────────────────────────────────────────
-- Locations get `apply_location_preset`; programs get this. Called by
-- onboarding with the service key, once, after the athlete's user row exists.
-- Re-running it is harmless — it returns the existing active row rather than
-- resetting anyone to week 1.

create or replace function public.start_program(
  p_user_id uuid,
  p_slug    text,
  p_on      date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.programs%rowtype;
  v_id      uuid;
begin
  select * into v_program from public.programs
  where slug = p_slug and (user_id is null or user_id = p_user_id)
  order by user_id nulls last
  limit 1;

  if not found then
    raise exception 'no program with slug %', p_slug;
  end if;

  select id into v_id from public.program_progress
  where user_id = p_user_id and program_id = v_program.id and is_active;

  if found then
    return v_id;
  end if;

  insert into public.program_progress
    (user_id, program_id, cycle, is_active, started_on, phase_id, week_in_phase,
     current_step_ids)
  values
    (p_user_id, v_program.id, 1, true, p_on,
     v_program.current_phase_id,
     case when v_program.current_phase_id is null then null else 1 end,
     coalesce((
       select array_agg(s.step_key order by s.step_order)
       from public.program_steps s
       where s.program_id = v_program.id
         and (v_program.current_phase_id is null
              or s.phase_id = v_program.current_phase_id)
     ), '{}'::text[]))
  returning id into v_id;

  return v_id;
end $$;

comment on function public.start_program(uuid, text, date) is
  'Enrol an athlete in a program at its first phase, week 1. Idempotent: returns the existing active progress row if there is one, so calling it twice never resets anybody. Onboarding calls select public.start_program(:uid, ''kot'');';

revoke all on function public.start_program(uuid, text, date) from public;
grant execute on function public.start_program(uuid, text, date) to service_role;

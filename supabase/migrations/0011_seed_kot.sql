-- ═════════════════════════════════════════════════════════════════════════════
-- 0011_seed_kot.sql — Longevity OS · the Knees Over Toes program
-- ═════════════════════════════════════════════════════════════════════════════
-- GENERATED FILE — DO NOT EDIT. Run `npm run sql:kot` after changing
-- `programs/kot/program.json`; CI fails if this file and that one disagree.
--
-- 3 phases · 69 steps · 12 weekday templates.
-- Global (`user_id is null`): the program is the same for every athlete, and
-- only an athlete's POSITION in it is personal. Enrol somebody with
-- `select public.start_program(:uid, 'kot');` (0010).
--
-- Re-runnable. Steps are upserted on (program_id, step_key) and any step that
-- is no longer in the JSON is deleted — so a rename in the source file does not
-- leave an orphan behind that the planner might still schedule.
--
-- Source: Seth’s ATG Knees Over Toes checklist and spreadsheets, April 2026 (docs/programs/kot/raw/, gitignored)
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The program
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.programs
  (user_id, slug, name, description, ordering,
   days_per_week_min, days_per_week_max, blocks, target_cycles,
   source, attribution, phases, days, current_phase_id)
values
  (null, 'kot', 'Knees Over Toes', 'Seth’s three-phase Knees Over Toes program. Zero builds bodyweight ankle and knee ability three days a week for twelve weeks; Dense loads it five days a week for twelve more, adding a fixed percentage of bodyweight each week; Standards runs four days a week, open-ended, until all twelve benchmarks are met. Every phase is ordered from the ground up: feet and lower legs, then the knee itself, then the posterior chain, then upper body, then held stretches.', 'ground_up',
   3, 5, '[{"id":"warm_up","name":"Warm-Up","note":"Walking and the foot/ankle prep that precedes every session.","order":1},{"id":"lower_legs","name":"Lower Legs","note":"Tibialis and calves. Always before anything loads the knee from above.","order":2},{"id":"knee_ability","name":"Knee Ability","note":"Step-ups, split squats and squats — the knees-over-toes work itself.","order":3},{"id":"posterior_chain","name":"Posterior Chain & Spine","note":"Hamstrings, low back and the loaded spinal flexion work.","order":4},{"id":"hip_flexors_core","name":"Hip Flexors & Core","note":"L-sits, hanging work and the low-cable hip-flexor pull.","order":5},{"id":"upper_body","name":"Upper Body","note":"Pressing, pulling and shoulder health. Comes after the lower-body sequence.","order":6},{"id":"mobility_cooldown","name":"Mobility & Cool-Down","note":"Held stretches. Closes every session.","order":7}]'::jsonb, 1,
   'Seth’s ATG Knees Over Toes checklist and spreadsheets, April 2026 (docs/programs/kot/raw/, gitignored)', 'Knees Over Toes / ATG is Ben Patrick’s method. This file records the structure and numbers of Seth’s own copy of the program so his training app can schedule it. No ATG coaching text or imagery is reproduced. Not affiliated with, endorsed by, or licensed from ATG.',
   '[{"days_per_week":3,"description":"12 weeks. 3 days a week, Monday, Wednesday, Friday. 10–20 minutes a session. Bodyweight throughout — no external load anywhere in the phase.","id":"zero","load_rule":{"kind":"bodyweight_only"},"name":"ZERO","order":1,"session_min":[10,20],"weekdays":[1,3,5],"weeks":12},{"days_per_week":5,"description":"12 weeks. 5 days a week, Monday, Tuesday, Wednesday, Thursday, Friday. 30–45 minutes a session. Week 1 is bodyweight, week 2 starts at 25% of bodyweight, and every week after adds 5% — except the split squat, which adds 2.5%. Load only goes up once the full set count is completed inside the time cap.","id":"dense","load_rule":{"kind":"percent_bw_ramp","start_pct":25,"weekly_increment_pct":5},"name":"DENSE","order":2,"session_min":[30,45],"weekdays":[1,2,3,4,5],"weeks":12},{"days_per_week":4,"description":"Open-ended: it runs until every benchmark is met. 4 days a week, Monday, Tuesday, Thursday, Friday. 45–60 minutes a session. Load is whatever it takes to reach the twelve benchmarks; there is no calendar ramp.","id":"standards","load_rule":{"kind":"standards_driven"},"name":"STANDARDS","order":3,"session_min":[45,60],"weekdays":[1,2,4,5],"weeks":null}]'::jsonb, '[{"blocks":[{"step_ids":["zero-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["zero-tibialis-raise","zero-calf-raise-slant-board","zero-tibialis-raise","zero-kot-calf-raise"],"title":"Lower Legs"},{"step_ids":["zero-patrick-step-slant-board","zero-atg-split-squat"],"title":"Knee Ability"},{"step_ids":["zero-nordic-curl"],"title":"Posterior Chain & Spine"},{"step_ids":["zero-l-sit"],"title":"Hip Flexors & Core"},{"step_ids":["zero-elephant-walk","zero-couch-stretch","zero-standing-pigeon","zero-neck-brace-exercises"],"title":"Mobility & Cool-Down"},{"step_ids":["zero-body-squat-slant-board"],"title":"Knee Ability"}],"demo_url":"https://www.youtube.com/watch?v=gNS_QjGAs_k&list=PLKwcvRjG9E-GDP8LAmFk_obbDak3sO-j0&index=1&ab_channel=TheKneesovertoesguy","focus":"Same Workout","phase_id":"zero","title":"ZERO — Monday","weekday":1},{"blocks":[{"step_ids":["zero-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["zero-tibialis-raise","zero-calf-raise-slant-board","zero-tibialis-raise","zero-kot-calf-raise"],"title":"Lower Legs"},{"step_ids":["zero-patrick-step-slant-board","zero-atg-split-squat"],"title":"Knee Ability"},{"step_ids":["zero-nordic-curl"],"title":"Posterior Chain & Spine"},{"step_ids":["zero-l-sit"],"title":"Hip Flexors & Core"},{"step_ids":["zero-elephant-walk","zero-couch-stretch","zero-standing-pigeon","zero-neck-brace-exercises"],"title":"Mobility & Cool-Down"},{"step_ids":["zero-body-squat-slant-board"],"title":"Knee Ability"}],"demo_url":"https://www.youtube.com/watch?v=gNS_QjGAs_k&list=PLKwcvRjG9E-GDP8LAmFk_obbDak3sO-j0&index=1&ab_channel=TheKneesovertoesguy","focus":"Same Workout","phase_id":"zero","title":"ZERO — Wednesday","weekday":3},{"blocks":[{"step_ids":["zero-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["zero-tibialis-raise","zero-calf-raise-slant-board","zero-tibialis-raise","zero-kot-calf-raise"],"title":"Lower Legs"},{"step_ids":["zero-patrick-step-slant-board","zero-atg-split-squat"],"title":"Knee Ability"},{"step_ids":["zero-nordic-curl"],"title":"Posterior Chain & Spine"},{"step_ids":["zero-l-sit"],"title":"Hip Flexors & Core"},{"step_ids":["zero-elephant-walk","zero-couch-stretch","zero-standing-pigeon","zero-neck-brace-exercises"],"title":"Mobility & Cool-Down"},{"step_ids":["zero-body-squat-slant-board"],"title":"Knee Ability"}],"demo_url":"https://www.youtube.com/watch?v=gNS_QjGAs_k&list=PLKwcvRjG9E-GDP8LAmFk_obbDak3sO-j0&index=1&ab_channel=TheKneesovertoesguy","focus":"Same Workout","phase_id":"zero","title":"ZERO — Friday","weekday":5},{"blocks":[{"step_ids":["dense-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["dense-patrick-step"],"title":"Knee Ability"},{"step_ids":["dense-seated-good-morning"],"title":"Posterior Chain & Spine"},{"step_ids":["dense-tibialis-raise"],"title":"Lower Legs"}],"demo_url":"https://www.youtube.com/playlist?list=PLKwcvRjG9E-E6wwMyWoRIcgdNGw47bk6e","focus":"Lower Body","phase_id":"dense","title":"DENSE — Monday","weekday":1},{"blocks":[{"step_ids":["dense-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["dense-chin-up","dense-dips","dense-smith-machine-curl","dense-french-press"],"title":"Upper Body"},{"step_ids":["dense-jefferson-curl-slant-board"],"title":"Posterior Chain & Spine"},{"step_ids":["dense-slant-board-calf-raise-loaded"],"title":"Lower Legs"},{"step_ids":["dense-tibialis-stretch"],"title":"Mobility & Cool-Down"}],"demo_url":"https://www.youtube.com/playlist?list=PLKwcvRjG9E-EfQI5vy-k1nw2-YzQY-QEt","focus":"Upper + Mobility","phase_id":"dense","title":"DENSE — Tuesday","weekday":2},{"blocks":[{"step_ids":["dense-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["dense-atg-split-squat"],"title":"Knee Ability"},{"step_ids":["dense-hip-flexor-tri-set"],"title":"Hip Flexors & Core"},{"step_ids":["dense-single-leg-calf-raise"],"title":"Lower Legs"}],"demo_url":"https://www.youtube.com/playlist?list=PLKwcvRjG9E-HyWJZ5AtckjTXYfyD1uyAh","focus":"Split Squat + Hip Flexors","phase_id":"dense","title":"DENSE — Wednesday","weekday":3},{"blocks":[{"step_ids":["dense-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["dense-bench-pullover","dense-atg-shoulder-press","dense-shoulder-external-rotation"],"title":"Upper Body"},{"step_ids":["dense-couch-stretch","dense-piriformis-stretch","dense-butterfly-stretch"],"title":"Mobility & Cool-Down"}],"demo_url":"https://www.youtube.com/playlist?list=PLKwcvRjG9E-HOcZ0gQ8b6K1Afbx8M-Itq","focus":"Upper + Mobility","phase_id":"dense","title":"DENSE — Thursday","weekday":4},{"blocks":[{"step_ids":["dense-bodyweight-walk-warm-up"],"title":"Warm-Up"},{"step_ids":["dense-vmo-squat","dense-kot-squat-eccentric"],"title":"Knee Ability"},{"step_ids":["dense-nordic-curl-eccentric","dense-ql-extension"],"title":"Posterior Chain & Spine"}],"demo_url":"https://www.youtube.com/playlist?list=PLKwcvRjG9E-G8GFxHHOdYCSHPOAkNrTL8","focus":"Squat Focus","phase_id":"dense","title":"DENSE — Friday","weekday":5},{"blocks":[{"step_ids":["standards-plantar-fascia-stretch","standards-tibialis-stretch","standards-bodyweight-walk"],"title":"Warm-Up"},{"step_ids":["standards-single-leg-elevated-pike"],"title":"Hip Flexors & Core"},{"step_ids":["standards-poliquin-step-up"],"title":"Knee Ability"},{"step_ids":["standards-jefferson-curl"],"title":"Posterior Chain & Spine"},{"step_ids":["standards-hanging-leg-raise"],"title":"Hip Flexors & Core"},{"step_ids":["standards-tibialis-raise"],"title":"Lower Legs"},{"step_ids":["standards-incline-dumbbell-press","standards-trx-face-pull"],"title":"Upper Body"},{"step_ids":["standards-pigeon","standards-couch-stretch"],"title":"Mobility & Cool-Down"}],"focus":"Lower + Upper + Cool Down","phase_id":"standards","title":"STANDARDS — Monday","weekday":1},{"blocks":[{"step_ids":["standards-calf-stretch","standards-bodyweight-walk"],"title":"Warm-Up"},{"step_ids":["standards-relaxed-lunge","standards-atg-split-squat"],"title":"Knee Ability"},{"step_ids":["standards-seated-good-morning"],"title":"Posterior Chain & Spine"},{"step_ids":["standards-garhammer-raise"],"title":"Hip Flexors & Core"},{"step_ids":["standards-single-leg-calf-raise"],"title":"Lower Legs"},{"step_ids":["standards-atg-dips","standards-shoulder-external-rotation"],"title":"Upper Body"},{"step_ids":["standards-pigeon","standards-butterfly-stretch","standards-seated-pancake"],"title":"Mobility & Cool-Down"}],"focus":"Lower + Upper + Cool Down","phase_id":"standards","title":"STANDARDS — Tuesday","weekday":2},{"blocks":[{"step_ids":["standards-plantar-fascia-stretch","standards-tibialis-stretch","standards-bodyweight-walk"],"title":"Warm-Up"},{"step_ids":["standards-single-leg-elevated-pike"],"title":"Hip Flexors & Core"},{"step_ids":["standards-atg-squat"],"title":"Knee Ability"},{"step_ids":["standards-nordic-curl"],"title":"Posterior Chain & Spine"},{"step_ids":["standards-low-cable-pull-in"],"title":"Hip Flexors & Core"},{"step_ids":["standards-tibialis-raise"],"title":"Lower Legs"},{"step_ids":["standards-atg-shoulder-press","standards-chin-up"],"title":"Upper Body"},{"step_ids":["standards-pigeon","standards-couch-stretch"],"title":"Mobility & Cool-Down"}],"focus":"Lower + Upper + Cool Down","phase_id":"standards","title":"STANDARDS — Thursday","weekday":4},{"blocks":[{"step_ids":["standards-calf-stretch","standards-bodyweight-walk"],"title":"Warm-Up"},{"step_ids":["standards-atg-deadlift"],"title":"Posterior Chain & Spine"},{"step_ids":["standards-sissy-squat"],"title":"Knee Ability"},{"step_ids":["standards-l-sit"],"title":"Hip Flexors & Core"},{"step_ids":["standards-single-leg-calf-raise"],"title":"Lower Legs"},{"step_ids":["standards-bench-pullover","standards-trap-raise"],"title":"Upper Body"},{"step_ids":["standards-pigeon","standards-butterfly-stretch","standards-seated-pancake"],"title":"Mobility & Cool-Down"}],"focus":"Lower + Upper + Cool Down","phase_id":"standards","title":"STANDARDS — Friday","weekday":5}]'::jsonb, 'zero')
on conflict (slug) do update set
  name              = excluded.name,
  description       = excluded.description,
  ordering          = excluded.ordering,
  days_per_week_min = excluded.days_per_week_min,
  days_per_week_max = excluded.days_per_week_max,
  blocks            = excluded.blocks,
  target_cycles     = excluded.target_cycles,
  source            = excluded.source,
  attribution       = excluded.attribution,
  phases            = excluded.phases,
  days              = excluded.days,
  current_phase_id  = excluded.current_phase_id,
  updated_at        = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The steps
-- ─────────────────────────────────────────────────────────────────────────────
-- Staged through a temp table rather than a chain of data-modifying CTEs.
-- CTEs in one statement cannot see each other's writes, so the retire / free /
-- upsert sequence below has to be three statements: doing it in one would
-- either collide on the (program_id, step_order) unique index or try to touch
-- the same row twice and raise "tuple to be updated was already modified".

-- `on commit drop` would be wrong: applied as individual migrations each
-- statement is its own transaction, so the table would vanish before the next
-- line could fill it. A session-lifetime temp table behaves identically whether
-- the file is pasted into the Supabase SQL Editor as one transaction or run
-- statement by statement through psql.
drop table if exists kot_incoming;
create temp table kot_incoming (
  step_key      text primary key,
  step_order    integer not null,
  name          text not null,
  standard_text text,
  standard      jsonb,
  exercise_slug text,
  substitutions jsonb not null,
  prerequisites text[] not null,
  block         text,
  phase_id      text,
  progressions  jsonb not null,
  demo_url      text,
  per_side      boolean not null,
  rest_s        integer
);

insert into kot_incoming values
  ('zero-bodyweight-walk-warm-up', 1, 'Bodyweight Walk (Warm-Up)', '5–10 min — Easy pace, not a training stimulus.', '{"duration_min":5}'::jsonb, 'zone-2-steady', '[{"equipment_missing":"outdoor_route","note":"Planet Fitness or bad weather: treadmill at an easy pace.","use_slug":"walking-treadmill"}]'::jsonb, '{}'::text[], 'warm_up', 'zero', '[]'::jsonb, null, false, null),
  ('zero-tibialis-raise', 2, 'Tibialis Raise', '25 reps', '{"reps":25}'::jsonb, 'tibialis-raise', '[{"equipment_missing":"wall_space","note":"No wall to lean on: anchor a band low in front and loop it over the forefoot.","use_slug":"tibialis-raise-band"},{"equipment_missing":"tibialis_bar","note":"No tib bar at either gym: stand a dumbbell on end and pinch it between the feet.","use_slug":"tibialis-raise-dumbbell"}]'::jsonb, '{}'::text[], 'lower_legs', 'zero', '["Stand closer to the wall — less load, easier.","Step farther from the wall — more load, harder.","Add load: a dumbbell held between the feet, or a band over the forefoot.","Tib bar, once one is available."]'::jsonb, null, false, null),
  ('zero-calf-raise-slant-board', 3, 'Calf Raise (Slant Board)', '25 reps', '{"reps":25}'::jsonb, 'fhl-calf-raise', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"fhl-calf-raise"}]'::jsonb, '{}'::text[], 'lower_legs', 'zero', '["Both feet, full range: heels below the platform at the bottom.","One leg at a time (wrap the free leg behind).","Add a weight vest or hold a dumbbell."]'::jsonb, null, false, null),
  ('zero-kot-calf-raise', 4, 'KOT Calf Raise', '25 reps — The checklist says "as prescribed"; the reps come from the Knee Ability Zero recap.', '{"reps":25}'::jsonb, 'seated-calf-raise', '[]'::jsonb, '{}'::text[], 'lower_legs', 'zero', '["Small knee bend, both feet.","Deeper knee bend as the ankle allows — heels lift slightly at the bottom.","One leg at a time.","Add a weight vest."]'::jsonb, null, false, null),
  ('zero-patrick-step-slant-board', 5, 'Patrick Step (Slant Board)', '25 reps, per side', '{"reps":25}'::jsonb, 'patrick-step', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"patrick-step"}]'::jsonb, '{}'::text[], 'knee_ability', 'zero', '["Hold a wall or rail for balance.","Free-standing.","Reach the free leg farther forward.","Raise the standing surface.","Add load."]'::jsonb, null, true, null),
  ('zero-atg-split-squat', 6, 'ATG Split Squat', '25 reps, per side', '{"reps":25}'::jsonb, 'atg-split-squat', '[{"equipment_missing":"adjustable_dumbbell","note":"Travelling: bodyweight, or a loaded backpack.","use_slug":"atg-split-squat"}]'::jsonb, '{}'::text[], 'knee_ability', 'zero', '["Front foot elevated, holding a rail for assistance.","Front foot elevated, no hands.","Flat ground, no hands, back knee to the floor.","Dumbbells in both hands, toward 25% bodyweight per hand."]'::jsonb, null, true, 30),
  ('zero-nordic-curl', 7, 'Nordic Curl', '5 reps', '{"reps":5}'::jsonb, 'nordic-hamstring-curl', '[{"equipment_missing":"nordic_support","note":"Planet Fitness has no GHD and nothing safe to anchor the ankles under: run the seated leg curl machine instead.","use_slug":"seated-leg-curl"},{"equipment_missing":"nordic_support","note":"Travelling: reverse Nordic needs no anchor and keeps the eccentric quality.","use_slug":"reverse-nordic"}]'::jsonb, '{}'::text[], 'posterior_chain', 'zero', '["Lower a short way, hands catch early.","Lower farther each week, hands catch late.","Full lower, push back up with the hands.","Full rep down and up, no hands — the standard is 10."]'::jsonb, null, false, null),
  ('zero-l-sit', 8, 'L-Sit', '60 s hold', '{"hold_s":60}'::jsonb, 'l-sit', '[]'::jsonb, '{}'::text[], 'hip_flexors_core', 'zero', '["Level 1 — alternate lifting one leg at a time, seated, for the full time.","Level 2 — same, with the hips off the floor.","Level 3 — full L-sit, both legs and hips off the floor."]'::jsonb, null, false, null),
  ('zero-elephant-walk', 9, 'Elephant Walk', '25 reps', '{"reps":25}'::jsonb, 'elephant-walk', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'zero', '["Hands well forward, on fingertips or a box, knees bent.","Alternate straightening one leg at a time.","Walk the hands back until the palms reach the floor in front of the toes."]'::jsonb, null, false, null),
  ('zero-couch-stretch', 10, 'Couch Stretch', '60 s hold, per side', '{"hold_s":60}'::jsonb, 'couch-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'zero', '["Knee down, torso upright, hands on the floor.","Hands to the front thigh.","Hands to the hips.","Shoulders to the wall."]'::jsonb, null, true, null),
  ('zero-standing-pigeon', 11, 'Standing Pigeon', '2 sets, 90 s hold, per side — The checklist says only "hold each side". The 2 x 90 s comes from the Knee Ability Zero recap, where the same slot is a seated piriformis stretch.', '{"hold_s":90,"sets":2}'::jsonb, 'seated-piriformis-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'zero', '[]'::jsonb, null, true, null),
  ('zero-neck-brace-exercises', 12, 'Neck Brace Exercises', 'no sets, reps or duration given in the source — The checklist says "as prescribed" and gives no reps — the one step in Zero with no numbers anywhere in the sources.', null, 'isometric-neck-exercise-front-and-back', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'zero', '["Manual resistance, front and back.","Manual resistance, both sides.","Band or harness resistance through all four directions."]'::jsonb, null, false, null),
  ('zero-body-squat-slant-board', 13, 'Body Squat (Slant Board)', '5 × 5 reps — The checklist says "as prescribed"; the sets and reps come from the Knee Ability Zero recap, where this step is explicitly optional.', '{"reps":5,"sets":5}'::jsonb, 'bodyweight-squat', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"bodyweight-squat"}]'::jsonb, '{}'::text[], 'knee_ability', 'zero', '["Partial depth, heels on the board.","Full depth.","More sets before more depth."]'::jsonb, null, false, 30),
  ('dense-bodyweight-walk-warm-up', 14, 'Bodyweight Walk (Warm-Up)', '5–10 min — Easy pace, not a training stimulus.', '{"duration_min":5}'::jsonb, 'zone-2-steady', '[{"equipment_missing":"outdoor_route","note":"Planet Fitness or bad weather: treadmill at an easy pace.","use_slug":"walking-treadmill"}]'::jsonb, '{}'::text[], 'warm_up', 'dense', '[]'::jsonb, null, false, null),
  ('dense-patrick-step', 15, 'Patrick Step', '10 × 10 reps, 20 min, per side — Ten sets of ten inside twenty minutes at the current load before the load goes up.', '{"duration_min":20,"reps":10,"sets":10}'::jsonb, 'patrick-step', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"patrick-step"}]'::jsonb, '{}'::text[], 'knee_ability', 'dense', '["Bodyweight.","Held dumbbells.","Raise the standing surface for more range."]'::jsonb, null, true, null),
  ('dense-seated-good-morning', 16, 'Seated Good Morning', '3 sets, 5 min (reps 20, 10, 5)', '{"duration_min":5,"sets":3}'::jsonb, 'seated-good-morning', '[{"equipment_missing":"barbell","note":"Neither gym has a barbell: Planet Fitness has the Smith machine and a seated good-morning lever.","use_slug":"lever-seated-good-morning"},{"equipment_missing":"barbell","note":"Home: hold a single heavy dumbbell at the chest and hinge from the hips.","use_slug":"seated-good-mornings"}]'::jsonb, '{}'::text[], 'posterior_chain', 'dense', '["Bodyweight hinge, hands behind the head.","Light bar.","Toward 50% bodyweight, abs to the bench."]'::jsonb, null, false, null),
  ('dense-tibialis-raise', 17, 'Tibialis Raise', '4 sets, 5 min (reps 20, 15, 10, 5)', '{"duration_min":5,"sets":4}'::jsonb, 'tibialis-raise', '[{"equipment_missing":"wall_space","note":"No wall to lean on: anchor a band low in front and loop it over the forefoot.","use_slug":"tibialis-raise-band"},{"equipment_missing":"tibialis_bar","note":"No tib bar at either gym: stand a dumbbell on end and pinch it between the feet.","use_slug":"tibialis-raise-dumbbell"}]'::jsonb, '{}'::text[], 'lower_legs', 'dense', '["Stand closer to the wall — less load, easier.","Step farther from the wall — more load, harder.","Add load: a dumbbell held between the feet, or a band over the forefoot.","Tib bar, once one is available."]'::jsonb, 'https://www.youtube.com/watch?v=__AsD5K0i3Y&ab_channel=PerformanceHerts', false, null),
  ('dense-chin-up', 18, 'Chin-Up', '5 min', '{"duration_min":5}'::jsonb, 'chin-up', '[{"equipment_missing":"pull_up_bar","note":"Planet Fitness has no free bar: the assisted pull-up machine.","use_slug":"assisted-standing-chin-up"},{"equipment_missing":"pull_up_bar","note":"Planet Fitness alternative: lat pulldown.","use_slug":"cable-bar-lateral-pulldown"}]'::jsonb, '{}'::text[], 'upper_body', 'dense', '["Band- or machine-assisted.","Bodyweight.","Weighted."]'::jsonb, null, false, null),
  ('dense-dips', 19, 'Dips', '5 min', '{"duration_min":5}'::jsonb, 'chest-dip', '[{"equipment_missing":"dip_station","note":"Neither location has a dip station: bench dips between two benches.","use_slug":"bench-dips"}]'::jsonb, '{}'::text[], 'upper_body', 'dense', '["Bench dips.","Assisted parallel-bar dips.","Full-depth bodyweight dips."]'::jsonb, null, false, null),
  ('dense-smith-machine-curl', 20, 'Smith Machine Curl', '5 min', '{"duration_min":5}'::jsonb, 'smith-machine-bicep-curl', '[{"equipment_missing":"smith_machine","note":"Home has no Smith machine: dumbbell curls.","use_slug":"dumbbell-bicep-curl"}]'::jsonb, '{}'::text[], 'upper_body', 'dense', '[]'::jsonb, 'https://vimeo.com/749630580', false, null),
  ('dense-french-press', 21, 'French Press', '5 min', '{"duration_min":5}'::jsonb, 'barbell-lying-triceps-extension-skull-crusher', '[{"equipment_missing":"ez_curl_bar","note":"Home has no EZ bar: dumbbells.","use_slug":"dumbbell-lying-triceps-extension"}]'::jsonb, '{}'::text[], 'upper_body', 'dense', '[]'::jsonb, 'https://vimeo.com/749630580', false, null),
  ('dense-jefferson-curl-slant-board', 22, 'Jefferson Curl (Slant Board)', '5 reps, 25% bodyweight — Loaded spinal flexion — check it against the standing low-back injury before prescribing.', '{"pct_bodyweight":0.25,"reps":5}'::jsonb, 'jefferson-curl', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"jefferson-curl"}]'::jsonb, '{}'::text[], 'posterior_chain', 'dense', '["Unloaded roll-down.","Light dumbbell.","Toward 25% bodyweight for 10 reps."]'::jsonb, null, false, null),
  ('dense-slant-board-calf-raise-loaded', 23, 'Slant Board Calf Raise (Loaded)', '10 reps', '{"reps":10}'::jsonb, 'fhl-calf-raise', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"fhl-calf-raise"}]'::jsonb, '{}'::text[], 'lower_legs', 'dense', '["Bodyweight both feet.","Bodyweight one leg.","Loaded one leg."]'::jsonb, null, false, null),
  ('dense-tibialis-stretch', 24, 'Tibialis Stretch', '60 s hold', '{"hold_s":60}'::jsonb, 'posterior-tibialis-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'dense', '[]'::jsonb, null, false, null),
  ('dense-atg-split-squat', 25, 'ATG Split Squat', '10 × 5 reps, 20 min, per side', '{"duration_min":20,"reps":5,"sets":10}'::jsonb, 'atg-split-squat', '[{"equipment_missing":"adjustable_dumbbell","note":"Travelling: bodyweight, or a loaded backpack.","use_slug":"atg-split-squat"}]'::jsonb, '{}'::text[], 'knee_ability', 'dense', '["Front foot elevated, holding a rail for assistance.","Front foot elevated, no hands.","Flat ground, no hands, back knee to the floor.","Dumbbells in both hands, toward 25% bodyweight per hand."]'::jsonb, null, true, 30),
  ('dense-hip-flexor-tri-set', 26, 'Hip Flexor Tri-Set', '5 min — Three drills in one slot. The checklist says alternate them to failure; the spreadsheet says pick one per five minutes.', '{"duration_min":5}'::jsonb, 'l-sit', '[]'::jsonb, '{}'::text[], 'hip_flexors_core', 'dense', '["Dumbbell foot raise, no breaks.","Reverse squat at 50% bodyweight.","L-sit, maximum time off the ground."]'::jsonb, null, false, null),
  ('dense-single-leg-calf-raise', 27, 'Single-Leg Calf Raise', '5 min, per side', '{"duration_min":5}'::jsonb, 'single-leg-calf-raise', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"single-leg-calf-raise"}]'::jsonb, '{}'::text[], 'lower_legs', 'dense', '["Bodyweight, floor.","Bodyweight, heel below a step or board.","Loaded, one dumbbell in the same-side hand."]'::jsonb, null, true, null),
  ('dense-bench-pullover', 28, 'Bench Pullover', '5 min, 25% bodyweight', '{"duration_min":5,"pct_bodyweight":0.25}'::jsonb, 'bent-arm-dumbbell-pullover', '[]'::jsonb, '{}'::text[], 'upper_body', 'dense', '["Along the bench.","Across the bench, hips low, for the full overhead stretch.","Toward 25% bodyweight."]'::jsonb, null, false, null),
  ('dense-atg-shoulder-press', 29, 'ATG Shoulder Press', '5 min, 50% bodyweight', '{"duration_min":5,"pct_bodyweight":0.5}'::jsonb, 'dumbbell-shoulder-press', '[]'::jsonb, '{}'::text[], 'upper_body', 'dense', '[]'::jsonb, null, false, null),
  ('dense-shoulder-external-rotation', 30, 'Shoulder External Rotation', '5 min, per side — Roughly 10% of bodyweight is the target; lighter is fine.', '{"duration_min":5}'::jsonb, 'external-rotation', '[{"equipment_missing":"cable_machine","note":"Home: band external rotation, elbow pinned to the side.","use_slug":"external-rotation-with-band"}]'::jsonb, '{}'::text[], 'upper_body', 'dense', '[]'::jsonb, null, true, null),
  ('dense-couch-stretch', 31, 'Couch Stretch', '60 s hold, per side', '{"hold_s":60}'::jsonb, 'couch-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'dense', '["Knee down, torso upright, hands on the floor.","Hands to the front thigh.","Hands to the hips.","Shoulders to the wall."]'::jsonb, null, true, null),
  ('dense-piriformis-stretch', 32, 'Piriformis Stretch', '60 s hold, per side', '{"hold_s":60}'::jsonb, 'seated-piriformis-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'dense', '[]'::jsonb, null, true, null),
  ('dense-butterfly-stretch', 33, 'Butterfly Stretch', '60 s hold', '{"hold_s":60}'::jsonb, 'butterfly-yoga-pose', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'dense', '[]'::jsonb, null, false, null),
  ('dense-vmo-squat', 34, 'VMO Squat', '10 × 10 reps, 10 min', '{"duration_min":10,"reps":10,"sets":10}'::jsonb, 'sissy-squat', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"sissy-squat"}]'::jsonb, '{}'::text[], 'knee_ability', 'dense', '["Bodyweight, heels elevated (weeks 1–2).","Goblet-held dumbbell at 5% bodyweight (week 3).","+5% bodyweight per week.","Bar on the back at 5% bodyweight from week 8."]'::jsonb, null, false, null),
  ('dense-kot-squat-eccentric', 35, 'KOT Squat (Eccentric)', '25 reps, 5 min', '{"duration_min":5,"reps":25}'::jsonb, 'sissy-squat', '[]'::jsonb, '{}'::text[], 'knee_ability', 'dense', '["Lower to a high surface and stand back up.","Lower to a progressively lower surface.","Full range to the floor, controlled the whole way down."]'::jsonb, null, false, null),
  ('dense-nordic-curl-eccentric', 36, 'Nordic Curl (Eccentric)', '25 reps, 5 min — Lowering phase only — no concentric.', '{"duration_min":5,"reps":25}'::jsonb, 'nordic-hamstring-curl', '[{"equipment_missing":"nordic_support","note":"Planet Fitness: seated leg curl machine.","use_slug":"seated-leg-curl"},{"equipment_missing":"nordic_support","note":"Travelling: reverse Nordic.","use_slug":"reverse-nordic"}]'::jsonb, '{}'::text[], 'posterior_chain', 'dense', '["Lowering only, hands catch.","Slower lowering.","Full reps down and up."]'::jsonb, null, false, null),
  ('dense-ql-extension', 37, 'QL Extension', '3 × 10 reps, per side', '{"reps":10,"sets":3}'::jsonb, 'ql-extension', '[{"equipment_missing":"back_extension_bench","note":"Neither gym has a back-extension bench: the seated good morning covers the same low-back standard.","use_slug":"seated-good-morning"}]'::jsonb, '{}'::text[], 'posterior_chain', 'dense', '["Bodyweight, short range.","Full range.","Holding a plate."]'::jsonb, null, true, null),
  ('standards-plantar-fascia-stretch', 38, 'Plantar Fascia Stretch', '2 min', '{"duration_min":2}'::jsonb, 'foot-smr', '[]'::jsonb, '{}'::text[], 'warm_up', 'standards', '[]'::jsonb, null, false, null),
  ('standards-tibialis-stretch', 39, 'Tibialis Stretch', '2 min', '{"duration_min":2}'::jsonb, 'posterior-tibialis-stretch', '[]'::jsonb, '{}'::text[], 'warm_up', 'standards', '[]'::jsonb, null, false, null),
  ('standards-bodyweight-walk', 40, 'Bodyweight Walk', '0.25 mile', '{"distance_mi":0.25}'::jsonb, 'zone-2-steady', '[{"equipment_missing":"outdoor_route","note":"Planet Fitness or bad weather: treadmill at an easy pace.","use_slug":"walking-treadmill"}]'::jsonb, '{}'::text[], 'warm_up', 'standards', '[]'::jsonb, null, false, null),
  ('standards-single-leg-elevated-pike', 41, 'Single-Leg Elevated Pike', '3 sets, 60 s hold, per side', '{"hold_s":60,"sets":3}'::jsonb, 'leg-up-hamstring-stretch', '[]'::jsonb, '{}'::text[], 'hip_flexors_core', 'standards', '[]'::jsonb, null, true, null),
  ('standards-poliquin-step-up', 42, 'Poliquin Step-Up', '5 × 20 reps, per side — BENCHMARK: 66% BW, heel elevated, 3-4" box.', '{"pct_bodyweight":0.66,"reps":20,"sets":5}'::jsonb, 'poliquin-step', '[{"equipment_missing":"plyo_box","note":"No 3–4 inch box at either gym: a stair or a stacked pair of plates is the rise; the Patrick Step is the regression until one exists.","use_slug":"patrick-step"},{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"poliquin-step"}]'::jsonb, '{}'::text[], 'knee_ability', 'standards', '["Bodyweight off a low rise.","Heel elevated on the board.","Loaded toward the 66%-bodyweight standard."]'::jsonb, null, true, null),
  ('standards-jefferson-curl', 43, 'Jefferson Curl', '5 × 10 reps — Loaded spinal flexion — check it against the standing low-back injury before prescribing. — BENCHMARK: 25% BW for 10 reps.', '{"pct_bodyweight":0.25,"reps":10,"sets":5}'::jsonb, 'jefferson-curl', '[{"equipment_missing":"barbell","note":"No barbell at either gym: a single heavy dumbbell held in both hands works to about 50 lb.","use_slug":"jefferson-curl"},{"equipment_missing":"plyo_box","note":"No box: stand on the slant board or the end of a flat bench so the hands can pass below the toes.","use_slug":"jefferson-curl"}]'::jsonb, '{}'::text[], 'posterior_chain', 'standards', '["Unloaded roll-down off a box.","Light bar.","Toward 25% bodyweight for 10 reps."]'::jsonb, null, false, null),
  ('standards-hanging-leg-raise', 44, 'Hanging Leg Raise', '3 × 10 reps — BENCHMARK: Toes to bar.', '{"reps":10,"sets":3}'::jsonb, 'hanging-leg-raise', '[{"equipment_missing":"pull_up_bar","note":"Planet Fitness has no free-hanging bar: the captain’s-chair or a bench leg pull-in is the substitute.","use_slug":"leg-pull-in"}]'::jsonb, '{}'::text[], 'hip_flexors_core', 'standards', '["Bent-knee raise.","Straight-leg raise to horizontal.","Toes to bar."]'::jsonb, null, false, null),
  ('standards-tibialis-raise', 45, 'Tibialis Raise', '3 × 20 reps', '{"reps":20,"sets":3}'::jsonb, 'tibialis-raise', '[{"equipment_missing":"wall_space","note":"No wall to lean on: anchor a band low in front and loop it over the forefoot.","use_slug":"tibialis-raise-band"},{"equipment_missing":"tibialis_bar","note":"No tib bar at either gym: stand a dumbbell on end and pinch it between the feet.","use_slug":"tibialis-raise-dumbbell"}]'::jsonb, '{}'::text[], 'lower_legs', 'standards', '["Stand closer to the wall — less load, easier.","Step farther from the wall — more load, harder.","Add load: a dumbbell held between the feet, or a band over the forefoot.","Tib bar, once one is available."]'::jsonb, null, false, null),
  ('standards-incline-dumbbell-press', 46, 'Incline Dumbbell Press', '4 × 10 reps', '{"reps":10,"sets":4}'::jsonb, 'incline-dumbbell-press', '[]'::jsonb, '{}'::text[], 'upper_body', 'standards', '[]'::jsonb, null, false, null),
  ('standards-trx-face-pull', 47, 'TRX Face Pull', '4 × 10 reps', '{"reps":10,"sets":4}'::jsonb, 'face-pull', '[{"equipment_missing":"suspension_trainer","note":"Neither location has a TRX: Planet Fitness has the cable face pull; at home use a band anchored at head height.","use_slug":"face-pull"}]'::jsonb, '{}'::text[], 'upper_body', 'standards', '[]'::jsonb, null, false, null),
  ('standards-pigeon', 48, 'Pigeon', '90 s hold, per side', '{"hold_s":90}'::jsonb, 'seated-piriformis-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'standards', '[]'::jsonb, null, true, null),
  ('standards-couch-stretch', 49, 'Couch Stretch', '90 s hold, per side', '{"hold_s":90}'::jsonb, 'couch-stretch', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'standards', '["Knee down, torso upright, hands on the floor.","Hands to the front thigh.","Hands to the hips.","Shoulders to the wall."]'::jsonb, null, true, null),
  ('standards-calf-stretch', 50, 'Calf Stretch', '60 s hold', '{"hold_s":60}'::jsonb, 'standing-calves-calf-stretch', '[]'::jsonb, '{}'::text[], 'warm_up', 'standards', '[]'::jsonb, null, false, null),
  ('standards-relaxed-lunge', 51, 'Relaxed Lunge', '3 sets, 60 s hold, per side', '{"hold_s":60,"sets":3}'::jsonb, 'kneeling-hip-flexor', '[]'::jsonb, '{}'::text[], 'knee_ability', 'standards', '[]'::jsonb, null, true, null),
  ('standards-atg-split-squat', 52, 'ATG Split Squat', '5 × 5 reps, per side — BENCHMARK: 25% BW per hand.', '{"pct_bodyweight":0.25,"per_hand":true,"reps":5,"sets":5}'::jsonb, 'atg-split-squat', '[{"equipment_missing":"adjustable_dumbbell","note":"Travelling: bodyweight, or a loaded backpack.","use_slug":"atg-split-squat"}]'::jsonb, '{}'::text[], 'knee_ability', 'standards', '["Front foot elevated, holding a rail for assistance.","Front foot elevated, no hands.","Flat ground, no hands, back knee to the floor.","Dumbbells in both hands, toward 25% bodyweight per hand."]'::jsonb, null, true, 30),
  ('standards-seated-good-morning', 53, 'Seated Good Morning', '5 × 10 reps — BENCHMARK: 50% BW, abs to bench.', '{"pct_bodyweight":0.5,"reps":10,"sets":5}'::jsonb, 'seated-good-morning', '[{"equipment_missing":"barbell","note":"Neither gym has a barbell: Planet Fitness has the Smith machine and a seated good-morning lever.","use_slug":"lever-seated-good-morning"},{"equipment_missing":"barbell","note":"Home: hold a single heavy dumbbell at the chest and hinge from the hips.","use_slug":"seated-good-mornings"}]'::jsonb, '{}'::text[], 'posterior_chain', 'standards', '["Bodyweight hinge, hands behind the head.","Light bar.","Toward 50% bodyweight, abs to the bench."]'::jsonb, null, false, null),
  ('standards-garhammer-raise', 54, 'Garhammer Raise', '3 × 10 reps — BENCHMARK: 10 reps, Level 2.', '{"reps":10,"sets":3}'::jsonb, 'hanging-oblique-knee-raise', '[{"equipment_missing":"pull_up_bar","note":"Planet Fitness: captain’s chair or bench leg pull-in.","use_slug":"leg-pull-in"}]'::jsonb, '{}'::text[], 'hip_flexors_core', 'standards', '["Level 1 — knees to 90°, short pull.","Level 2 — from 90°, curl the knees higher toward the chest for 10 reps."]'::jsonb, null, false, null),
  ('standards-single-leg-calf-raise', 55, 'Single-Leg Calf Raise', '3 × 10 reps, per side — BENCHMARK: 25% BW, 10 reps.', '{"pct_bodyweight":0.25,"reps":10,"sets":3}'::jsonb, 'single-leg-calf-raise', '[{"equipment_missing":"slant_board","note":"Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.","use_slug":"single-leg-calf-raise"}]'::jsonb, '{}'::text[], 'lower_legs', 'standards', '["Bodyweight, floor.","Bodyweight, heel below a step or board.","Loaded — the benchmark is 25% bodyweight for 10 reps."]'::jsonb, null, true, null),
  ('standards-atg-dips', 56, 'ATG Dips', '4 × 12 reps', '{"reps":12,"sets":4}'::jsonb, 'chest-dip', '[{"equipment_missing":"dip_station","note":"Neither location has a dip station: bench dips, accepting the shorter range.","use_slug":"bench-dips"}]'::jsonb, '{}'::text[], 'upper_body', 'standards', '["Partial depth.","Full depth, shoulder below elbow.","Weighted."]'::jsonb, null, false, null),
  ('standards-shoulder-external-rotation', 57, 'Shoulder External Rotation', '4 × 12 reps, per side', '{"reps":12,"sets":4}'::jsonb, 'external-rotation', '[{"equipment_missing":"cable_machine","note":"Home: band external rotation, elbow pinned to the side.","use_slug":"external-rotation-with-band"}]'::jsonb, '{}'::text[], 'upper_body', 'standards', '[]'::jsonb, null, true, null),
  ('standards-butterfly-stretch', 58, 'Butterfly Stretch', '2 min', '{"duration_min":2}'::jsonb, 'butterfly-yoga-pose', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'standards', '[]'::jsonb, null, false, null),
  ('standards-seated-pancake', 59, 'Seated Pancake', '2 min', '{"duration_min":2}'::jsonb, 'the-straddle', '[]'::jsonb, '{}'::text[], 'mobility_cooldown', 'standards', '[]'::jsonb, null, false, null),
  ('standards-atg-squat', 60, 'ATG Squat', '5 × 20 reps — BENCHMARK: 25% BW, 20 reps.', '{"pct_bodyweight":0.25,"reps":20,"sets":5}'::jsonb, 'atg-squat', '[]'::jsonb, '{}'::text[], 'knee_ability', 'standards', '["Bodyweight to full depth.","Goblet-held load.","Toward 25% bodyweight for 20 reps."]'::jsonb, null, false, null),
  ('standards-nordic-curl', 61, 'Nordic Curl', '5 × 10 reps — BENCHMARK: 10 full reps (no hands).', '{"reps":10,"sets":5}'::jsonb, 'nordic-hamstring-curl', '[{"equipment_missing":"nordic_support","note":"Planet Fitness has no GHD and nothing safe to anchor the ankles under: run the seated leg curl machine instead.","use_slug":"seated-leg-curl"},{"equipment_missing":"nordic_support","note":"Travelling: reverse Nordic needs no anchor and keeps the eccentric quality.","use_slug":"reverse-nordic"}]'::jsonb, '{}'::text[], 'posterior_chain', 'standards', '["Lower a short way, hands catch early.","Lower farther each week, hands catch late.","Full lower, push back up with the hands.","Full rep down and up, no hands — the standard is 10."]'::jsonb, null, false, null),
  ('standards-low-cable-pull-in', 62, 'Low Cable Pull-In', '3 × 20 reps, per side — BENCHMARK: 50% BW, 20 reps.', '{"pct_bodyweight":0.5,"reps":20,"sets":3}'::jsonb, 'leg-pull-in', '[{"equipment_missing":"cable_machine","note":"Home has no cable stack: a band anchored low at the ankle is the substitute, and the 50%-bodyweight standard is not reachable there.","use_slug":"leg-pull-in"}]'::jsonb, '{}'::text[], 'hip_flexors_core', 'standards', '["Bodyweight leg pull-in.","Light cable.","Toward 50% bodyweight for 20 reps."]'::jsonb, null, true, null),
  ('standards-atg-shoulder-press', 63, 'ATG Shoulder Press', '4 × 10 reps', '{"reps":10,"sets":4}'::jsonb, 'dumbbell-shoulder-press', '[]'::jsonb, '{}'::text[], 'upper_body', 'standards', '[]'::jsonb, null, false, null),
  ('standards-chin-up', 64, 'Chin-Up', '4 × 10 reps', '{"reps":10,"sets":4}'::jsonb, 'chin-up', '[{"equipment_missing":"pull_up_bar","note":"Planet Fitness has no free bar: the assisted pull-up machine.","use_slug":"assisted-standing-chin-up"},{"equipment_missing":"pull_up_bar","note":"Planet Fitness alternative: lat pulldown.","use_slug":"cable-bar-lateral-pulldown"}]'::jsonb, '{}'::text[], 'upper_body', 'standards', '["Band- or machine-assisted.","Bodyweight.","Weighted."]'::jsonb, null, false, null),
  ('standards-atg-deadlift', 65, 'ATG Deadlift', '5 × 10 reps — BENCHMARK: 100% BW, 10 reps.', '{"pct_bodyweight":1,"reps":10,"sets":5}'::jsonb, 'barbell-deadlift', '[{"equipment_missing":"barbell","note":"Planet Fitness has no barbell and does not allow floor deadlifts: the Smith machine is the only route there.","use_slug":"smith-deadlift"},{"equipment_missing":"barbell","note":"Home tops out at 52.5 lb per hand — the ATG RDL with dumbbells is the stand-in, well short of the 100%-bodyweight standard.","use_slug":"atg-rdl"}]'::jsonb, '{}'::text[], 'posterior_chain', 'standards', '["Partial range from blocks.","Floor.","Standing on a platform for extra range.","Toward 100% bodyweight for 10 reps."]'::jsonb, null, false, null),
  ('standards-sissy-squat', 66, 'Sissy Squat', '5 × 20 reps', '{"reps":20,"sets":5}'::jsonb, 'sissy-squat', '[]'::jsonb, '{}'::text[], 'knee_ability', 'standards', '["One-arm assisted.","Free-standing.","Loaded."]'::jsonb, null, false, null),
  ('standards-l-sit', 67, 'L-Sit', '3 sets, 15 s hold', '{"hold_s":15,"sets":3}'::jsonb, 'l-sit', '[]'::jsonb, '{}'::text[], 'hip_flexors_core', 'standards', '["Level 1 — alternate lifting one leg at a time, seated, for the full time.","Level 2 — same, with the hips off the floor.","Level 3 — full L-sit, both legs and hips off the floor."]'::jsonb, null, false, null),
  ('standards-bench-pullover', 68, 'Bench Pullover', '4 × 10 reps — BENCHMARK: 25% BW.', '{"pct_bodyweight":0.25,"reps":10,"sets":4}'::jsonb, 'bent-arm-dumbbell-pullover', '[]'::jsonb, '{}'::text[], 'upper_body', 'standards', '["Along the bench.","Across the bench, hips low, for the full overhead stretch.","Toward 25% bodyweight."]'::jsonb, null, false, null),
  ('standards-trap-raise', 69, 'Trap Raise', '4 × 10 reps', '{"reps":10,"sets":4}'::jsonb, 'dumbbell-shrug', '[]'::jsonb, '{}'::text[], 'upper_body', 'standards', '[]'::jsonb, null, false, null);

-- (a) Retire steps the source file no longer has, so a renamed step cannot
--     leave an orphan behind that the planner might still schedule.
delete from public.program_steps s
using public.programs p
where p.slug = 'kot' and p.user_id is null and s.program_id = p.id
  and s.step_key not in (select step_key from kot_incoming);

-- (b) Park every surviving step far above the range being written. step_order
--     is unique per program, so a step that moved would collide with whatever
--     is currently sitting where it is going. Parking NEGATIVE would be the
--     obvious trick and is not available: 0001 constrains step_order >= 0.
update public.program_steps s
set step_order = s.step_order + 1000000
from public.programs p
where p.slug = 'kot' and p.user_id is null and s.program_id = p.id
  and s.step_order < 1000000;

-- (c) Now the real orders are all free.
insert into public.program_steps
  (user_id, program_id, step_key, step_order, name, standard_text, standard,
   exercise_slug, substitutions, prerequisites, block, phase_id, progressions,
   demo_url, per_side, rest_s)
select null, p.id, i.step_key, i.step_order, i.name, i.standard_text, i.standard,
       i.exercise_slug, i.substitutions, i.prerequisites, i.block, i.phase_id,
       i.progressions, i.demo_url, i.per_side, i.rest_s
from kot_incoming i
cross join public.programs p
where p.slug = 'kot' and p.user_id is null
on conflict (program_id, step_key) do update set
  step_order    = excluded.step_order,
  name          = excluded.name,
  standard_text = excluded.standard_text,
  standard      = excluded.standard,
  exercise_slug = excluded.exercise_slug,
  substitutions = excluded.substitutions,
  prerequisites = excluded.prerequisites,
  block         = excluded.block,
  phase_id      = excluded.phase_id,
  progressions  = excluded.progressions,
  demo_url      = excluded.demo_url,
  per_side      = excluded.per_side,
  rest_s        = excluded.rest_s,
  updated_at    = now();

drop table if exists kot_incoming;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Assertions
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything above is a bulk statement. If one of them silently did nothing,
-- the planner would schedule a program with holes in it rather than fail. So
-- the counts are checked, here, while the transaction can still be rolled back.

do $$
declare
  v_program uuid;
  v_steps   integer;
  v_phases  integer;
  v_days    integer;
  v_orphan  text;
begin
  select id, jsonb_array_length(phases), jsonb_array_length(days)
    into v_program, v_phases, v_days
  from public.programs where slug = 'kot' and user_id is null;

  if v_program is null then
    raise exception 'the kot program did not seed';
  end if;

  select count(*) into v_steps from public.program_steps where program_id = v_program;

  if v_steps <> 69 then
    raise exception 'kot: expected 69 steps, found %', v_steps;
  end if;
  if v_phases <> 3 then
    raise exception 'kot: expected 3 phases, found %', v_phases;
  end if;
  if v_days <> 12 then
    raise exception 'kot: expected 12 weekday templates, found %', v_days;
  end if;

  -- Every step must name a phase the program actually declares, and every
  -- weekday template must reference steps that exist. A dangling step_id here
  -- is a blank slot in a real session.
  select string_agg(distinct s.phase_id, ', ') into v_orphan
  from public.program_steps s
  join public.programs p on p.id = s.program_id
  where s.program_id = v_program
    and s.phase_id is not null
    and not (s.phase_id = any (public.program_phase_ids(p.phases)));

  if v_orphan is not null then
    raise exception 'kot: steps reference undeclared phases: %', v_orphan;
  end if;

  select string_agg(distinct t.step_id, ', ') into v_orphan
  from public.programs p
  cross join lateral jsonb_array_elements(p.days) as d
  cross join lateral jsonb_array_elements(d->'blocks') as b
  cross join lateral jsonb_array_elements_text(b->'step_ids') as t(step_id)
  where p.id = v_program
    and not exists (
      select 1 from public.program_steps s
      where s.program_id = v_program and s.step_key = t.step_id
    );

  if v_orphan is not null then
    raise exception 'kot: weekday templates reference unknown steps: %', v_orphan;
  end if;

  raise notice 'kot: % steps, % phases, % weekday templates', v_steps, v_phases, v_days;
end $$;

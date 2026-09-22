/**
 * Longevity OS — Knees Over Toes ingest
 *
 *   npx tsx scripts/ingest-kot.ts
 *
 * Reads Seth's OWN Knees Over Toes material out of `docs/programs/kot/raw/`
 * (gitignored: it is copyrighted ATG product, it stays on his machine) and
 * regenerates three committed artifacts from it:
 *
 *   programs/kot/program.json          the three-phase program
 *   programs/kot/seth-baseline.json    his last-known working weights
 *   programs/kot/progress-default.json the cold-start progress record
 *   data/reports/kot-reconciliation.md what changed, and what is still missing
 *
 * WHAT CROSSES THE LINE AND WHAT DOES NOT
 *   Facts cross: exercise names, order, sets, reps, hold durations, %-of-
 *   bodyweight criteria, weekday grouping, phase lengths, demo links.
 *   Prose does not: no coaching cue, no explanation, no illustration from the
 *   ATG material is copied into a committed file. The "Notes" column of the
 *   checklist and the narrative body of the book are never read into the
 *   output. Every human-readable sentence in the generated files is written
 *   here, in this script.
 *
 * HOW THE PARSING WORKS
 *   The sources are .docx and .xlsx. Rather than add an npm dependency (the
 *   repo's rule is $0/month and no new deps), the structural extraction is done
 *   by a short Python program — embedded below as `EXTRACTOR_PY` — that runs on
 *   the python3 already present with `python-docx` and `openpyxl`. It emits one
 *   JSON document of pure structure; everything after that is TypeScript.
 *
 * WHAT THIS SCRIPT SUPPLIES THAT THE SOURCES DO NOT
 *   Seth's sheets name movements the way a coach says them out loud ("Pat Step
 *   25", "SL Calf Raise"). They carry no exercise ids, no equipment vocabulary
 *   and no substitutions. `STEP_SPECS` below is the curated bridge: raw name →
 *   library slug, program block, required equipment, progression ladder and
 *   location substitutions. It is hand-written and reviewable; the reps and the
 *   ordering around it are not.
 *
 * WHEN THE RAW DIRECTORY IS EMPTY
 *   That is a normal state on a fresh clone — the sources are gitignored. The
 *   script says so, touches nothing, and exits 0.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EQUIPMENT } from '../packages/engine/src/types';
import type {
  Equipment,
  Exercise,
  GymLocation,
  PhaseLoadRule,
  Program,
  ProgramDay,
  ProgramPhase,
  ProgramProgress,
  ProgramStandard,
  ProgramStep,
} from '../packages/engine/src/types';
import { BODYWEIGHT_ONLY, HOME, PLANET_FITNESS } from '../packages/engine/fixtures/library';
import { PATHS, readJson, writeJson, writeText } from './lib/paths';

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

const RAW_DIR = PATHS.kotRawDir;
const PROGRAM_FILE = PATHS.kotProgram;
const BASELINE_FILE = path.join(PATHS.programsDir, 'kot', 'seth-baseline.json');
const PROGRESS_FILE = path.join(PATHS.programsDir, 'kot', 'progress-default.json');
const REPORT_FILE = PATHS.kotReconciliationReport;

/** Files that are scaffolding, not source material. */
const IGNORED_RAW = new Set(['.gitkeep', 'README.md', '.DS_Store']);

// ─────────────────────────────────────────────────────────────────────────────
// The Python fact extractor (structure only — never prose)
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTOR_PY = String.raw`
"""Structure extractor for the ATG / Knees Over Toes raw sources.

Emits one JSON document on stdout: exercise names, rep and set counts, ordering,
%BW criteria, weekday grouping, hyperlinks. The narrative columns are dropped
here so the TypeScript side never even sees them.
"""
import json
import os
import re
import sys

RAW = sys.argv[1]

try:
    import docx  # python-docx
    import openpyxl
except BaseException as exc:
    print(json.dumps({"error": "missing_python_dep", "detail": str(exc)}))
    sys.exit(0)

from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

DASHES = dict.fromkeys(map(ord, "–—‒−"), "-")


def clean(s):
    if s is None:
        return ""
    s = str(s).replace(" ", " ").translate(DASHES)
    s = s.replace("“", '"').replace("”", '"').replace("’", "'")
    return re.sub(r"[ \t]+", " ", s).strip()


def flat(s):
    return re.sub(r"\s+", " ", clean(s)).strip()


def blocks(doc):
    for child in doc.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield "p", Paragraph(child, doc)
        elif isinstance(child, CT_Tbl):
            yield "t", Table(child, doc)


def parse_checklist(path):
    doc = docx.Document(path)
    phases, benchmarks, current, heading = [], [], None, None
    for kind, blk in blocks(doc):
        if kind == "p":
            txt = flat(blk.text)
            if not txt:
                continue
            m = re.match(r"^Phase (\d+):\s*(.+)$", txt)
            if m:
                current = {
                    "index": int(m.group(1)),
                    "label": txt,
                    "key": re.sub(r"[^a-z]", "", m.group(2).lower().split()[0]),
                    "meta": {},
                    "days": [],
                    "weeks_tracked": None,
                }
                phases.append(current)
            else:
                heading = txt
            continue

        rows = [[clean(c.text) for c in row.cells] for row in blk.rows]
        if not rows:
            continue
        # A phase header is one merged cell of "Field: value" lines. Check it
        # BEFORE the benchmark table, because the Standards phase header happens
        # to contain the word "Benchmark".
        if current is not None and len(rows) == 1 and len(set(rows[0])) == 1:
            lines = [clean(x) for x in rows[0][0].split("\n") if clean(x)]
            if lines:
                current["meta"]["title"] = flat(lines[0])
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    current["meta"][flat(k)] = flat(v)
            continue
        if len(rows) > 1 and "BENCHMARKS" in rows[0][0].upper():
            for r in rows[1:]:
                cells = [c for c in r if c and c != "☐"]
                if len(cells) >= 2:
                    benchmarks.append({"name": flat(cells[0]), "criteria": flat(cells[1])})
            continue
        if current is None:
            continue
        if rows[0] and rows[0][0].lower() == "week":
            current["weeks_tracked"] = len(rows[0]) - 1
            continue
        if len(rows[0]) >= 3 and "exercise" in rows[0][1].lower():
            day = None
            for r in rows[1:]:
                if len(set(r)) == 1:
                    day = {"label": flat(r[0]), "rows": []}
                    current["days"].append(day)
                    continue
                if day is None:
                    day = {"label": flat(heading or "Daily"), "rows": []}
                    current["days"].append(day)
                name = flat(r[1]) if len(r) > 1 else ""
                if name:
                    day["rows"].append(
                        {"name": name, "prescription": flat(r[2]) if len(r) > 2 else ""}
                    )
    return {"phases": phases, "benchmarks": benchmarks}


def parse_grid(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    out = {}
    for ws in wb.worksheets:
        grid = []
        for row in ws.iter_rows(values_only=True):
            cells = [clean(c) for c in row]
            while cells and cells[-1] == "":
                cells.pop()
            grid.append(cells)
        while grid and not any(grid[-1]):
            grid.pop()
        out[ws.title] = grid
    return out


def parse_links(path):
    wb = openpyxl.load_workbook(path)
    out = {}
    for ws in wb.worksheets:
        found = []
        for row in ws.iter_rows():
            for c in row:
                if c.hyperlink is not None and c.hyperlink.target:
                    found.append(
                        {
                            "cell": c.coordinate,
                            "column": c.column,
                            "row": c.row,
                            "text": flat(c.value),
                            "url": c.hyperlink.target,
                        }
                    )
        out[ws.title] = found
    return out


def parse_book(path):
    """Only the closing recap list: 'Step N: Name: prescription'."""
    try:
        import pypdf
    except BaseException:
        # pypdf imports the "cryptography" package only to open ENCRYPTED PDFs,
        # and a mismatched build of it aborts the whole import. Nothing here is
        # encrypted, so stub the module out and let pypdf take its own fallback
        # path rather than lose the book entirely.
        for mod in ("cryptography", "cryptography.exceptions", "cryptography.hazmat"):
            sys.modules[mod] = None
        for mod in [m for m in list(sys.modules) if m.startswith("pypdf")]:
            del sys.modules[mod]
        try:
            import pypdf
        except BaseException as exc:
            return {"available": False, "reason": str(exc)[:200], "steps": []}
    try:
        reader = pypdf.PdfReader(path)
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
    except BaseException as exc:
        return {"available": False, "reason": str(exc)[:200], "steps": []}
    steps = []
    for m in re.finditer(r"^Step (\d+[A-Z]?):\s*([^:\n]+):\s*([^\n]+)$", text, re.M):
        steps.append(
            {"step": m.group(1), "name": flat(m.group(2)), "prescription": flat(m.group(3))}
        )
    return {"available": True, "steps": steps}


def find(prefix, suffix):
    for f in sorted(os.listdir(RAW)):
        if f.lower().startswith(prefix.lower()) and f.lower().endswith(suffix):
            return os.path.join(RAW, f)
    return None


checklist = find("ATG_Workout_Checklist", ".docx")
workouts = find("ATG_Workouts", ".xlsx")
links = find("YouTube_Links", ".xlsx")
book = find("Knee_Ability_Zero_-_5", ".pdf")

result = {
    "error": None,
    "files": sorted(f for f in os.listdir(RAW) if not f.startswith(".")),
    "found": {
        "checklist": os.path.basename(checklist) if checklist else None,
        "workouts": os.path.basename(workouts) if workouts else None,
        "youtube": os.path.basename(links) if links else None,
        "book": os.path.basename(book) if book else None,
    },
    "checklist": parse_checklist(checklist) if checklist else None,
    "workouts": parse_grid(workouts) if workouts else None,
    "youtube_grids": parse_grid(links) if links else None,
    "youtube_links": parse_links(links) if links else None,
    "book": parse_book(book) if book else {"available": False, "steps": []},
}

json.dump(result, sys.stdout, ensure_ascii=False, sort_keys=True)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Shapes the extractor hands back
// ─────────────────────────────────────────────────────────────────────────────

interface RawRow {
  name: string;
  prescription: string;
}
interface RawDay {
  label: string;
  rows: RawRow[];
}
interface RawPhase {
  index: number;
  label: string;
  key: string;
  meta: Record<string, string>;
  days: RawDay[];
  weeks_tracked: number | null;
}
interface RawLink {
  cell: string;
  column: number;
  row: number;
  text: string;
  url: string;
}
interface Extracted {
  error: string | null;
  detail?: string;
  files: string[];
  found: Record<string, string | null>;
  checklist: { phases: RawPhase[]; benchmarks: { name: string; criteria: string }[] } | null;
  workouts: Record<string, string[][]> | null;
  youtube_grids: Record<string, string[][]> | null;
  youtube_links: Record<string, RawLink[]> | null;
  book: { available: boolean; reason?: string; steps: { step: string; name: string; prescription: string }[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// The curated bridge: raw movement name → engine vocabulary
// ─────────────────────────────────────────────────────────────────────────────

interface Substitution {
  equipment_missing: Equipment;
  use_slug: string;
  note: string;
}

interface StepSpec {
  /** Display name written here, not lifted from the source. */
  name: string;
  /** Exercise library slug this step resolves to. */
  slug: string;
  /** Program block id. */
  block: string;
  /**
   * Phase id → block id, when the same movement sits in a different part of the
   * session in different phases. The tibialis stretch is a cool-down in Dense
   * and a warm-up in Standards.
   */
  block_by_phase?: Record<string, string>;
  /** Equipment the canonical prescription needs (bodyweight is implicit). */
  equipment: Equipment[];
  /** Merged on top of whatever the prescription string yields. */
  standard?: ProgramStandard;
  per_side?: boolean;
  rest_s?: number;
  /**
   * Per-step override of the phase's `percent_bw_ramp`. Dense adds 5% of
   * bodyweight a week "except the split squat, which adds 2.5%" — a sentence in
   * the phase's prose that nothing could act on until `ProgramStep` had
   * somewhere to put it. Whole-number percentages, matching `PhaseLoadRule`.
   */
  load_ramp_override?: { start_pct?: number; weekly_increment_pct?: number };
  progressions?: string[];
  substitutions?: Substitution[];
  /**
   * Set when the exercise library has no true record for this movement and
   * `slug` is the nearest usable stand-in. Drives the reconciliation report.
   */
  library_gap?: string;
  /** Extra sentence appended to `standard_text`. Written here, not copied. */
  note?: string;
}

const BLOCKS = [
  { id: 'warm_up', name: 'Warm-Up', order: 1, note: 'Walking and the foot/ankle prep that precedes every session.' },
  { id: 'lower_legs', name: 'Lower Legs', order: 2, note: 'Tibialis and calves. Always before anything loads the knee from above.' },
  { id: 'knee_ability', name: 'Knee Ability', order: 3, note: 'Step-ups, split squats and squats — the knees-over-toes work itself.' },
  { id: 'posterior_chain', name: 'Posterior Chain & Spine', order: 4, note: 'Hamstrings, low back and the loaded spinal flexion work.' },
  { id: 'hip_flexors_core', name: 'Hip Flexors & Core', order: 5, note: 'L-sits, hanging work and the low-cable hip-flexor pull.' },
  { id: 'upper_body', name: 'Upper Body', order: 6, note: 'Pressing, pulling and shoulder health. Comes after the lower-body sequence.' },
  { id: 'mobility_cooldown', name: 'Mobility & Cool-Down', order: 7, note: 'Held stretches. Closes every session.' },
];

/**
 * `use_slug` on a substitution normally names a DIFFERENT exercise. The
 * slant-board fallback is not a different exercise — it is the same movement on
 * the floor — so it is written as this sentinel and resolved to the step's own
 * slug when the step is built.
 */
const SAME_MOVEMENT = '__same_movement__';

const SLANT_SUB: Substitution[] = [
  {
    equipment_missing: 'slant_board',
    use_slug: SAME_MOVEMENT,
    note: 'Seth owns a slant board, so the slant version is the prescription at home. Travelling or at Planet Fitness: the same movement off a stair edge or a stack of plates, accepting the shorter range.',
  },
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/**
 * Rows on Seth's sheets that name two or three movements at once. Each expands
 * into separate steps so the engine can schedule, swap and log them apart.
 */
const COMBOS: Record<string, { key: string; prescription: string }[]> = {
  'chin up dip superset': [
    { key: 'chin up', prescription: '5 min AMRAP' },
    { key: 'dips', prescription: '5 min AMRAP' },
  ],
  'smith curl french press': [
    { key: 'smith curl', prescription: '5 min' },
    { key: 'french press', prescription: '5 min' },
  ],
  'bench pullover shoulder press': [
    { key: 'bench pullover', prescription: '5 min 25% BW' },
    { key: 'atg shoulder press', prescription: '5 min 50% BW' },
  ],
  'pigeon couch stretch': [
    { key: 'pigeon', prescription: '90 sec/side' },
    { key: 'couch stretch', prescription: '90 sec/side' },
  ],
  'calf stretch bw walk': [
    { key: 'calf stretch', prescription: '60 sec' },
    { key: 'bw walk', prescription: '0.25 mile' },
  ],
  'pigeon butterfly pancake': [
    { key: 'pigeon', prescription: '90 sec/side' },
    { key: 'butterfly stretch', prescription: '2 min' },
    { key: 'seated pancake', prescription: '2 min' },
  ],
};

const STEP_SPECS: Record<string, StepSpec> = {
  // ── Warm-up ────────────────────────────────────────────────────────────────
  'bw walk warm up': {
    name: 'Bodyweight Walk (Warm-Up)',
    slug: 'zone-2-steady',
    block: 'warm_up',
    equipment: ['outdoor_route'],
    library_gap: 'A plain easy-pace walk. The library has treadmill walking and generic Zone-2 cardio, but no "walk, any surface, easy pace" record.',
    substitutions: [
      { equipment_missing: 'outdoor_route', use_slug: 'walking-treadmill', note: 'Planet Fitness or bad weather: treadmill at an easy pace.' },
    ],
    note: 'Easy pace, not a training stimulus.',
  },
  'bw walk': {
    name: 'Bodyweight Walk',
    slug: 'zone-2-steady',
    block: 'warm_up',
    equipment: ['outdoor_route'],
    library_gap: 'Same gap as the warm-up walk: no plain "walk" record in the library.',
    substitutions: [
      { equipment_missing: 'outdoor_route', use_slug: 'walking-treadmill', note: 'Planet Fitness or bad weather: treadmill at an easy pace.' },
    ],
  },

  // ── Backward locomotion ────────────────────────────────────────────────────
  // Neither of these is on any sheet of Seth's; both are here because he said
  // so out loud (2026-09-22). `SETH_CONFIRMED_ROWS` is what schedules them —
  // there is no source row for the loop below to match. Every number comes from
  // RESEARCH §7, which is the only written prescription either movement has.
  'backward walk': {
    name: 'Backward Walking',
    slug: 'backward-walk-outdoors',
    block: 'warm_up',
    equipment: ['outdoor_route'],
    progressions: [
      'Flat ground, hands free, glancing over alternating shoulders.',
      'A shallow incline — a ramp or a gentle hill.',
      'Weight vest, or a backpack.',
      'Backward sled drag, wherever there is a sled.',
    ],
    substitutions: [
      // The belt stays OFF and he drives it himself. A powered belt running
      // backwards under him is a different — and worse — exercise, so the note
      // has to say which one this is. RESEARCH §2.
      {
        equipment_missing: 'outdoor_route',
        use_slug: 'backward-treadmill-walk',
        note: 'Planet Fitness or bad weather: the same walk on a treadmill with the belt POWERED OFF, driving the belt by foot.',
      },
    ],
    note: 'The method’s knee entry point, and the one movement of Seth’s that runs in every session.',
  },
  'backward sled drag': {
    name: 'Backward Sled Drag',
    slug: 'backward-sled-drag',
    block: 'warm_up',
    equipment: ['sled'],
    progressions: [
      'Backward walking, unloaded, on flat ground.',
      'Sled at roughly 50% of bodyweight for 10 minutes.',
      'More load, same 10 minutes.',
    ],
    substitutions: [
      // Ordered by which gym has what: the club has treadmills and no sled, the
      // house has neither but opens onto a street. Both land on backward
      // walking, which is the point — the sled is the version he gets when a
      // sled happens to be there.
      {
        equipment_missing: 'sled',
        use_slug: 'backward-treadmill-walk',
        note: 'No sled at Planet Fitness: backward walking on a treadmill with the belt POWERED OFF.',
      },
      {
        equipment_missing: 'sled',
        use_slug: 'backward-walk-outdoors',
        note: 'No sled and no treadmill at home: backward walking outdoors, unloaded.',
      },
    ],
    note: 'Neither of Seth’s gyms owns a sled, so this resolves to backward walking most weeks; the load is what it becomes when one is available.',
  },

  'plantar fascia stretch': {
    name: 'Plantar Fascia Stretch',
    slug: 'foot-smr',
    block: 'warm_up',
    equipment: ['bodyweight'],
    library_gap: 'No plantar-fascia stretch in the library. `foot-smr` is a ball roll of the same tissue — related, not the same drill.',
  },
  'tibialis stretch': {
    name: 'Tibialis Stretch',
    slug: 'posterior-tibialis-stretch',
    block: 'warm_up',
    block_by_phase: { dense: 'mobility_cooldown' },
    equipment: ['bodyweight', 'yoga_mat'],
    library_gap: 'The prescribed stretch is ANTERIOR tibialis (kneel and sit back on the heels). The library only has a posterior-tibialis stretch and an anterior-tibialis SMR — neither is the drill.',
  },
  'calf stretch': {
    name: 'Calf Stretch',
    slug: 'standing-calves-calf-stretch',
    block: 'warm_up',
    equipment: ['bodyweight', 'wall_space'],
  },

  // ── Lower legs ─────────────────────────────────────────────────────────────
  'tibialis raise': {
    name: 'Tibialis Raise',
    slug: 'tibialis-raise',
    block: 'lower_legs',
    equipment: ['bodyweight', 'wall_space'],
    progressions: [
      'Stand closer to the wall — less load, easier.',
      'Step farther from the wall — more load, harder.',
      'Add load: a dumbbell held between the feet, or a band over the forefoot.',
      'Tib bar, once one is available.',
    ],
    substitutions: [
      { equipment_missing: 'wall_space', use_slug: 'tibialis-raise-band', note: 'No wall to lean on: anchor a band low in front and loop it over the forefoot.' },
      { equipment_missing: 'tibialis_bar', use_slug: 'tibialis-raise-dumbbell', note: 'No tib bar at either gym: stand a dumbbell on end and pinch it between the feet.' },
    ],
  },
  'calf raise slant board': {
    name: 'Calf Raise (Slant Board)',
    slug: 'fhl-calf-raise',
    block: 'lower_legs',
    equipment: ['slant_board'],
    progressions: [
      'Both feet, full range: heels below the platform at the bottom.',
      'One leg at a time (wrap the free leg behind).',
      'Add a weight vest or hold a dumbbell.',
    ],
    substitutions: SLANT_SUB,
    library_gap: 'No slant-board calf raise. `fhl-calf-raise` is the same muscle intent (press through the big toe, deep bottom stretch) without the board.',
  },
  'slant board calf raises': {
    name: 'Slant Board Calf Raise (Loaded)',
    slug: 'fhl-calf-raise',
    block: 'lower_legs',
    equipment: ['slant_board', 'adjustable_dumbbell'],
    progressions: ['Bodyweight both feet.', 'Bodyweight one leg.', 'Loaded one leg.'],
    substitutions: SLANT_SUB,
    library_gap: 'Same gap as the Zero slant-board calf raise, with load added.',
  },
  'kot calf raise': {
    name: 'KOT Calf Raise',
    slug: 'seated-calf-raise',
    block: 'lower_legs',
    equipment: ['bodyweight', 'wall_space'],
    standard: { reps: 25 },
    progressions: [
      'Small knee bend, both feet.',
      'Deeper knee bend as the ankle allows — heels lift slightly at the bottom.',
      'One leg at a time.',
      'Add a weight vest.',
    ],
    library_gap: 'No standing bent-knee ("knees over toes") calf raise. `seated-calf-raise` loads the same soleus/Achilles with a bent knee but seated, so the knee-forward position — the whole point — is lost.',
    note: 'The checklist says "as prescribed"; the reps come from the Knee Ability Zero recap.',
  },
  'single leg calf raise': {
    name: 'Single-Leg Calf Raise',
    slug: 'single-leg-calf-raise',
    block: 'lower_legs',
    equipment: ['slant_board', 'adjustable_dumbbell'],
    per_side: true,
    progressions: ['Bodyweight, floor.', 'Bodyweight, heel below a step or board.', 'Loaded, one dumbbell in the same-side hand.'],
    substitutions: SLANT_SUB,
  },
  'sl calf raise': {
    name: 'Single-Leg Calf Raise',
    slug: 'single-leg-calf-raise',
    block: 'lower_legs',
    equipment: ['slant_board', 'adjustable_dumbbell'],
    per_side: true,
    progressions: ['Bodyweight, floor.', 'Bodyweight, heel below a step or board.', 'Loaded — the benchmark is 25% bodyweight for 10 reps.'],
    substitutions: SLANT_SUB,
  },

  // ── Knee ability ───────────────────────────────────────────────────────────
  'patrick step slant board': {
    name: 'Patrick Step (Slant Board)',
    slug: 'patrick-step',
    block: 'knee_ability',
    equipment: ['slant_board'],
    per_side: true,
    progressions: [
      'Hold a wall or rail for balance.',
      'Free-standing.',
      'Reach the free leg farther forward.',
      'Raise the standing surface.',
      'Add load.',
    ],
    substitutions: SLANT_SUB,
  },
  'patrick step': {
    name: 'Patrick Step',
    slug: 'patrick-step',
    block: 'knee_ability',
    equipment: ['slant_board', 'adjustable_dumbbell'],
    per_side: true,
    progressions: ['Bodyweight.', 'Held dumbbells.', 'Raise the standing surface for more range.'],
    substitutions: SLANT_SUB,
    note: 'Ten sets of ten inside twenty minutes at the current load before the load goes up.',
  },
  'poliquin step up': {
    name: 'Poliquin Step-Up',
    slug: 'poliquin-step',
    block: 'knee_ability',
    equipment: ['plyo_box', 'slant_board', 'adjustable_dumbbell'],
    per_side: true,
    progressions: ['Bodyweight off a low rise.', 'Heel elevated on the board.', 'Loaded toward the 66%-bodyweight standard.'],
    substitutions: [
      { equipment_missing: 'plyo_box', use_slug: 'patrick-step', note: 'No 3–4 inch box at either gym: a stair or a stacked pair of plates is the rise; the Patrick Step is the regression until one exists.' },
      ...SLANT_SUB,
    ],
  },
  'atg split squat': {
    name: 'ATG Split Squat',
    slug: 'atg-split-squat',
    block: 'knee_ability',
    equipment: ['adjustable_dumbbell'],
    per_side: true,
    rest_s: 30,
    // Dense ramps at 5% a week; this movement, and only this movement, adds
    // 2.5%. At 5% it would reach 75% of bodyweight by week 12 instead of the
    // ~48% the program intends — on the lift the whole method is named for.
    load_ramp_override: { weekly_increment_pct: 2.5 },
    progressions: [
      'Front foot elevated, holding a rail for assistance.',
      'Front foot elevated, no hands.',
      'Flat ground, no hands, back knee to the floor.',
      'Dumbbells in both hands, toward 25% bodyweight per hand.',
    ],
    substitutions: [
      { equipment_missing: 'adjustable_dumbbell', use_slug: 'atg-split-squat', note: 'Travelling: bodyweight, or a loaded backpack.' },
    ],
  },
  'vmo squat': {
    name: 'VMO Squat',
    slug: 'sissy-squat',
    block: 'knee_ability',
    equipment: ['slant_board', 'adjustable_dumbbell'],
    progressions: [
      'Bodyweight, heels elevated (weeks 1–2).',
      'Goblet-held dumbbell at 5% bodyweight (week 3).',
      '+5% bodyweight per week.',
      'Bar on the back at 5% bodyweight from week 8.',
    ],
    substitutions: SLANT_SUB,
    library_gap: 'No heel-elevated VMO squat. `sissy-squat` is the closest knee-forward quad squat in the library; it is not the same set-up.',
  },
  'kot squat eccentric': {
    name: 'KOT Squat (Eccentric)',
    slug: 'sissy-squat',
    block: 'knee_ability',
    equipment: ['bodyweight', 'wall_space', 'bench_flat'],
    progressions: [
      'Lower to a high surface and stand back up.',
      'Lower to a progressively lower surface.',
      'Full range to the floor, controlled the whole way down.',
    ],
    library_gap: 'Same gap as the VMO squat — no KOT/sissy-style knee-forward squat with the ATG set-up.',
  },
  'body squat slant board': {
    name: 'Body Squat (Slant Board)',
    slug: 'bodyweight-squat',
    block: 'knee_ability',
    equipment: ['slant_board'],
    standard: { reps: 5, sets: 5 },
    rest_s: 30,
    progressions: ['Partial depth, heels on the board.', 'Full depth.', 'More sets before more depth.'],
    substitutions: SLANT_SUB,
    library_gap: 'No slant-board squat. `bodyweight-squat` is a flat-footed squat; the board is what lets the knees travel.',
    note: 'The checklist says "as prescribed"; the sets and reps come from the Knee Ability Zero recap, where this step is explicitly optional.',
  },
  'atg squat': {
    name: 'ATG Squat',
    slug: 'atg-squat',
    block: 'knee_ability',
    equipment: ['adjustable_dumbbell'],
    progressions: ['Bodyweight to full depth.', 'Goblet-held load.', 'Toward 25% bodyweight for 20 reps.'],
  },
  'sissy squat': {
    name: 'Sissy Squat',
    slug: 'sissy-squat',
    block: 'knee_ability',
    equipment: ['bodyweight', 'wall_space'],
    progressions: ['One-arm assisted.', 'Free-standing.', 'Loaded.'],
  },
  'relaxed lunge': {
    name: 'Relaxed Lunge',
    slug: 'kneeling-hip-flexor',
    block: 'knee_ability',
    equipment: ['bodyweight', 'yoga_mat'],
    per_side: true,
    library_gap: 'No passive/relaxed deep-lunge hold. `kneeling-hip-flexor` is the nearest position in the library.',
  },

  // ── Posterior chain & spine ────────────────────────────────────────────────
  'nordic curl': {
    name: 'Nordic Curl',
    slug: 'nordic-hamstring-curl',
    block: 'posterior_chain',
    equipment: ['nordic_support'],
    progressions: [
      'Lower a short way, hands catch early.',
      'Lower farther each week, hands catch late.',
      'Full lower, push back up with the hands.',
      'Full rep down and up, no hands — the standard is 10.',
    ],
    substitutions: [
      { equipment_missing: 'nordic_support', use_slug: 'seated-leg-curl', note: 'Planet Fitness has no GHD and nothing safe to anchor the ankles under: run the seated leg curl machine instead.' },
      { equipment_missing: 'nordic_support', use_slug: 'reverse-nordic', note: 'Travelling: reverse Nordic needs no anchor and keeps the eccentric quality.' },
    ],
  },
  'nordic curl eccentric': {
    name: 'Nordic Curl (Eccentric)',
    slug: 'nordic-hamstring-curl',
    block: 'posterior_chain',
    equipment: ['nordic_support'],
    progressions: ['Lowering only, hands catch.', 'Slower lowering.', 'Full reps down and up.'],
    substitutions: [
      { equipment_missing: 'nordic_support', use_slug: 'seated-leg-curl', note: 'Planet Fitness: seated leg curl machine.' },
      { equipment_missing: 'nordic_support', use_slug: 'reverse-nordic', note: 'Travelling: reverse Nordic.' },
    ],
    note: 'Lowering phase only — no concentric.',
  },
  'seated good morning': {
    name: 'Seated Good Morning',
    slug: 'seated-good-morning',
    block: 'posterior_chain',
    equipment: ['barbell', 'bench_flat'],
    progressions: ['Bodyweight hinge, hands behind the head.', 'Light bar.', 'Toward 50% bodyweight, abs to the bench.'],
    substitutions: [
      { equipment_missing: 'barbell', use_slug: 'lever-seated-good-morning', note: 'Neither gym has a barbell: Planet Fitness has the Smith machine and a seated good-morning lever.' },
      { equipment_missing: 'barbell', use_slug: 'seated-good-mornings', note: 'Home: hold a single heavy dumbbell at the chest and hinge from the hips.' },
    ],
  },
  'slant board jefferson curl': {
    name: 'Jefferson Curl (Slant Board)',
    slug: 'jefferson-curl',
    block: 'posterior_chain',
    equipment: ['slant_board', 'adjustable_dumbbell'],
    progressions: ['Unloaded roll-down.', 'Light dumbbell.', 'Toward 25% bodyweight for 10 reps.'],
    substitutions: SLANT_SUB,
    note: 'Loaded spinal flexion — check it against the standing low-back injury before prescribing.',
  },
  'jefferson curl': {
    name: 'Jefferson Curl',
    slug: 'jefferson-curl',
    block: 'posterior_chain',
    equipment: ['plyo_box', 'barbell'],
    progressions: ['Unloaded roll-down off a box.', 'Light bar.', 'Toward 25% bodyweight for 10 reps.'],
    substitutions: [
      { equipment_missing: 'barbell', use_slug: 'jefferson-curl', note: 'No barbell at either gym: a single heavy dumbbell held in both hands works to about 50 lb.' },
      { equipment_missing: 'plyo_box', use_slug: 'jefferson-curl', note: 'No box: stand on the slant board or the end of a flat bench so the hands can pass below the toes.' },
    ],
    note: 'Loaded spinal flexion — check it against the standing low-back injury before prescribing.',
  },
  'atg deadlift': {
    name: 'ATG Deadlift',
    slug: 'barbell-deadlift',
    block: 'posterior_chain',
    equipment: ['barbell', 'bumper_plates'],
    progressions: ['Partial range from blocks.', 'Floor.', 'Standing on a platform for extra range.', 'Toward 100% bodyweight for 10 reps.'],
    substitutions: [
      { equipment_missing: 'barbell', use_slug: 'smith-deadlift', note: 'Planet Fitness has no barbell and does not allow floor deadlifts: the Smith machine is the only route there.' },
      { equipment_missing: 'barbell', use_slug: 'atg-rdl', note: 'Home tops out at 52.5 lb per hand — the ATG RDL with dumbbells is the stand-in, well short of the 100%-bodyweight standard.' },
    ],
    library_gap: 'No deficit/full-range "ATG" deadlift variant. `barbell-deadlift` is the movement without the extra range.',
  },
  'ql extension': {
    name: 'QL Extension',
    slug: 'ql-extension',
    block: 'posterior_chain',
    equipment: ['back_extension_bench'],
    per_side: true,
    progressions: ['Bodyweight, short range.', 'Full range.', 'Holding a plate.'],
    substitutions: [
      { equipment_missing: 'back_extension_bench', use_slug: 'seated-good-morning', note: 'Neither gym has a back-extension bench: the seated good morning covers the same low-back standard.' },
    ],
  },

  // ── Hip flexors & core ─────────────────────────────────────────────────────
  'l sit': {
    name: 'L-Sit',
    slug: 'l-sit',
    block: 'hip_flexors_core',
    equipment: ['bodyweight'],
    progressions: [
      'Level 1 — alternate lifting one leg at a time, seated, for the full time.',
      'Level 2 — same, with the hips off the floor.',
      'Level 3 — full L-sit, both legs and hips off the floor.',
    ],
  },
  'hip flexor tri set': {
    name: 'Hip Flexor Tri-Set',
    slug: 'l-sit',
    block: 'hip_flexors_core',
    equipment: ['bodyweight', 'adjustable_dumbbell'],
    progressions: [
      'Dumbbell foot raise, no breaks.',
      'Reverse squat at 50% bodyweight.',
      'L-sit, maximum time off the ground.',
    ],
    library_gap: 'Two of the three components — the dumbbell foot raise and the reverse squat — have no library record at all. Only the L-sit resolves, and it is what the step currently points at.',
    note: 'Three drills in one slot. The checklist says alternate them to failure; the spreadsheet says pick one per five minutes.',
  },
  'hanging leg raise': {
    name: 'Hanging Leg Raise',
    slug: 'hanging-leg-raise',
    block: 'hip_flexors_core',
    equipment: ['pull_up_bar'],
    progressions: ['Bent-knee raise.', 'Straight-leg raise to horizontal.', 'Toes to bar.'],
    substitutions: [
      { equipment_missing: 'pull_up_bar', use_slug: 'leg-pull-in', note: 'Planet Fitness has no free-hanging bar: the captain’s-chair or a bench leg pull-in is the substitute.' },
    ],
  },
  'garhammer raise': {
    name: 'Garhammer Raise',
    slug: 'hanging-oblique-knee-raise',
    block: 'hip_flexors_core',
    equipment: ['pull_up_bar'],
    progressions: ['Level 1 — knees to 90°, short pull.', 'Level 2 — from 90°, curl the knees higher toward the chest for 10 reps.'],
    substitutions: [
      { equipment_missing: 'pull_up_bar', use_slug: 'leg-pull-in', note: 'Planet Fitness: captain’s chair or bench leg pull-in.' },
    ],
    library_gap: 'No Garhammer raise. `hanging-oblique-knee-raise` is a hanging knee raise, not the short top-range curl the standard measures.',
  },
  'low cable pull in': {
    name: 'Low Cable Pull-In',
    slug: 'leg-pull-in',
    block: 'hip_flexors_core',
    equipment: ['cable_machine'],
    per_side: true,
    progressions: ['Bodyweight leg pull-in.', 'Light cable.', 'Toward 50% bodyweight for 20 reps.'],
    substitutions: [
      { equipment_missing: 'cable_machine', use_slug: 'leg-pull-in', note: 'Home has no cable stack: a band anchored low at the ankle is the substitute, and the 50%-bodyweight standard is not reachable there.' },
    ],
    library_gap: 'No low-cable hip-flexor pull-in. `leg-pull-in` is the bodyweight version, which cannot express a %-bodyweight standard.',
  },
  'sl elevated pike': {
    name: 'Single-Leg Elevated Pike',
    slug: 'leg-up-hamstring-stretch',
    block: 'hip_flexors_core',
    equipment: ['bench_flat'],
    per_side: true,
    library_gap: 'No single-leg elevated pike. `leg-up-hamstring-stretch` is the nearest shape in the library.',
  },

  // ── Upper body ─────────────────────────────────────────────────────────────
  'chin up': {
    name: 'Chin-Up',
    slug: 'chin-up',
    block: 'upper_body',
    equipment: ['pull_up_bar'],
    progressions: ['Band- or machine-assisted.', 'Bodyweight.', 'Weighted.'],
    substitutions: [
      { equipment_missing: 'pull_up_bar', use_slug: 'assisted-standing-chin-up', note: 'Planet Fitness has no free bar: the assisted pull-up machine.' },
      { equipment_missing: 'pull_up_bar', use_slug: 'cable-bar-lateral-pulldown', note: 'Planet Fitness alternative: lat pulldown.' },
    ],
  },
  dips: {
    name: 'Dips',
    slug: 'chest-dip',
    block: 'upper_body',
    equipment: ['dip_station'],
    progressions: ['Bench dips.', 'Assisted parallel-bar dips.', 'Full-depth bodyweight dips.'],
    substitutions: [
      { equipment_missing: 'dip_station', use_slug: 'bench-dips', note: 'Neither location has a dip station: bench dips between two benches.' },
    ],
  },
  'atg dips': {
    name: 'ATG Dips',
    slug: 'chest-dip',
    block: 'upper_body',
    equipment: ['dip_station'],
    progressions: ['Partial depth.', 'Full depth, shoulder below elbow.', 'Weighted.'],
    substitutions: [
      { equipment_missing: 'dip_station', use_slug: 'bench-dips', note: 'Neither location has a dip station: bench dips, accepting the shorter range.' },
    ],
    library_gap: 'The prescription is a deliberately deep dip. `chest-dip` is the movement at conventional depth.',
  },
  'smith curl': {
    name: 'Smith Machine Curl',
    slug: 'smith-machine-bicep-curl',
    block: 'upper_body',
    equipment: ['smith_machine'],
    substitutions: [
      { equipment_missing: 'smith_machine', use_slug: 'dumbbell-bicep-curl', note: 'Home has no Smith machine: dumbbell curls.' },
    ],
  },
  'french press': {
    name: 'French Press',
    slug: 'barbell-lying-triceps-extension-skull-crusher',
    block: 'upper_body',
    equipment: ['ez_curl_bar', 'bench_flat'],
    substitutions: [
      { equipment_missing: 'ez_curl_bar', use_slug: 'dumbbell-lying-triceps-extension', note: 'Home has no EZ bar: dumbbells.' },
    ],
  },
  'bench pullover': {
    name: 'Bench Pullover',
    slug: 'bent-arm-dumbbell-pullover',
    block: 'upper_body',
    equipment: ['bench_flat', 'adjustable_dumbbell'],
    progressions: ['Along the bench.', 'Across the bench, hips low, for the full overhead stretch.', 'Toward 25% bodyweight.'],
    library_gap: 'The ATG version is performed lying ACROSS the bench with the hips dropped. `bent-arm-dumbbell-pullover` is the along-the-bench version.',
  },
  'atg shoulder press': {
    name: 'ATG Shoulder Press',
    slug: 'dumbbell-shoulder-press',
    block: 'upper_body',
    equipment: ['adjustable_dumbbell'],
    library_gap: 'No full-range "ATG" overhead press variant; `dumbbell-shoulder-press` is the conventional press.',
  },
  'incline db press': {
    name: 'Incline Dumbbell Press',
    slug: 'incline-dumbbell-press',
    block: 'upper_body',
    equipment: ['bench_adjustable', 'adjustable_dumbbell'],
  },
  'trx face pull': {
    name: 'TRX Face Pull',
    slug: 'face-pull',
    block: 'upper_body',
    equipment: ['suspension_trainer'],
    substitutions: [
      { equipment_missing: 'suspension_trainer', use_slug: 'face-pull', note: 'Neither location has a TRX: Planet Fitness has the cable face pull; at home use a band anchored at head height.' },
    ],
  },
  'external rotation': {
    name: 'Shoulder External Rotation',
    slug: 'external-rotation',
    block: 'upper_body',
    per_side: true,
    equipment: ['adjustable_dumbbell'],
    substitutions: [
      { equipment_missing: 'cable_machine', use_slug: 'external-rotation-with-band', note: 'Home: band external rotation, elbow pinned to the side.' },
    ],
    note: 'Roughly 10% of bodyweight is the target; lighter is fine.',
  },
  'external rotations': {
    name: 'Shoulder External Rotation',
    slug: 'external-rotation',
    block: 'upper_body',
    per_side: true,
    equipment: ['adjustable_dumbbell'],
    substitutions: [
      { equipment_missing: 'cable_machine', use_slug: 'external-rotation-with-band', note: 'Home: band external rotation, elbow pinned to the side.' },
    ],
  },
  'trap raise': {
    name: 'Trap Raise',
    slug: 'dumbbell-shrug',
    block: 'upper_body',
    equipment: ['adjustable_dumbbell'],
    library_gap: 'The ATG trap raise is a prone/incline raise for the lower traps. `dumbbell-shrug` is an upper-trap shrug — the closest the library gets, and not the same muscle.',
  },

  // ── Mobility & cool-down ───────────────────────────────────────────────────
  'elephant walk': {
    name: 'Elephant Walk',
    slug: 'elephant-walk',
    block: 'mobility_cooldown',
    equipment: ['bodyweight'],
    progressions: [
      'Hands well forward, on fingertips or a box, knees bent.',
      'Alternate straightening one leg at a time.',
      'Walk the hands back until the palms reach the floor in front of the toes.',
    ],
  },
  'couch stretch': {
    name: 'Couch Stretch',
    slug: 'couch-stretch',
    block: 'mobility_cooldown',
    equipment: ['wall_space', 'yoga_mat'],
    per_side: true,
    progressions: ['Knee down, torso upright, hands on the floor.', 'Hands to the front thigh.', 'Hands to the hips.', 'Shoulders to the wall.'],
  },
  'standing pigeon': {
    name: 'Standing Pigeon',
    slug: 'seated-piriformis-stretch',
    block: 'mobility_cooldown',
    equipment: ['bodyweight', 'wall_space'],
    per_side: true,
    standard: { hold_s: 90, sets: 2 },
    note: 'The checklist says only "hold each side". The 2 x 90 s comes from the Knee Ability Zero recap, where the same slot is a seated piriformis stretch.',
    library_gap: 'No standing figure-4 / pigeon. `seated-piriformis-stretch` is the same muscle from a seated position.',
  },
  pigeon: {
    name: 'Pigeon',
    slug: 'seated-piriformis-stretch',
    block: 'mobility_cooldown',
    equipment: ['bodyweight', 'yoga_mat'],
    per_side: true,
    library_gap: 'No pigeon pose. `seated-piriformis-stretch` is the nearest record.',
  },
  'piriformis stretch': {
    name: 'Piriformis Stretch',
    slug: 'seated-piriformis-stretch',
    block: 'mobility_cooldown',
    equipment: ['bodyweight', 'yoga_mat'],
    per_side: true,
  },
  'butterfly stretch': {
    name: 'Butterfly Stretch',
    slug: 'butterfly-yoga-pose',
    block: 'mobility_cooldown',
    equipment: ['bodyweight', 'yoga_mat'],
  },
  'seated pancake': {
    name: 'Seated Pancake',
    slug: 'the-straddle',
    block: 'mobility_cooldown',
    equipment: ['bodyweight', 'yoga_mat'],
  },
};

/**
 * Movements Seth does that no file of his records, keyed by phase. Seth was
 * asked about backward locomotion — the one gap the reconciliation report kept
 * pointing at — and answered on 2026-09-22 that he does it, backward on the
 * treadmill every session, and the sled when there is a sled. So it is in the
 * program, on his word, exactly the way the spreadsheet-only Dense warm-up walk
 * below it is in the program on the spreadsheet's word.
 *
 * The prescriptions are RESEARCH §7's: ten minutes of backward walking in Zero,
 * and the sled at roughly 50% of bodyweight in Dense. Nothing here is invented.
 * Standards is deliberately absent — see the reconciliation report, section 4.
 */
const SETH_CONFIRMED_ROWS: Record<string, RawRow[]> = {
  zero: [{ name: 'Backward Walk', prescription: '10 min' }],
  dense: [{ name: 'Backward Sled Drag', prescription: '10 min · 50% BW' }],
};

/**
 * Source rows that are deliberately NOT built, with the reason. They have to be
 * named here rather than simply deleted from `STEP_SPECS`: an unmapped row goes
 * into `unknownNames`, which fails the ingest and prints "add it to STEP_SPECS"
 * — the opposite of what was decided.
 */
const DROPPED_ROWS: Record<string, string> = {
  'neck brace exercises':
    'Seth asked for it out (2026-09-22). It was the only one of the 69 steps with no sets, reps or duration in any source, which is very likely why he does not do it.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Benchmarks → the Standards-phase step they are measured on
// ─────────────────────────────────────────────────────────────────────────────

const BENCHMARK_TO_KEY: Record<string, string> = {
  'poliquin step up': 'poliquin step up',
  'jefferson curl': 'jefferson curl',
  'hanging leg raise': 'hanging leg raise',
  'atg split squat': 'atg split squat',
  'seated good morning': 'seated good morning',
  'garhammer raise': 'garhammer raise',
  'sl calf raise': 'sl calf raise',
  'atg squat': 'atg squat',
  'nordic curl': 'nordic curl',
  'low cable pull in': 'low cable pull in',
  deadlift: 'atg deadlift',
  'bench pullover': 'bench pullover',
};

// ─────────────────────────────────────────────────────────────────────────────
// The public scaffold this rebuild replaced
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The inventory of `programs/kot/program.json` as it stood before Seth's own
 * material arrived: two flat `_phases` buckets, 26 steps, no weekday templates.
 * Recorded here so the reconciliation report renders the same way on every run,
 * long after the scaffold itself is gone from the tree.
 */
const PUBLIC_SCAFFOLD_STEPS: string[] = [
  'zero-backward-walk|Backward Walking (Zero)|backward-walk-outdoors',
  'dense-backward-sled|Backward Sled Drag (Dense)|backward-sled-drag',
  'zero-tib-raise|Tibialis Raise (Zero)|tibialis-raise',
  'dense-tib-bar-raise|Tib Bar Raise (Dense)|tib-bar-raise',
  'zero-fhl-calf-raise|FHL Calf Raise (Zero)|fhl-calf-raise',
  'zero-single-leg-calf-raise|Single-Leg Calf Raise (Zero)|single-leg-calf-raise',
  'dense-single-leg-calf-raise|Loaded Single-Leg Calf Raise (Dense)|single-leg-calf-raise',
  'zero-patrick-step|Patrick Step (Zero)|patrick-step',
  'dense-poliquin-step|Poliquin Step-Up (Dense)|poliquin-step',
  'zero-atg-split-squat-assisted|ATG Split Squat — Assisted (Zero)|atg-split-squat-assisted',
  'zero-atg-split-squat-flat|ATG Split Squat — Flat (Zero)|atg-split-squat',
  'dense-atg-split-squat|ATG Split Squat — Loaded (Dense)|atg-split-squat',
  'zero-elephant-walk|Elephant Walk (Zero)|elephant-walk',
  'zero-couch-stretch|Couch Stretch (Zero)|couch-stretch',
  'zero-deep-squat-hold|Deep Squat Hold (Zero)|deep-squat-hold',
  'dense-atg-squat|ATG Squat (Dense)|atg-squat',
  'zero-l-sit|L-Sit (Zero)|l-sit',
  'dense-atg-rdl|ATG RDL (Dense)|atg-rdl',
  'dense-nordic|Nordic Hamstring Curl (Dense)|nordic-hamstring-curl',
  'dense-reverse-nordic|Reverse Nordic Curl (Dense)|reverse-nordic',
  'dense-seated-good-morning|Seated Good Morning (Dense)|seated-good-morning',
  'dense-jefferson-curl|Jefferson Curl (Dense)|jefferson-curl',
  'dense-ql-extension|QL Extension (Dense)|ql-extension',
  'dense-incline-db-press|Incline Dumbbell Press (Dense)|incline-dumbbell-press',
  'dense-external-rotation|Shoulder External Rotation (Dense)|external-rotation',
  'dense-cross-bench-pullover|Cross-Bench Pullover (Dense)|dumbbell-pullover',
];

/** Equipment the program needs that the canonical `Equipment` union cannot name. */
const UNNAMEABLE_EQUIPMENT: { thing: string; where: string }[] = [
  { thing: 'weight vest', where: 'the calf-raise and KOT-calf-raise progressions in Knee Ability Zero' },
  { thing: '3–4 inch step (a specific box height, not a generic plyo box)', where: 'the Poliquin Step-Up benchmark' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Turn "¼", "×", "·" and friends into something the parsers can read. */
function normalizePrescription(raw: string): string {
  return raw
    .replace(/[×✕✖]/g, 'x')
    .replace(/¼/g, '0.25')
    .replace(/½/g, '0.5')
    .replace(/[–—‒−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ParsedPrescription {
  standard: ProgramStandard;
  per_side: boolean;
  /** Human note for anything the numbers cannot hold, e.g. a descending ladder. */
  detail?: string;
  /** Set when the source gave a range ("5-10 min") and `duration_min` holds the floor. */
  duration_label?: string;
}

/**
 * Read one of Seth's prescription strings into a machine-checkable standard.
 * The strings are terse and inconsistent — "10×10 · 20 min", "3×60 sec/leg",
 * "20, 15, 10, 5 · 5 min", "¼ mile", "5 reps · 25% BW" — so each `·`-separated
 * segment is parsed on its own and the results are merged.
 */
function parsePrescription(raw: string): ParsedPrescription {
  const text = normalizePrescription(raw);
  const standard: ProgramStandard = {};
  const per_side = /\/\s*(side|leg)|per (side|leg)|each (side|leg)/i.test(text);
  let detail: string | undefined;
  let durationLabel: string | undefined;

  for (const segment of text.split(/[·|]/).map((s) => s.trim()).filter(Boolean)) {
    // A descending rep ladder: "20, 15, 10, 5" → four sets, reps vary.
    const ladder = segment.match(/^(\d+(?:\s*,\s*\d+)+)/);
    if (ladder) {
      const entries = ladder[1].split(',').map((n) => Number(n.trim()));
      standard.sets = entries.length;
      detail = `reps ${entries.join(', ')}`;
      continue;
    }
    // "3x60 sec" → three timed sets.
    const setsHold = segment.match(/(\d+)\s*x\s*(\d+)\s*(?:sec|second)/i);
    if (setsHold) {
      standard.sets = Number(setsHold[1]);
      standard.hold_s = Number(setsHold[2]);
    } else {
      const setsReps = segment.match(/(\d+)\s*x\s*(\d+)/i);
      if (setsReps) {
        standard.sets = Number(setsReps[1]);
        standard.reps = Number(setsReps[2]);
      }
    }
    if (standard.reps === undefined) {
      const reps = segment.match(/(\d+)\s*reps?\b/i);
      if (reps) standard.reps = Number(reps[1]);
    }
    if (standard.hold_s === undefined) {
      const hold = segment.match(/(\d+)\s*(?:sec|second)/i);
      if (hold) standard.hold_s = Number(hold[1]);
    }
    if (standard.duration_min === undefined) {
      const range = segment.match(/(\d+)\s*-\s*(\d+)\s*(?:min|minute)/i);
      if (range) {
        // Store the floor so the engine never over-books a session, and keep
        // the range itself for the human-readable line.
        standard.duration_min = Number(range[1]);
        durationLabel = `${range[1]}\u2013${range[2]} min`;
      } else {
        const mins = segment.match(/(\d+)\s*(?:min|minute)/i);
        if (mins) standard.duration_min = Number(mins[1]);
      }
    }
    const miles = segment.match(/([\d.]+)\s*mile/i);
    if (miles) standard.distance_mi = Number(miles[1]);
    const pct = segment.match(/([\d.]+)\s*%\s*(?:of\s*)?BW/i);
    if (pct) standard.pct_bodyweight = Number(pct[1]) / 100;
  }
  return { standard, per_side, detail, duration_label: durationLabel };
}

/** Read a benchmark criteria line into the same shape. */
function parseBenchmark(criteria: string): ProgramStandard {
  const text = normalizePrescription(criteria);
  const standard: ProgramStandard = {};
  const pct = text.match(/([\d.]+)\s*%\s*BW/i);
  if (pct) standard.pct_bodyweight = Number(pct[1]) / 100;
  const reps = text.match(/(\d+)\s*(?:full\s*)?reps?/i);
  if (reps) standard.reps = Number(reps[1]);
  if (/per hand/i.test(text)) standard.per_hand = true;
  return standard;
}

function mergeStandard(...parts: (ProgramStandard | undefined)[]): ProgramStandard {
  const out: ProgramStandard = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function describeStandard(
  s: ProgramStandard,
  per_side: boolean,
  detail?: string,
  durationLabel?: string,
): string {
  const bits: string[] = [];
  if (s.sets !== undefined && s.reps !== undefined) bits.push(`${s.sets} × ${s.reps} reps`);
  else if (s.reps !== undefined) bits.push(`${s.reps} reps`);
  else if (s.sets !== undefined) bits.push(`${s.sets} sets`);
  if (s.hold_s !== undefined) bits.push(`${s.hold_s} s hold`);
  if (s.duration_min !== undefined) bits.push(durationLabel ?? `${s.duration_min} min`);
  if (s.distance_mi !== undefined) bits.push(`${s.distance_mi} mile`);
  if (s.pct_bodyweight !== undefined) {
    bits.push(`${Math.round(s.pct_bodyweight * 100)}% bodyweight${s.per_hand ? ' per hand' : ''}`);
  }
  let out = bits.join(', ');
  if (per_side) out += out ? ', per side' : 'per side';
  if (detail) out += ` (${detail})`;
  return out || 'no sets, reps or duration given in the source';
}

// ─────────────────────────────────────────────────────────────────────────────
// Running the extractor
// ─────────────────────────────────────────────────────────────────────────────

function runExtractor(rawDir: string): Extracted {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kot-ingest-'));
  const script = path.join(tmp, 'extract_kot.py');
  fs.writeFileSync(script, EXTRACTOR_PY, 'utf8');
  try {
    const run = spawnSync('python3', [script, rawDir], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.error) {
      throw new Error(
        `python3 could not be started (${run.error.message}).\n` +
          'The KOT sources are .docx/.xlsx. This repo adds no npm dependency to read them;\n' +
          'it uses the python3 that ships with the machine plus python-docx and openpyxl.',
      );
    }
    if (run.status !== 0) {
      throw new Error(`python3 exited ${run.status}:\n${run.stderr}`);
    }
    const parsed = JSON.parse(run.stdout) as Extracted;
    if (parsed.error === 'missing_python_dep') {
      throw new Error(
        `A Python module the extractor needs is missing (${parsed.detail ?? 'unknown'}).\n` +
          'Install both with:  python3 -m pip install --user python-docx openpyxl',
      );
    }
    return parsed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase headers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "3 days/week (Monday, Wednesday, Friday)" → [1, 3, 5].
 * Seth's sheets spell the days out in one phase, abbreviate them in another
 * ("Mon, Tue, Thu, Fri") and write Dense as a range ("Monday-Friday"), so all
 * three spellings are accepted.
 */
const DAY_PATTERN = '(?:sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?';

function dayIndex(word: string): number {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(word.slice(0, 3).toLowerCase());
}

function parseWeekdays(schedule: string): number[] {
  const lower = schedule.toLowerCase();
  const found: number[] = [];
  const range = lower.match(new RegExp(`\\b(${DAY_PATTERN})\\s*-\\s*(${DAY_PATTERN})\\b`));
  if (range) {
    const a = dayIndex(range[1]);
    const b = dayIndex(range[2]);
    if (a >= 0 && b >= a) {
      for (let d = a; d <= b; d += 1) found.push(d);
      return found;
    }
  }
  for (const m of lower.matchAll(new RegExp(`\\b${DAY_PATTERN}\\b`, 'g'))) {
    const d = dayIndex(m[0]);
    if (d >= 0 && !found.includes(d)) found.push(d);
  }
  return found.sort((a, b) => a - b);
}

/** Read the Dense column header out of the spreadsheet: "Week 2 25% … by 5% each week". */
function parseDenseRamp(workouts: Record<string, string[][]> | null): { start_pct: number; weekly_increment_pct: number } {
  const fallback = { start_pct: 25, weekly_increment_pct: 5 };
  const grid = workouts?.Dense;
  if (!grid) return fallback;
  const blob = grid.flat().join('\n');
  const start = blob.match(/Week\s*2\s*(\d+(?:\.\d+)?)\s*%/i);
  const inc = blob.match(/Increase by\s*(\d+(?:\.\d+)?)\s*%/i);
  return {
    start_pct: start ? Number(start[1]) : fallback.start_pct,
    weekly_increment_pct: inc ? Number(inc[1]) : fallback.weekly_increment_pct,
  };
}

function buildPhase(raw: RawPhase, ramp: { start_pct: number; weekly_increment_pct: number }): ProgramPhase {
  const meta = raw.meta;
  const duration = meta.Duration ?? '';
  const weeksMatch = duration.match(/(\d+)\s*weeks?/i);
  const weeks = weeksMatch ? Number(weeksMatch[1]) : null;

  const weekdays = parseWeekdays(meta.Schedule ?? '');
  const dpwMatch = (meta.Schedule ?? '').match(/(\d+)\s*days?\s*\/\s*week/i);
  const days_per_week = dpwMatch ? Number(dpwMatch[1]) : weekdays.length;

  const sessionMatch = (meta['Session length'] ?? '').match(/(\d+)\s*-\s*(\d+)/);
  const session_min: [number, number] = sessionMatch
    ? [Number(sessionMatch[1]), Number(sessionMatch[2])]
    : [30, 45];

  const load = meta.Load ?? '';
  let load_rule: PhaseLoadRule;
  if (/bodyweight only/i.test(load)) {
    load_rule = { kind: 'bodyweight_only' };
  } else if (/add\s*([\d.]+)\s*%\s*per week/i.test(load)) {
    const inc = load.match(/add\s*([\d.]+)\s*%\s*per week/i);
    load_rule = {
      kind: 'percent_bw_ramp',
      start_pct: ramp.start_pct,
      weekly_increment_pct: inc ? Number(inc[1]) : ramp.weekly_increment_pct,
    };
  } else {
    load_rule = { kind: 'standards_driven' };
  }

  const name = tidy((meta.title ?? raw.label).split(' - ')[0]);
  const descriptionBits = [
    weeks === null ? 'Open-ended: it runs until every benchmark is met.' : `${weeks} weeks.`,
    `${days_per_week} days a week, ${weekdays.map((d) => WEEKDAY_NAMES[d].replace(/^./, (c) => c.toUpperCase())).join(', ')}.`,
    `${session_min[0]}–${session_min[1]} minutes a session.`,
  ];
  if (load_rule.kind === 'bodyweight_only') {
    descriptionBits.push('Bodyweight throughout — no external load anywhere in the phase.');
  } else if (load_rule.kind === 'percent_bw_ramp') {
    descriptionBits.push(
      `Week 1 is bodyweight, week 2 starts at ${load_rule.start_pct}% of bodyweight, and every week after adds ${load_rule.weekly_increment_pct}% — except the split squat, which adds 2.5%.`,
      'Load only goes up once the full set count is completed inside the time cap.',
    );
  } else {
    descriptionBits.push('Load is whatever it takes to reach the twelve benchmarks; there is no calendar ramp.');
  }

  return {
    id: raw.key,
    name,
    order: raw.index,
    weeks,
    days_per_week,
    weekdays,
    session_min,
    load_rule,
    description: descriptionBits.join(' '),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps and weekday templates
// ─────────────────────────────────────────────────────────────────────────────

interface BuiltStep extends ProgramStep {
  _key: string;
  _equipment: Equipment[];
  _library_gap?: string;
}

interface BuildWarning {
  where: string;
  message: string;
}

interface BuildResult {
  phases: ProgramPhase[];
  steps: BuiltStep[];
  days: ProgramDay[];
  warnings: BuildWarning[];
  unknownNames: string[];
  /** Rows `DROPPED_ROWS` deliberately left out, so the report can say why. */
  droppedRows: { name: string; reason: string }[];
  benchmarkRows: { name: string; criteria: string; step_id: string | null; standard: ProgramStandard }[];
}

/** "MONDAY / WEDNESDAY / FRIDAY - Same Workout" → weekdays + focus. */
function parseDayLabel(label: string): { weekdays: number[]; focus: string } {
  const [left, ...rest] = label.split(/\s+-\s+/);
  const weekdays = parseWeekdays(left);
  const focus = tidy(rest.join(' - ')) || 'Session';
  return { weekdays, focus };
}

function buildProgramShape(ex: Extracted): BuildResult {
  const checklist = ex.checklist;
  if (!checklist) throw new Error('The checklist (.docx) could not be read — it is the authoritative source.');

  const ramp = parseDenseRamp(ex.workouts);
  const phases = checklist.phases.map((p) => buildPhase(p, ramp));
  const warnings: BuildWarning[] = [];
  const unknownNames: string[] = [];
  const droppedRows: { name: string; reason: string }[] = [];
  const steps: BuiltStep[] = [];
  const days: ProgramDay[] = [];
  const byPhaseKey = new Map<string, BuiltStep>(); // `${phase}::${key}` → step
  let order = 0;

  // The warm-up walk lives only in the spreadsheet grids, not in the checklist
  // tables. Pull it back in for the phases whose grid carries it.
  const warmUpFromGrid = (phaseId: string): boolean => {
    const grid = ex.workouts?.[phaseId === 'zero' ? 'Zero' : phaseId === 'dense' ? 'Dense' : 'Standards'];
    if (!grid) return false;
    return grid.some((row) => row.some((c) => /walk/i.test(c) && /warm|5\s*-\s*10/i.test(row.join(' '))));
  };

  for (const rawPhase of checklist.phases) {
    const phase = phases.find((p) => p.id === rawPhase.key);
    if (!phase) continue;

    const denseWarmUp = rawPhase.key === 'dense' && warmUpFromGrid('dense');

    for (const rawDay of rawPhase.days) {
      const { weekdays, focus } = parseDayLabel(rawDay.label);
      if (!weekdays.length) {
        warnings.push({ where: `${rawPhase.label} / ${rawDay.label}`, message: 'no weekday could be read from the day label' });
        continue;
      }

      // Expand combined rows, and prepend the spreadsheet-only Dense warm-up.
      const rows: RawRow[] = [];
      if (denseWarmUp) rows.push({ name: 'BW Walk (Warm-Up)', prescription: '5-10 min' });
      for (const row of rawDay.rows) {
        const key = norm(row.name);
        const combo = COMBOS[key];
        if (combo) {
          for (const part of combo) rows.push({ name: part.key, prescription: part.prescription });
        } else {
          rows.push(row);
        }
      }

      // Backward locomotion goes in behind the opening walk. Ground-up ordering
      // (RESEARCH §7) puts it before everything that loads the knee from above,
      // but ten minutes of walking backwards is work, not a warm-up, so the
      // easy forward walk still comes first. No walk on this day → position 0.
      const confirmed = SETH_CONFIRMED_ROWS[rawPhase.key];
      if (confirmed) {
        const afterWalk = rows.findIndex((r) => norm(r.name).startsWith('bw walk')) + 1;
        rows.splice(afterWalk, 0, ...confirmed);
      }

      const orderedStepIds: string[] = [];
      for (const row of rows) {
        const key = norm(row.name);
        const reason = DROPPED_ROWS[key];
        if (reason) {
          if (!droppedRows.some((d) => d.name === row.name)) droppedRows.push({ name: row.name, reason });
          continue;
        }
        const spec = STEP_SPECS[key];
        if (!spec) {
          if (!unknownNames.includes(row.name)) unknownNames.push(row.name);
          warnings.push({
            where: `${phase.name} / ${rawDay.label}`,
            message: `"${row.name}" has no entry in STEP_SPECS — it was skipped`,
          });
          continue;
        }

        const parsed = parsePrescription(row.prescription);
        const standard = mergeStandard(parsed.standard, spec.standard);
        const per_side = spec.per_side || parsed.per_side;
        const composite = `${rawPhase.key}::${key}`;
        const existing = byPhaseKey.get(composite);

        if (existing) {
          const same = JSON.stringify(existing.standard ?? {}) === JSON.stringify(standard);
          if (!same) {
            warnings.push({
              where: `${phase.name} / ${rawDay.label}`,
              message: `"${spec.name}" appears twice in this phase with different prescriptions — kept the first (${existing.standard_text})`,
            });
          }
          orderedStepIds.push(existing.id);
          continue;
        }

        order += 1;
        let id = `${rawPhase.key}-${slugify(spec.name)}`;
        if (steps.some((s) => s.id === id)) {
          warnings.push({
            where: `${phase.name} / ${rawDay.label}`,
            message: `two source rows resolve to the same step id "${id}" — the second was suffixed`,
          });
          id = `${id}-2`;
        }
        const textBits = [describeStandard(standard, per_side, parsed.detail, parsed.duration_label)];
        if (spec.note) textBits.push(spec.note);
        const standardText = textBits.join(' \u2014 ');
        const step: BuiltStep = {
          id,
          order,
          name: spec.name,
          phase_id: rawPhase.key,
          block: spec.block_by_phase?.[rawPhase.key] ?? spec.block,
          exercise_slug: spec.slug,
          standard_text: standardText,
          standard: Object.keys(standard).length ? standard : undefined,
          _key: key,
          _equipment: spec.equipment,
          _library_gap: spec.library_gap,
        };
        if (per_side) step.per_side = true;
        if (spec.rest_s !== undefined) step.rest_s = spec.rest_s;
        if (spec.load_ramp_override) step.load_ramp_override = { ...spec.load_ramp_override };
        if (spec.progressions?.length) step.progressions = spec.progressions;
        if (spec.substitutions?.length) {
          step.substitutions = spec.substitutions.map((sub) =>
            sub.use_slug === SAME_MOVEMENT ? { ...sub, use_slug: spec.slug } : sub,
          );
        }
        steps.push(step);
        byPhaseKey.set(composite, step);
        orderedStepIds.push(id);
      }

      // Group the day's steps into contiguous runs by program block, so the
      // session keeps the exact order the checklist lists.
      const blocks: { title: string; step_ids: string[] }[] = [];
      for (const stepId of orderedStepIds) {
        const step = steps.find((s) => s.id === stepId);
        if (!step) continue;
        const title = BLOCKS.find((b) => b.id === step.block)?.name ?? step.block;
        const last = blocks[blocks.length - 1];
        if (last && last.title === title) last.step_ids.push(stepId);
        else blocks.push({ title, step_ids: [stepId] });
      }

      for (const weekday of weekdays) {
        days.push({
          phase_id: rawPhase.key,
          weekday,
          title: `${phase.name} — ${WEEKDAY_NAMES[weekday].replace(/^./, (c) => c.toUpperCase())}`,
          focus,
          blocks: blocks.map((b) => ({ title: b.title, step_ids: [...b.step_ids] })),
        });
      }
    }
  }

  // Benchmarks: overlay each onto the Standards-phase step that measures it.
  const benchmarkRows = checklist.benchmarks.map((b) => {
    const key = BENCHMARK_TO_KEY[norm(b.name)];
    const standard = parseBenchmark(b.criteria);
    const step = key ? steps.find((s) => s.phase_id === 'standards' && s._key === key) : undefined;
    if (!step) {
      warnings.push({ where: 'benchmarks', message: `benchmark "${b.name}" maps to no Standards-phase step` });
      return { name: b.name, criteria: b.criteria, step_id: null, standard };
    }
    step.standard = mergeStandard(step.standard, standard);
    step.standard_text = `${step.standard_text} \u2014 BENCHMARK: ${tidy(b.criteria)}.`;
    return { name: b.name, criteria: b.criteria, step_id: step.id, standard };
  });

  days.sort((a, b) => {
    const pa = phases.find((p) => p.id === a.phase_id)?.order ?? 0;
    const pb = phases.find((p) => p.id === b.phase_id)?.order ?? 0;
    return pa - pb || a.weekday - b.weekday;
  });

  return { phases, steps, days, warnings, unknownNames, droppedRows, benchmarkRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo links
// ─────────────────────────────────────────────────────────────────────────────

interface LinkReport {
  attachedToSteps: { step_id: string; url: string }[];
  attachedToDays: { phase_id: string; weekday: number; url: string }[];
  skipped: { text: string; url: string; why: string }[];
}

/**
 * The YouTube workbook carries far fewer links than "one per exercise": a
 * playlist per Dense weekday, one for Zero, and three links that sit on a named
 * exercise cell. Attach what there is; report what is missing rather than
 * inventing anything.
 */
function attachDemoLinks(ex: Extracted, build: BuildResult): LinkReport {
  const report: LinkReport = { attachedToSteps: [], attachedToDays: [], skipped: [] };
  const sheets = ex.youtube_links ?? {};
  const grids = ex.youtube_grids ?? {};

  for (const [sheetName, links] of Object.entries(sheets)) {
    const phaseId = sheetName.toLowerCase();
    const phase = build.phases.find((p) => p.id === phaseId);
    if (!phase) continue;
    const header = grids[sheetName]?.[0] ?? [];
    // column index (1-based) → weekday, from the sheet's own header row
    const columnWeekday: { column: number; weekday: number }[] = [];
    header.forEach((cell, i) => {
      const d = WEEKDAY_NAMES.indexOf(cell.trim().toLowerCase());
      if (d >= 0) columnWeekday.push({ column: i + 1, weekday: d });
    });

    for (const link of links) {
      if (/\/results\?search_query|\/search\?/i.test(link.url)) {
        report.skipped.push({ text: link.text, url: link.url, why: 'a search query, not a demonstration' });
        continue;
      }
      // A link that sits on an exercise cell carries the whole cell as its text
      // ("Tibialis Raise 5 Minutes (20, 15, 10, 5)"), so match on the leading
      // movement name. A combined cell lights up every step it expanded into.
      const text = norm(link.text);
      const candidates = [
        ...new Set([...build.steps.filter((s) => s.phase_id === phaseId).map((s) => s._key), ...Object.keys(COMBOS)]),
      ].sort((a, b) => b.length - a.length);
      const matched = candidates.find((k) => text === k || text.startsWith(`${k} `));
      if (matched) {
        const keys = COMBOS[matched]?.map((part) => part.key) ?? [matched];
        const hit = build.steps.filter((s) => s.phase_id === phaseId && keys.includes(s._key));
        for (const step of hit) {
          step.demo_url = link.url;
          report.attachedToSteps.push({ step_id: step.id, url: link.url });
        }
        if (hit.length) continue;
      }
      // Otherwise it is a weekday playlist: find the nearest header column at or
      // left of this cell.
      const owner = columnWeekday.filter((c) => c.column <= link.column).pop();
      if (!owner) {
        report.skipped.push({ text: link.text, url: link.url, why: 'no weekday column owns this cell' });
        continue;
      }
      // Zero trains three weekdays off one column of the sheet; give all of them
      // the same playlist.
      const targets = phaseId === 'zero' ? phase.weekdays : [owner.weekday];
      for (const weekday of targets) {
        const day = build.days.find((d) => d.phase_id === phaseId && d.weekday === weekday);
        if (!day) continue;
        day.demo_url = link.url;
        report.attachedToDays.push({ phase_id: phaseId, weekday, url: link.url });
      }
    }
  }
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seth's working weights (the `Full Body` sheet)
// ─────────────────────────────────────────────────────────────────────────────

interface BaselineRow {
  exercise_slug: string;
  raw_name: string;
  load_lb: number;
  reps?: number;
  sets?: number;
  source: string;
  as_of: string;
  note?: string;
}

/**
 * `Full Body` names → library slugs. Written here; the sheet has no ids.
 *
 * `per_hand` doubles the sheet's number on the way in. The sheet writes what he
 * picks up off the rack; the engine stores total load everywhere (PRD §8.2),
 * and the two are the same number only for a single-implement lift.
 */
const BASELINE_SLUGS: Record<string, { slug: string; per_hand?: boolean; note?: string }> = {
  deadlift: { slug: 'barbell-deadlift' },
  'pat step': { slug: 'patrick-step' },
  'split squat': {
    slug: 'atg-split-squat',
    per_hand: true,
    note: 'Sheet reads "25 DB". Seth confirmed (2026-09-22) that is 25 lb in each hand, so the total-load convention records 50.',
  },
  'vmo squat': { slug: 'sissy-squat' },
  'dumbbell bench': { slug: 'dumbbell-bench-press' },
  bench: { slug: 'barbell-bench-press-medium-grip' },
  'decline bench': { slug: 'barbell-decline-bench-press' },
  'db curl': { slug: 'dumbbell-bicep-curl' },
};

/** Loads Seth pencilled onto the Dense sheet — real, and much more recent than Full Body. */
const DENSE_ANNOTATION_SLUGS: Record<string, string> = {
  'pat step': 'patrick-step',
  'seated good morning': 'seated-good-morning',
  'smith curl french press': 'smith-machine-bicep-curl',
  'tibialis raise': 'tibialis-raise',
  'slant board calf raises': 'fhl-calf-raise',
};

function parseSetsReps(cell: string): { sets?: number; reps?: number } {
  const t = normalizePrescription(cell);
  const both = t.match(/(\d+)\s*x\s*(\d+)/i);
  if (both) return { sets: Number(both[1]), reps: Number(both[2]) };
  const repsOnly = t.match(/^x\s*(\d+)/i);
  if (repsOnly) return { reps: Number(repsOnly[1]) };
  return {};
}

function buildBaseline(ex: Extracted): { rows: BaselineRow[]; dense: BaselineRow[]; unmapped: string[] } {
  const rows: BaselineRow[] = [];
  const unmapped: string[] = [];
  const grid = ex.workouts?.['Full Body'] ?? [];
  for (const row of grid) {
    const setsReps = parseSetsReps(row[0] ?? '');
    for (let i = 1; i < row.length - 1; i += 1) {
      const name = tidy(row[i]);
      const value = tidy(row[i + 1]);
      if (!name || !value) continue;
      const num = value.match(/^([\d.]+)(?:\s*DB)?$/i);
      if (!num) continue;
      const mapping = BASELINE_SLUGS[norm(name)];
      if (!mapping) {
        if (!unmapped.includes(name)) unmapped.push(name);
        continue;
      }
      if (rows.some((r) => r.raw_name === name)) continue;
      rows.push({
        exercise_slug: mapping.slug,
        raw_name: name,
        load_lb: mapping.per_hand ? Number(num[1]) * 2 : Number(num[1]),
        sets: setsReps.sets,
        reps: setsReps.reps,
        source: 'ATG_Workouts.xlsx — "Full Body" sheet',
        as_of: '2026-04',
        note: mapping.note,
      });
    }
  }

  // Dense-sheet pencil marks: "<exercise name>" in one cell, "35 lbs total" nearby.
  const dense: BaselineRow[] = [];
  const denseGrid = ex.youtube_grids?.Dense ?? ex.workouts?.Dense ?? [];
  for (const row of denseGrid) {
    for (let i = 0; i < row.length - 1; i += 1) {
      const name = norm((row[i] ?? '').split('\n')[0]);
      const value = tidy(row[i + 1] ?? '');
      const num = value.match(/^([\d.]+)\s*lbs?\b/i);
      if (!num) continue;
      // Cells read like "Pat Step 10 x 10" - match on the leading movement name.
      const annotationKey = Object.keys(DENSE_ANNOTATION_SLUGS)
        .sort((a, b) => b.length - a.length)
        .find((k) => name === k || name.startsWith(`${k} `));
      const slug = annotationKey ? DENSE_ANNOTATION_SLUGS[annotationKey] : undefined;
      if (!slug) {
        if (!unmapped.includes(name)) unmapped.push(name);
        continue;
      }
      if (dense.some((r) => r.exercise_slug === slug)) continue;
      dense.push({
        exercise_slug: slug,
        raw_name: tidy((row[i] ?? '').split('\n')[0]).replace(/\s*\d+\s*x\s*\d+\s*$/i, ''),
        load_lb: Number(num[1]),
        source: 'YouTube_Links_ATG_Workouts.xlsx — "Dense" sheet annotation',
        as_of: '2026-04',
        note: /total/i.test(value)
          ? 'The sheet writes this as a total, so it is already the engine\'s total-load convention rather than a per-hand number.'
          : 'The sheet gives no per-hand/total marking for this one.',
      });
    }
  }
  return { rows, dense, unmapped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gap analysis
// ─────────────────────────────────────────────────────────────────────────────

function loadLibrary(): { slugs: Set<string>; count: number } {
  const slugs = new Set<string>();
  let count = 0;
  for (const file of [PATHS.exercises, PATHS.curatedExercises]) {
    if (!fs.existsSync(file)) continue;
    for (const ex of readJson<Exercise[]>(file)) {
      slugs.add(ex.slug);
      slugs.add(ex.id);
      count += 1;
    }
  }
  return { slugs, count };
}

/**
 * Equipment that genuinely stands in for other equipment, so the gap list stays
 * honest instead of flagging "no adjustable dumbbells at Planet Fitness" when
 * Planet Fitness has a full fixed-dumbbell rack.
 */
const EQUIVALENT: Partial<Record<Equipment, Equipment[]>> = {
  adjustable_dumbbell: ['dumbbell'],
  dumbbell: ['adjustable_dumbbell'],
  bench_flat: ['bench_adjustable'],
  bench_adjustable: ['bench_flat'],
  ez_curl_bar: ['fixed_barbell', 'barbell'],
  barbell: [],
};

function availableEquipment(loc: GymLocation): Set<Equipment> {
  const out = new Set<Equipment>();
  for (const spec of loc.equipment) if (spec.available) out.add(spec.equipment);
  out.add('bodyweight');
  return out;
}

function has(set: Set<Equipment>, wanted: Equipment): boolean {
  if (set.has(wanted)) return true;
  return (EQUIVALENT[wanted] ?? []).some((alt) => set.has(alt));
}

interface EquipmentGap {
  equipment: Equipment;
  steps: string[];
  missingAt: string[];
}

function equipmentGaps(steps: BuiltStep[], locations: GymLocation[]): EquipmentGap[] {
  const byEquipment = new Map<Equipment, Set<string>>();
  for (const step of steps) {
    for (const eq of step._equipment) {
      if (eq === 'bodyweight') continue;
      if (!byEquipment.has(eq)) byEquipment.set(eq, new Set());
      byEquipment.get(eq)!.add(step.name);
    }
  }
  const have = locations.map((l) => ({ name: l.name, set: availableEquipment(l) }));
  const gaps: EquipmentGap[] = [];
  for (const [equipment, stepNames] of [...byEquipment.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const missingAt = have.filter((h) => !has(h.set, equipment)).map((h) => h.name);
    if (missingAt.length) gaps.push({ equipment, steps: [...stepNames].sort(), missingAt });
  }
  return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// The reconciliation report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-express one of the book's recap lines as numbers in our own wording. The
 * recap sentences trail off into coaching advice, and none of that phrasing
 * belongs in a committed file — only the sets, reps, holds and rests do.
 */
function summarizeBookPrescription(raw: string): string {
  const text = normalizePrescription(raw);
  const bits: string[] = [];
  const setsHold = text.match(/(\d+)\s*sets? of (\d+)\s*seconds?/i);
  const setsReps = text.match(/(\d+)\s*sets? of (\d+)\s*reps?/i);
  if (setsHold) bits.push(`${setsHold[1]} × ${setsHold[2]} s`);
  else if (setsReps) bits.push(`${setsReps[1]} × ${setsReps[2]} reps`);
  else {
    const reps = text.match(/(\d+)\s*reps?/i);
    if (reps) bits.push(`${reps[1]} reps`);
    const hold = text.match(/(\d+)\s*seconds?/i);
    if (hold) bits.push(`${hold[1]} s`);
  }
  if (/per side/i.test(text)) bits.push('per side');
  const rest = text.match(/(\d+)\s*second breaks?/i);
  if (rest) bits.push(`${rest[1]} s rests`);
  return bits.join(', ') || tidy(raw.split(/\s+-\s+/)[0]);
}

function h(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

function buildReport(args: {
  ex: Extracted;
  build: BuildResult;
  links: LinkReport;
  baseline: { rows: BaselineRow[]; dense: BaselineRow[]; unmapped: string[] };
  library: { slugs: Set<string>; count: number };
  gaps: EquipmentGap[];
  unresolvedSlugs: { step: string; slug: string }[];
}): string {
  const { ex, build, links, baseline, library, gaps, unresolvedSlugs } = args;
  const out: string[] = [];
  const phaseSummary = build.phases
    .map((p) => `${p.name} (${p.weeks === null ? 'open-ended' : `${p.weeks} wk`}, ${p.days_per_week} d/wk)`)
    .join(' → ');

  out.push(h(1, 'Knees Over Toes — reconciliation'));
  out.push(
    'Generated by `npx tsx scripts/ingest-kot.ts` from the material in `docs/programs/kot/raw/`',
    '(gitignored — it is copyrighted ATG product). This report carries structure and numbers only:',
    'no coaching text, explanation or illustration from those files appears here or in any other',
    'committed file.',
    '',
    `**Result:** ${phaseSummary} — ${build.steps.length} steps, ${build.days.length} weekday session templates, ${build.benchmarkRows.length} benchmarks.`,
    '',
    '**Read section 6 and 7.** They are the two lists that need someone to act on them.',
  );

  // 1 ── sources
  out.push('', h(2, '1. Sources read'));
  out.push('', '| Role | File | Used for |', '| --- | --- | --- |');
  const roleNotes: Record<string, string> = {
    checklist: 'Authoritative. Phase headers, per-weekday tables, benchmark table.',
    workouts: 'Weekday grids; the Dense load ramp; Seth’s `Full Body` working weights.',
    youtube: 'Demo links, and the two Zero movements the checklist tables also carry.',
    book: 'Knee Ability Zero — the closing recap list, for the delta in section 3.',
  };
  for (const [role, file] of Object.entries(ex.found)) {
    out.push(`| ${role} | ${file ? `\`${file}\`` : '_not found_'} | ${roleNotes[role] ?? ''} |`);
  }
  if (!ex.book.available) {
    out.push('', `Note: the Knee Ability Zero PDF could not be read (${ex.book.reason ?? 'unknown'}), so section 3 is partial.`);
  }

  // 2 ── scaffold vs real
  out.push('', h(2, '2. The public scaffold vs. Seth’s real program'));
  out.push(
    '',
    'What `programs/kot/program.json` used to be: a structure inferred from public descriptions of',
    'Knees Over Toes — two buckets (`zero`, `dense`) hanging off a `_phases` key the engine types did',
    'not know about, 26 flat steps, no notion of a weekday or a session. Nothing scheduled anything.',
    '',
    'What it is now: three sequential phases with real durations and weekday templates, taken from a',
    'checklist prepared for Seth in April 2026.',
    '',
    '| | Public scaffold | Seth’s program |',
    '| --- | --- | --- |',
    `| Phases | 2 (informal) | ${build.phases.length} (typed, sequential) |`,
    `| Steps | ${PUBLIC_SCAFFOLD_STEPS.length} | ${build.steps.length} |`,
    `| Weekday templates | 0 | ${build.days.length} |`,
    `| Benchmarks | 0 (standards inlined per step) | ${build.benchmarkRows.length} |`,
    '| Days per week | 2–3 | 3 (Zero), 5 (Dense), 4 (Standards) |',
  );

  const realSlugs = new Set(build.steps.map((s) => s.exercise_slug));
  const dropped = PUBLIC_SCAFFOLD_STEPS.map((row) => row.split('|')).filter(([, , slug]) => !realSlugs.has(slug));
  out.push('', h(3, '2a. Scaffold steps with no counterpart in the real program'));
  out.push('', 'These were invented by the scaffold. They are gone.', '');
  const subSlugs = new Set(build.steps.flatMap((s) => (s.substitutions ?? []).map((x) => x.use_slug)));
  if (dropped.length) {
    for (const [id, name, slug] of dropped) {
      const kept = subSlugs.has(slug) ? ' — still reachable as a substitution' : '';
      out.push(`- \`${id}\` — ${name} (\`${slug}\`)${kept}`);
    }
  } else {
    out.push('- _none_');
  }
  out.push(
    '',
    'Backward walking and the backward sled drag used to head this list: they are the first two steps of',
    'the public scaffold and they appear nowhere in Seth’s material. He was asked, and on **2026-09-22**',
    'he confirmed he does both — backward on the treadmill every session, and the sled whenever there is',
    'one. They are back in the program on his word rather than on a document; see section 4.',
  );

  out.push('', h(3, '2b. Movements the real program has that the scaffold never had'));
  const scaffoldSlugs = new Set(PUBLIC_SCAFFOLD_STEPS.map((r) => r.split('|')[2]));
  const added = build.steps.filter((s) => !scaffoldSlugs.has(s.exercise_slug));
  const addedNames = [...new Set(added.map((s) => s.name))].sort();
  out.push('', ...addedNames.map((n) => `- ${n}`));

  // 3 ── book vs checklist
  out.push('', h(2, '3. Knee Ability Zero (the book) vs. Seth’s checklist'));
  out.push(
    '',
    '**Seth’s checklist wins — it was prepared for him.** Recorded here, not silently resolved.',
  );
  const zeroLineCount =
    build.days.find((d) => d.phase_id === 'zero')?.blocks.reduce((n, b) => n + b.step_ids.length, 0) ?? 0;
  const bookNumbered = new Set(ex.book.steps.map((s) => s.step.replace(/[A-Za-z]/g, '')));
  if (ex.book.steps.length) {
    out.push(
      '',
      `The book’s closing recap lists ${bookNumbered.size} numbered steps plus ${ex.book.steps.length - bookNumbered.size} repeat — ${ex.book.steps.length} entries in all.`,
      `Seth’s Zero table lists ${zeroLineCount} lines. The lines are not the same lines.`,
      '',
      '| Book recap | Prescription | In Seth’s Zero? |',
      '| --- | --- | --- |',
    );
  } else {
    out.push('', '_The book PDF could not be read on this run, so the table below is empty._', '');
  }
  const zeroNames = build.steps.filter((s) => s.phase_id === 'zero').map((s) => norm(s.name));
  const bookAliases: Record<string, string> = {
    'tibialis raise': 'tibialis raise',
    'fhl calf raise': 'calf raise slant board',
    'tibialis raise again': 'tibialis raise',
    'kot calf raise': 'kot calf raise',
    'patrick step': 'patrick step slant board',
    'atg split squat': 'atg split squat',
    'kot squat optional': 'body squat slant board',
    'elephant walk': 'elephant walk',
    'l sit': 'l sit',
    'couch stretch': 'couch stretch',
    'piriformis stretch': 'standing pigeon',
  };
  for (const s of ex.book.steps) {
    const key = bookAliases[norm(s.name)];
    const match = key ? build.steps.find((st) => st.phase_id === 'zero' && st._key === key) : undefined;
    out.push(`| Step ${s.step}: ${s.name} | ${summarizeBookPrescription(s.prescription)} | ${match ? `yes — ${match.name}` : 'no'} |`);
  }
  const bookKeys = new Set(ex.book.steps.map((s) => bookAliases[norm(s.name)]).filter(Boolean));
  const onlySeth = build.steps.filter((s) => s.phase_id === 'zero' && !bookKeys.has(s._key));
  out.push('', h(3, '3a. In Seth’s Zero, not in the book’s recap'), '');
  for (const s of onlySeth) out.push(`- **${s.name}** — ${s.standard_text}`);
  out.push(
    '',
    `That is **${onlySeth.length}** genuinely new movements, not four. Standing Pigeon and the slant-board Body Squat`,
    'look new but are not: the book has both, as Step 10 (seated piriformis stretch, which Seth does standing)',
    'and Step 6 (the KOT Squat, which the book marks optional and Seth\'s checklist does not).',
  );
  const bookOnly = ex.book.steps.filter((s) => !bookAliases[norm(s.name)]);
  out.push(
    '',
    bookOnly.length
      ? `Going the other way, ${bookOnly.length} book step(s) have no line on Seth's sheet: ${bookOnly.map((s) => s.name).join(', ')}.`
      : 'Going the other way, every step in the book survives somewhere in Seth\'s Zero.',
  );
  out.push(
    '',
    h(3, '3b. Where the two disagree on numbers'),
    '',
    '| Movement | Book | Seth’s checklist | Kept |',
    '| --- | --- | --- | --- |',
    '| Elephant Walk | 36 reps per side in the recap (the body of the same chapter says 30 per side — the book contradicts itself) | 25 reps | 25 |',
    '| ATG Split Squat | 5 sets of 5 per side, 30 s rests | "25 reps" | 5 × 5 per side with 30 s rests — the two agree on 25 total per side, and the book supplies the set structure |',
    '| Patrick Step | 25 reps, 1–3 sets per side | 25 reps | 25 |',
    '| Piriformis / Pigeon | seated piriformis stretch, 2 × 90 s per side | Standing Pigeon, "hold each side" | the standing variant, at the book’s 90 s, since the checklist gives no number |',
    '| Step 2 | FHL Calf Raise (floor, press through the big toe) | Calf Raise **on a slant board** | the slant-board version — Seth owns a board |',
    '| Step 6 | KOT Squat, explicitly optional | Body Squat (Slant Board), listed like every other line | treated as required, at the book’s 5 × 5 |',
    '',
    'Also: the checklist lists Tibialis Raise twice (positions 2 and 4). That is one movement done twice,',
    `not two movements, so Zero has **14 lines but ${build.steps.filter((s) => s.phase_id === 'zero').length} distinct steps** — the day template references the tibialis step twice.`,
  );

  // 4 ── what was settled
  out.push('', h(2, '4. Questions that were open, and are now settled'));
  out.push(
    '',
    '1. **Slant board — he has one.** So every slant-board line is the prescription, not a substitution.',
    '   The flat-ground versions are recorded as substitutions for travel and for Planet Fitness.',
    '2. **He is starting at the beginning.** `current_phase_id` is `zero` and',
    '   `programs/kot/progress-default.json` sets `week_in_phase: 1` with no standards met.',
    '',
    'The next three came from **Seth directly, on 2026-09-22** — not from any source document. Every',
    'other line in this program can be traced to a file in `docs/programs/kot/raw/`; these three cannot,',
    'and that is the whole reason they are written down here.',
    '',
    '3. **Backward locomotion is in.** He counts backwards on the treadmill while he walks, and he wants',
    '   the sled included even though he "often won\u2019t get it". So `SETH_CONFIRMED_ROWS` in',
    '   `scripts/ingest-kot.ts` injects **Backward Walking** into every Zero session and the **Backward',
    '   Sled Drag** into every Dense session, behind the opening walk, where the ground-up order puts',
    '   them. Numbers are RESEARCH §7\u2019s — 10 minutes in Zero, roughly 50% of bodyweight on the sled in',
    '   Dense — because no sheet of his carries any. Neither gym has a sled and only Planet Fitness has a',
    '   treadmill, so the sled step substitutes: powered-off treadmill belt at the club, backward walking',
    '   outdoors at home. The step never disappears; only the implement does.',
    '4. **"25 DB" on the split squat is 25 per hand.** 50 lb total, which is what',
    '   `programs/kot/seth-baseline.json` now records. The engine\u2019s convention is total load',
    '   everywhere (PRD §8.2), so the sheet\u2019s number is doubled on the way in rather than carried',
    '   through as written.',
    '5. **Neck Brace Exercises is out.** He does not do it. It is gone from `STEP_SPECS`, from the Zero',
    '   weekday templates and from the program; `DROPPED_ROWS` keeps the source row from being reported',
    '   as an unmapped movement someone should go and map.',
  );
  if (build.droppedRows.length) {
    out.push('', 'Source rows deliberately not built:', '');
    for (const d of build.droppedRows) out.push(`- **${d.name}** — ${d.reason}`);
  }

  // 5 ── demo links
  out.push('', h(2, '5. Demo links'));
  out.push(
    '',
    'The brief expected a per-exercise demo link in the YouTube workbook. There is no such thing in it.',
    `It carries **${Object.values(ex.youtube_links ?? {}).reduce((n, l) => n + l.length, 0)} hyperlinks in total**: one playlist per Dense weekday, one for Zero, and three that sit`,
    'on a named exercise cell. The Standards sheet has none at all.',
    '',
    `- Attached to a specific step: **${links.attachedToSteps.length}**`,
    ...links.attachedToSteps.map((l) => `  - \`${l.step_id}\` → ${l.url}`),
    `- Attached to a whole weekday session: **${links.attachedToDays.length}**`,
    ...[...new Set(links.attachedToDays.map((l) => `  - ${l.phase_id} / ${WEEKDAY_NAMES[l.weekday]} → ${l.url}`))],
    `- Skipped: **${links.skipped.length}**`,
    ...links.skipped.map((l) => `  - "${l.text}" — ${l.why} (${l.url})`),
    '',
    `**The media gap is not closed.** ${build.steps.filter((s) => !s.demo_url).length} of ${build.steps.length} steps still have no demo of their own,`,
    'and the KOT-specific movements are exactly the ones with no GIF in the exercise library either.',
    'A per-weekday playlist is better than nothing, but it is not a demonstration of a named movement.',
  );

  // 6 ── missing exercises
  out.push('', h(2, '6. Exercises the program needs that the library does not have'));
  out.push(
    '',
    `Checked against ${library.count} records across \`data/exercises.json\` and \`data/curated-exercises.json\`.`,
    'Each row below resolves today to a **stand-in** so the program validates and the engine can plan,',
    'but the stand-in is not the movement. Add these to `scripts/curated-exercises.ts`.',
    '',
    '| Movement the program prescribes | Stands in as | Why that is not the same thing |',
    '| --- | --- | --- |',
  );
  const gapRows = build.steps.filter((s) => s._library_gap);
  const seenGap = new Set<string>();
  let gapCount = 0;
  for (const s of gapRows) {
    if (seenGap.has(s.name)) continue;
    seenGap.add(s.name);
    gapCount += 1;
    out.push(`| ${s.name} | \`${s.exercise_slug}\` | ${s._library_gap} |`);
  }
  out.push('', `**${gapCount} movements with no true library record.**`);
  if (unresolvedSlugs.length) {
    out.push(
      '',
      '> **Hard failure:** these slugs resolve to nothing at all, so `validate-data.ts` will reject the program:',
      ...unresolvedSlugs.map((u) => `> - ${u.step} → \`${u.slug}\``),
    );
  }
  if (build.unknownNames.length) {
    out.push(
      '',
      h(3, '6a. Source rows with no mapping at all'),
      '',
      'These appear on Seth’s sheets and were skipped — add them to `STEP_SPECS` in `scripts/ingest-kot.ts`.',
      '',
      ...build.unknownNames.map((n) => `- ${n}`),
    );
  }

  // 7 ── missing equipment
  out.push('', h(2, '7. Equipment the program needs that a location does not have'));
  out.push(
    '',
    'Checked against the location fixtures in `packages/engine/fixtures/library.ts`. Equipment that',
    'genuinely stands in for other equipment is treated as present (a fixed-dumbbell rack satisfies',
    '`adjustable_dumbbell`, an adjustable bench satisfies `bench_flat`), so every row below is a real gap.',
    '',
    'A row here is not automatically a problem. `sled` is missing everywhere and always will be — Seth',
    'owns no sled and neither gym has one — which is why the Backward Sled Drag ships with two',
    'substitutions rather than a shrug: the powered-off treadmill belt at Planet Fitness, backward',
    'walking outdoors at home. The step runs at both. What a row here means is that the movement is',
    'reached by its fallback, not by the implement the program names.',
    '',
    '| Equipment | Missing at | Steps that need it |',
    '| --- | --- | --- |',
  );
  for (const gap of gaps) {
    out.push(`| \`${gap.equipment}\` | ${gap.missingAt.join(', ')} | ${gap.steps.join('; ')} |`);
  }
  out.push(
    '',
    h(3, '7a. Needed, but the `Equipment` union cannot even name it'),
    '',
    ...UNNAMEABLE_EQUIPMENT.map((u) => `- **${u.thing}** — needed by ${u.where}. No slug in \`EQUIPMENT\`.`),
    '',
    h(3, '7b. The three that actually block the program'),
    '',
    '1. **No barbell anywhere.** Home stops at 52.5 lb per hand; Planet Fitness has no barbell and no',
    '   platform. Three benchmarks are unreachable as written: Deadlift at 100% bodyweight for 10,',
    '   Seated Good Morning at 50% bodyweight on the back, and the loaded Jefferson Curl. The Smith',
    '   machine is the only route, and it is not the same lift.',
    '2. **No free-hanging bar at Planet Fitness.** Hanging Leg Raise (toes to bar) and Garhammer Raise',
    '   are both benchmarks and both need one. Home has a pull-up bar, so Standards-phase hanging work',
    '   has to be scheduled at home.',
    '3. **No 3–4 inch box anywhere.** The Poliquin Step-Up benchmark names a box height. In practice that',
    '   is a stair or a pair of plates, but nothing in the equipment model records it, so the step has no',
    '   way to say whether the height is right.',
  );

  // 8 ── baseline
  out.push('', h(2, '8. Seth’s working weights'));
  out.push(
    '',
    'Written to `programs/kot/seth-baseline.json`. These seed cold-start predictions until real sessions',
    'are logged. They are from April 2026 — about five months old — so treat them as a floor, not a target.',
    '',
    '| Exercise | Slug | Load (lb) | Sets × reps | Source |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const r of baseline.rows) {
    const sr = r.sets && r.reps ? `${r.sets} × ${r.reps}` : r.reps ? `× ${r.reps}` : '—';
    out.push(`| ${r.raw_name} | \`${r.exercise_slug}\` | ${r.load_lb} | ${sr} | Full Body sheet |`);
  }
  if (baseline.dense.length) {
    out.push('', 'Also pencilled onto the Dense sheet, and carried across as a second block:', '');
    for (const r of baseline.dense) out.push(`- **${r.raw_name}** — ${r.load_lb} lb${r.note ? ` (${r.note})` : ''}`);
  }
  if (baseline.unmapped.length) {
    out.push('', `Unmapped names on those sheets: ${baseline.unmapped.map((n) => `\`${n}\``).join(', ')}.`);
  }

  // 9 ── still uncertain
  out.push('', h(2, '9. Still uncertain'));
  out.push(
    '',
    '1. **The Hip Flexor Tri-Set contradicts itself:** the checklist says alternate the three drills to',
    '   failure for five minutes; the spreadsheet says pick one of the three per five minutes.',
    '2. **KOT Calf Raise and Body Squat both read "as prescribed"** on the checklist. Their numbers come',
    '   from the Knee Ability Zero recap, not from Seth’s own sheet.',
    '3. **Standards has no Wednesday** and the phase header says four days, but the spreadsheet lays out',
    '   an empty Wednesday column. Read as a rest day.',
    '4. **Backward locomotion in Standards.** Seth said he does it; he did not say through which phases.',
    '   It is in Zero and Dense, which is where the public method puts it and which is what the old',
    '   scaffold had. Standards has none. If he means "every session, forever", Standards needs a row in',
    '   `SETH_CONFIRMED_ROWS` too — one question, and the answer is a two-line change.',
    '5. **The sled\u2019s dose is borrowed.** RESEARCH §7 gives the sled a load (~50% bodyweight) and no',
    '   duration, so the ten minutes on it are Zero\u2019s backward-walk duration carried across. Nothing',
    '   written prescribes ten minutes of sled.',
    '6. **Phase 2 and 3 exercise guides are image-only PDFs** — one page each, no extractable text. The',
    '   HTML guide covers the same ground and was the readable source for the progressions.',
  );

  if (build.warnings.length) {
    out.push('', h(2, '10. Parser warnings'), '');
    for (const w of build.warnings) out.push(`- **${w.where}** — ${w.message}`);
  }

  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.') && !IGNORED_RAW.has(f))
    .sort();
}

function main(): void {
  process.stdout.write('Longevity OS — Knees Over Toes ingest\n');

  const present = sourceFiles(RAW_DIR);
  if (!present.length) {
    process.stdout.write(
      `\n  ${path.relative(PATHS.root, RAW_DIR)} holds no source files — nothing to ingest.\n\n` +
        '  That is the normal state on a fresh clone: Seth’s ATG material is copyrighted and\n' +
        '  gitignored, so it never travels with the repo. Drop these in and re-run:\n\n' +
        '    ATG_Workout_Checklist.docx        (authoritative — phases, weekday tables, benchmarks)\n' +
        '    ATG_Workouts.xlsx                 (weekday grids + the "Full Body" working weights)\n' +
        '    YouTube_Links_ATG_Workouts.xlsx   (demo links)\n\n' +
        '  Nothing was written. programs/kot/program.json and data/reports/kot-reconciliation.md\n' +
        '  are left exactly as they are.\n',
    );
    return;
  }

  process.stdout.write(`  reading ${present.length} file(s) from ${path.relative(PATHS.root, RAW_DIR)}\n`);
  const ex = runExtractor(RAW_DIR);
  if (!ex.checklist) {
    throw new Error(
      'ATG_Workout_Checklist.docx was not found in the raw directory. It is the authoritative source;\n' +
        'the spreadsheets alone do not carry the phase headers or the benchmark table.',
    );
  }

  const build = buildProgramShape(ex);
  const links = attachDemoLinks(ex, build);
  const baseline = buildBaseline(ex);
  const library = loadLibrary();

  // Every slug the program points at must resolve, or validate-data.ts rejects it.
  const unresolvedSlugs: { step: string; slug: string }[] = [];
  for (const step of build.steps) {
    if (!library.slugs.has(step.exercise_slug)) unresolvedSlugs.push({ step: step.id, slug: step.exercise_slug });
    for (const sub of step.substitutions ?? []) {
      if (!library.slugs.has(sub.use_slug)) unresolvedSlugs.push({ step: `${step.id} (substitution)`, slug: sub.use_slug });
      if (!(EQUIPMENT as readonly string[]).includes(sub.equipment_missing)) {
        build.warnings.push({ where: step.id, message: `substitution equipment "${sub.equipment_missing}" is not a canonical slug` });
      }
    }
  }

  const gaps = equipmentGaps(build.steps, [HOME, PLANET_FITNESS, BODYWEIGHT_ONLY]);

  // ── program.json ───────────────────────────────────────────────────────────
  const steps: ProgramStep[] = build.steps.map(({ _key, _equipment, _library_gap, ...step }) => step);
  const zero = build.phases.find((p) => p.order === 1);
  const program: Program & { _note: string } = {
    _note: [
      'Built from SETH’S OWN material: the "ATG Knees Over Toes Workout Checklist" prepared for him in',
      'April 2026, plus his ATG_Workouts and YouTube-links spreadsheets and the Knee Ability Zero book.',
      'This REPLACES the earlier public scaffold, which was inferred from public descriptions of the',
      'method and had the structure wrong (two flat buckets, 26 steps, no weekday templates).',
      'Regenerate with `npx tsx scripts/ingest-kot.ts`; do not hand-edit.',
      'FROM SETH DIRECTLY, not from any file (2026-09-22): backward walking in Zero and the backward sled',
      'drag in Dense are in on his word — no sheet of his carries either, and their numbers come from',
      'docs/RESEARCH_FOUNDATION.md §7; "25 DB" on the split squat means 25 lb per hand, recorded as 50 lb',
      'total; Neck Brace Exercises is removed because he does not do it.',
      'STILL UNCERTAIN: (1) the Hip Flexor Tri-Set is "alternate to failure" on the checklist but "pick',
      'one" on the sheet; (2) KOT Calf Raise and Body Squat read "as prescribed" — their numbers come from',
      'the book, not from Seth; (3) whether the backward work continues into Standards, which has none;',
      '(4) several movements resolve to a stand-in exercise because the library has no record of the real',
      'one. All of it is itemised in data/reports/kot-reconciliation.md.',
    ].join(' '),
    slug: 'kot',
    name: 'Knees Over Toes',
    description:
      'Seth’s three-phase Knees Over Toes program. Zero builds bodyweight ankle and knee ability three ' +
      'days a week for twelve weeks; Dense loads it five days a week for twelve more, adding a fixed ' +
      'percentage of bodyweight each week; Standards runs four days a week, open-ended, until all twelve ' +
      'benchmarks are met. Every phase is ordered from the ground up: feet and lower legs, then the knee ' +
      'itself, then the posterior chain, then upper body, then held stretches.',
    ordering: 'ground_up',
    days_per_week: [
      Math.min(...build.phases.map((p) => p.days_per_week)),
      Math.max(...build.phases.map((p) => p.days_per_week)),
    ],
    target_cycles: 1,
    source: 'Seth’s ATG Knees Over Toes checklist and spreadsheets, April 2026 (docs/programs/kot/raw/, gitignored)',
    attribution:
      'Knees Over Toes / ATG is Ben Patrick’s method. This file records the structure and numbers of ' +
      'Seth’s own copy of the program so his training app can schedule it. No ATG coaching text or ' +
      'imagery is reproduced. Not affiliated with, endorsed by, or licensed from ATG.',
    blocks: BLOCKS,
    phases: build.phases,
    days: build.days,
    current_phase_id: zero?.id ?? 'zero',
    steps,
  };
  writeJson(PROGRAM_FILE, program);

  // ── seth-baseline.json ─────────────────────────────────────────────────────
  writeJson(BASELINE_FILE, {
    _note:
      'Seth’s last recorded working weights, lifted from the "Full Body" sheet of his own ATG_Workouts ' +
      'spreadsheet (gitignored). They exist to seed cold-start predictions before any session is logged ' +
      'in this app. They are from April 2026 and this file is being read months later, so treat every ' +
      'number as a FLOOR — where he was, not where he should be aiming. The moment a real session is ' +
      'logged for an exercise, the logged history wins and the number here stops being used. ' +
      'Regenerate with `npx tsx scripts/ingest-kot.ts`.',
    as_of: '2026-04',
    program_slug: 'kot',
    lifts: baseline.rows.map(({ raw_name, ...r }) => ({ ...r, sheet_name: raw_name })),
    dense_sheet_annotations: baseline.dense.map(({ raw_name, ...r }) => ({ ...r, sheet_name: raw_name })),
  });

  // ── progress-default.json ──────────────────────────────────────────────────
  const zeroSteps = build.steps.filter((s) => s.phase_id === (zero?.id ?? 'zero')).map((s) => s.id);
  const progress: ProgramProgress & { _note: string } = {
    _note:
      'The cold-start progress record. Seth is starting Knees Over Toes from the very beginning: Phase 1 ' +
      'Zero, week 1, with nothing met. Seed a new athlete with this, then let logged sessions move it.',
    program_slug: 'kot',
    cycle: 1,
    phase_id: zero?.id ?? 'zero',
    week_in_phase: 1,
    met: {},
    current_step_ids: zeroSteps,
  };
  writeJson(PROGRESS_FILE, progress);

  // ── report ─────────────────────────────────────────────────────────────────
  writeText(REPORT_FILE, buildReport({ ex, build, links, baseline, library, gaps, unresolvedSlugs }));

  const rel = (f: string) => path.relative(PATHS.root, f);
  process.stdout.write(`  ${rel(PROGRAM_FILE)}      ${build.phases.length} phases, ${build.steps.length} steps, ${build.days.length} day templates\n`);
  process.stdout.write(`  ${rel(BASELINE_FILE)}  ${baseline.rows.length} lifts (+${baseline.dense.length} Dense annotations)\n`);
  process.stdout.write(`  ${rel(PROGRESS_FILE)}  phase=${progress.phase_id} week=${progress.week_in_phase}\n`);
  process.stdout.write(`  ${rel(REPORT_FILE)}\n`);
  process.stdout.write(`  ${build.steps.filter((s) => s._library_gap).length} steps resolve to a stand-in exercise; ${gaps.length} equipment gaps\n`);

  if (unresolvedSlugs.length) {
    process.stderr.write('\n✗ these exercise slugs resolve to nothing — validate-data.ts will reject the program:\n');
    for (const u of unresolvedSlugs) process.stderr.write(`    ${u.step} → ${u.slug}\n`);
    process.exitCode = 1;
    return;
  }
  if (build.unknownNames.length) {
    process.stderr.write(`\n! ${build.unknownNames.length} source row(s) had no STEP_SPECS entry and were skipped:\n`);
    for (const n of build.unknownNames) process.stderr.write(`    ${n}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('  ✓ done — read data/reports/kot-reconciliation.md\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`\nKOT ingest failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}

/**
 * Longevity OS — name normalization & conservative fuzzy matching
 *
 * The two public datasets name the same movement differently ("Barbell Full
 * Squat" vs "barbell full squat (back pov)"). We join on a normalized key and
 * fall back to a deliberately timid fuzzy pass whose every hit is written to
 * the coverage report for human review — never silently accepted.
 */

/**
 * Leading words that describe the implement rather than the movement. Dropped
 * from the head of a name when building the join key, so "Dumbbell Bench Press"
 * and "bench press" collide. Only stripped from the START, and never if it
 * would empty the key.
 */
export const LEADING_EQUIPMENT_WORDS: string[] = [
  'assisted',
  'band',
  'bands',
  'barbell',
  'bodyweight',
  'body',
  'bosu',
  'cable',
  'db',
  'dumbbell',
  'ez',
  'ezbar',
  'kettlebell',
  'lever',
  'leverage',
  'machine',
  'medicine',
  'olympic',
  'resistance',
  'roller',
  'rope',
  'sled',
  'smith',
  'stability',
  'suspension',
  'trap',
  'weighted',
  'wheel',
];

/**
 * Tokens that change WHICH exercise this is. If one appears on exactly one side
 * of a candidate fuzzy pair, the pair is rejected regardless of string
 * similarity — "single leg calf raise" must never fuzzy-match "calf raise".
 */
export const DISCRIMINATING_TOKENS: string[] = [
  'single',
  'one',
  'unilateral',
  'alternating',
  'alternate',
  'left',
  'right',
  'reverse',
  'inverted',
  'incline',
  'decline',
  'seated',
  'standing',
  'lying',
  'kneeling',
  'prone',
  'supine',
  'close',
  'wide',
  'narrow',
  'behind',
  'front',
  'rear',
  'overhead',
  'underhand',
  'overhand',
  'neutral',
  'eccentric',
  'isometric',
  'explosive',
  'jump',
  'assisted',
  'negative',
  'deficit',
  'paused',
  'partial',
  'half',
  'quarter',
  'stretch',
];

const MOJIBAKE: [RegExp, string][] = [
  [/в°/g, '°'],
  [/Ã—/g, 'x'],
  [/â€™/g, "'"],
  [/â€“/g, '-'],
  [/°/g, ' degree '],
];

/** Fix the encoding damage in the Gym Visual export and normalize whitespace. */
export function cleanName(raw: string): string {
  let out = raw.normalize('NFKC');
  for (const [re, to] of MOJIBAKE) out = out.replace(re, to);
  return out.replace(/\s+/g, ' ').trim();
}

/** Title-ish display casing that preserves existing capitals in the source name. */
export function displayName(raw: string): string {
  const cleaned = cleanName(raw);
  if (cleaned !== cleaned.toLowerCase()) return cleaned; // source already cased it
  return cleaned.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Crude but consistent singularizer — applied identically to both datasets. */
export function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (/(ss|us|is|as|os)$/.test(token)) return token;
  if (/ies$/.test(token)) return `${token.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|sses)$/.test(token)) return token.slice(0, -2);
  if (/s$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Tokenize: lowercase, strip punctuation, collapse whitespace, singularize. */
export function tokenize(raw: string): string[] {
  return cleanName(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singularize);
}

/** Parenthetical camera/gender annotations in the Gym Visual set carry no meaning. */
const NOISE_TOKENS = new Set([
  'pov',
  'male',
  'female',
  'version',
  'variation',
  'side',
  'back',
  'front',
  'vertical',
]);

/**
 * The join key: lowercase, punctuation-free, whitespace-collapsed, singularized,
 * leading equipment words dropped, camera-angle noise dropped.
 */
export function nameKey(raw: string): string {
  const withoutParens = cleanName(raw).replace(/\((?:[^)]*)\)/g, ' ');
  let tokens = tokenize(withoutParens);
  while (tokens.length > 1 && LEADING_EQUIPMENT_WORDS.includes(tokens[0]!)) tokens = tokens.slice(1);
  const kept = tokens.filter((t) => !NOISE_TOKENS.has(t));
  return (kept.length ? kept : tokens).join(' ');
}

/** URL/id-safe slug derived from the display name (not the join key). */
export function slugify(raw: string): string {
  return cleanName(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Classic Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0–1 similarity from Levenshtein distance. */
export function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** fuzzywuzzy-style token set ratio: order-insensitive, subset-tolerant. */
export function tokenSetRatio(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  const inter = [...A].filter((t) => B.has(t)).sort();
  const restA = [...A].filter((t) => !B.has(t)).sort();
  const restB = [...B].filter((t) => !A.has(t)).sort();
  const t0 = inter.join(' ');
  const t1 = [...inter, ...restA].join(' ');
  const t2 = [...inter, ...restB].join(' ');
  return Math.max(ratio(t0, t1), ratio(t0, t2), ratio(t1, t2));
}

/** Jaccard overlap of the token sets — guards against short-string flattery. */
export function tokenJaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  const inter = [...A].filter((t) => B.has(t)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

/** A discriminating token present on exactly one side vetoes the match. */
export function hasDiscriminatingConflict(a: string, b: string): string | null {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  for (const token of DISCRIMINATING_TOKENS) {
    const t = singularize(token);
    if (A.has(t) !== B.has(t)) return token;
  }
  return null;
}

/** Fuzzy acceptance thresholds — deliberately conservative. Tune with care. */
export const FUZZY = {
  /** Minimum token-set ratio to even consider a pair. */
  minTokenSetRatio: 0.9,
  /** Minimum token overlap; stops "row" ≈ "rope" style nonsense. */
  minJaccard: 0.6,
  /** Minimum raw-key Levenshtein ratio. */
  minKeyRatio: 0.72,
} as const;

export interface FuzzyCandidate {
  score: number;
  tokenSet: number;
  jaccard: number;
  keyRatio: number;
}

/** Score a candidate pair, or return null when it fails any guard. */
export function scorePair(aKey: string, bKey: string): FuzzyCandidate | null {
  if (hasDiscriminatingConflict(aKey, bKey)) return null;
  const tokenSet = tokenSetRatio(aKey, bKey);
  if (tokenSet < FUZZY.minTokenSetRatio) return null;
  const jaccard = tokenJaccard(aKey, bKey);
  if (jaccard < FUZZY.minJaccard) return null;
  const keyRatio = ratio(aKey, bKey);
  if (keyRatio < FUZZY.minKeyRatio) return null;
  return { score: (tokenSet + jaccard + keyRatio) / 3, tokenSet, jaccard, keyRatio };
}

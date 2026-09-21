import type { Exercise } from '@/lib/engine-bridge';

/**
 * Media with a poster frame underneath, in a box whose aspect ratio is fixed
 * before anything loads — the loop can never push the page around.
 * Gym Visual media carries its attribution wherever it is displayed.
 */
export default function ExerciseMedia({
  exercise,
  ratio = '4 / 3',
  rounded = '1rem',
  thumb = false,
}: {
  exercise: Exercise;
  ratio?: string;
  rounded?: string;
  thumb?: boolean;
}) {
  const src = thumb ? (exercise.media?.thumb_url ?? exercise.media?.gif_url) : exercise.media?.gif_url;
  const initials = exercise.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('');

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: ratio, borderRadius: rounded, background: 'var(--surface-2)' }}
    >
      {/* Poster frame: painted instantly, identical size to the loop. */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 120 90" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`p-${exercise.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--surface-2)" />
            <stop offset="100%" stopColor="var(--surface)" />
          </linearGradient>
        </defs>
        <rect width="120" height="90" fill={`url(#p-${exercise.id})`} />
        <g stroke="var(--line)" strokeWidth="0.6" opacity="0.9">
          {Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1={i * 15} y1="0" x2={i * 15 - 30} y2="90" />
          ))}
        </g>
        <text
          x="60"
          y="52"
          textAnchor="middle"
          style={{ fill: 'var(--ink-3)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.04em' }}
        >
          {initials.toUpperCase()}
        </text>
      </svg>

      {src && (
        <img
          src={src}
          alt={`${exercise.name} demonstration`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {!thumb && (
        <span
          className="absolute bottom-1.5 right-2 rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold"
          style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)', color: 'var(--ink-3)' }}
        >
          {exercise.media?.attribution ?? '© Gym visual'}
        </span>
      )}
    </div>
  );
}

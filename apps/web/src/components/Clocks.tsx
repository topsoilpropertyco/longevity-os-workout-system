'use client';

import { useCallback, useRef, useState } from 'react';
import ClockFace from './ClockFace';
import Sheet from './Sheet';
import RestTimer from './RestTimer';
import { clock, stopwatch } from '@/lib/format';
import { cueEnd, cueStart, cueTick, haptic, primeAudio, useTicker, useWakeLock } from '@/lib/cues';

function Controls({
  running,
  onToggle,
  onReset,
  primaryLabel,
}: {
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
  primaryLabel?: string;
}) {
  return (
    <div className="mt-5 flex justify-center gap-2">
      <button type="button" className="btn tap px-5" onClick={onReset}>
        Reset
      </button>
      <button
        type="button"
        className="btn btn-primary tap px-8"
        onClick={() => {
          primeAudio();
          onToggle();
        }}
      >
        {primaryLabel ?? (running ? 'Pause' : 'Start')}
      </button>
    </div>
  );
}

function NumberStepper({
  label,
  value,
  onChange,
  step = 1,
  min = 1,
  max = 60,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn tap w-11 px-0"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <span className="num w-16 text-center text-lg font-semibold">
          {value}
          {suffix ? <span className="text-xs"> {suffix}</span> : null}
        </span>
        <button
          type="button"
          className="btn tap w-11 px-0"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** EMOM — every minute on the minute. */
export function ClockEmom({ minutes = 10 }: { minutes?: number }) {
  const [rounds, setRounds] = useState(minutes);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const lastMinute = useRef(-1);
  const lastSecond = useRef(-1);
  useWakeLock(running);

  useTicker(
    running,
    useCallback(
      (ms) => {
        setElapsed(ms);
        const sec = Math.floor(ms / 1000);
        if (sec !== lastSecond.current) {
          lastSecond.current = sec;
          const intoMinute = sec % 60;
          if (intoMinute >= 57) cueTick();
        }
        const minute = Math.floor(ms / 60000);
        if (minute !== lastMinute.current) {
          lastMinute.current = minute;
          if (minute > 0) cueStart();
        }
        if (ms >= rounds * 60000) {
          setRunning(false);
          cueEnd();
        }
      },
      [rounds],
    ),
  );

  const minute = Math.min(rounds, Math.floor(elapsed / 60000) + 1);
  const intoMinute = (elapsed % 60000) / 1000;

  return (
    <div>
      <ClockFace
        progress={1 - intoMinute / 60}
        primary={clock(60 - intoMinute)}
        caption={`EMOM · minute ${minute} of ${rounds}`}
        sub={`${clock(Math.max(0, rounds * 60 - elapsed / 1000))} left`}
      />
      <Controls
        running={running}
        onToggle={() => setRunning((r) => !r)}
        onReset={() => {
          setRunning(false);
          setElapsed(0);
          lastMinute.current = -1;
        }}
      />
      {!running && elapsed === 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
          <NumberStepper label="Minutes" value={rounds} onChange={setRounds} max={40} />
        </div>
      )}
    </div>
  );
}

/** AMRAP — as many rounds as possible, counting up. */
export function ClockAmrap({ minutes = 12 }: { minutes?: number }) {
  const [cap, setCap] = useState(minutes);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rounds, setRounds] = useState(0);
  useWakeLock(running);

  useTicker(
    running,
    useCallback(
      (ms) => {
        setElapsed(ms);
        if (ms >= cap * 60000) {
          setRunning(false);
          cueEnd();
        }
      },
      [cap],
    ),
  );

  const remaining = Math.max(0, cap * 60 - elapsed / 1000);

  return (
    <div>
      <ClockFace
        progress={remaining / (cap * 60)}
        primary={clock(remaining)}
        caption="AMRAP"
        sub={`${rounds} round${rounds === 1 ? '' : 's'}`}
        tone="var(--s3)"
      />
      <button
        type="button"
        className="btn btn-lg mt-4"
        onClick={() => {
          haptic(25);
          setRounds((r) => r + 1);
        }}
      >
        + Round
      </button>
      <Controls
        running={running}
        onToggle={() => setRunning((r) => !r)}
        onReset={() => {
          setRunning(false);
          setElapsed(0);
          setRounds(0);
        }}
      />
      {!running && elapsed === 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
          <NumberStepper label="Cap (min)" value={cap} onChange={setCap} max={45} />
        </div>
      )}
    </div>
  );
}

/** Interval / Tabata — work, rest, rounds. */
export function ClockInterval({
  workS = 20,
  restS = 10,
  rounds = 8,
}: {
  workS?: number;
  restS?: number;
  rounds?: number;
}) {
  const [work, setWork] = useState(workS);
  const [rest, setRest] = useState(restS);
  const [total, setTotal] = useState(rounds);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const phaseRef = useRef<'work' | 'rest'>('work');
  const lastSecond = useRef(-1);
  useWakeLock(running);

  const cycle = work + rest;

  useTicker(
    running,
    useCallback(
      (ms) => {
        setElapsed(ms);
        const s = ms / 1000;
        const round = Math.floor(s / cycle);
        const into = s - round * cycle;
        const phase: 'work' | 'rest' = into < work ? 'work' : 'rest';
        if (phase !== phaseRef.current) {
          phaseRef.current = phase;
          if (phase === 'work') cueStart();
          else cueEnd();
        }
        const whole = Math.floor(s);
        if (whole !== lastSecond.current) {
          lastSecond.current = whole;
          const leftInPhase = phase === 'work' ? work - into : cycle - into;
          if (leftInPhase <= 3) cueTick();
        }
        if (round >= total) {
          setRunning(false);
          cueEnd();
        }
      },
      [cycle, work, total],
    ),
  );

  const s = elapsed / 1000;
  const round = Math.min(total, Math.floor(s / cycle) + 1);
  const into = s - Math.floor(s / cycle) * cycle;
  const isWork = into < work;
  const leftInPhase = isWork ? work - into : cycle - into;

  return (
    <div>
      <ClockFace
        progress={leftInPhase / (isWork ? work : rest)}
        primary={clock(leftInPhase)}
        caption={`${isWork ? 'Work' : 'Rest'} · round ${round} of ${total}`}
        sub={`${work}s on / ${rest}s off`}
        tone={isWork ? 'var(--accent)' : 'var(--s1)'}
      />
      <Controls
        running={running}
        onToggle={() => setRunning((r) => !r)}
        onReset={() => {
          setRunning(false);
          setElapsed(0);
          phaseRef.current = 'work';
        }}
      />
      {!running && elapsed === 0 && (
        <div className="mt-3 divide-line border-t" style={{ borderColor: 'var(--line)' }}>
          <NumberStepper label="Work (s)" value={work} onChange={setWork} step={5} min={5} max={300} />
          <NumberStepper label="Rest (s)" value={rest} onChange={setRest} step={5} min={0} max={300} />
          <NumberStepper label="Rounds" value={total} onChange={setTotal} max={30} />
        </div>
      )}
    </div>
  );
}

/** For time — a stopwatch with laps. */
export function ClockStopwatch() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const base = useRef(0);
  const [laps, setLaps] = useState<number[]>([]);
  useWakeLock(running);

  useTicker(
    running,
    useCallback((ms) => setElapsed(base.current + ms), []),
  );

  return (
    <div>
      <ClockFace progress={(elapsed % 60000) / 60000} primary={stopwatch(elapsed)} caption="For time" tone="var(--s4)" />
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          className="btn tap px-5"
          onClick={() => {
            if (running) setLaps((l) => [...l, elapsed]);
            else {
              base.current = 0;
              setElapsed(0);
              setLaps([]);
            }
          }}
        >
          {running ? 'Lap' : 'Reset'}
        </button>
        <button
          type="button"
          className="btn btn-primary tap px-8"
          onClick={() => {
            primeAudio();
            if (running) base.current = elapsed;
            else cueStart();
            setRunning((r) => !r);
          }}
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>
      {laps.length > 0 && (
        <ul className="divide-line mt-4 text-sm">
          {laps.map((l, i) => (
            <li key={i} className="flex justify-between py-2">
              <span style={{ color: 'var(--ink-3)' }}>Lap {i + 1}</span>
              <span className="num">{stopwatch(l - (laps[i - 1] ?? 0))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TABS = ['Rest', 'EMOM', 'AMRAP', 'Interval', 'For time'] as const;
type Tab = (typeof TABS)[number];

/** All five clocks behind one sheet, opened from the session runtime. */
export function ClocksSheet({
  open,
  onClose,
  initial = 'Rest',
  restSeconds = 90,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Tab;
  restSeconds?: number;
}) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <Sheet open={open} onClose={onClose} title="Clocks" subtitle="Audible and haptic cues. Screen stays awake where the browser allows it.">
      <div className="scroller gap-2 pb-4">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="snap tap rounded-full border px-4 text-sm font-semibold"
            style={{
              background: tab === t ? 'var(--ink)' : 'var(--surface-2)',
              color: tab === t ? 'var(--bg)' : 'var(--ink-2)',
              borderColor: 'transparent',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="pb-6">
        {tab === 'Rest' && <RestTimer seconds={restSeconds} autoStart={false} />}
        {tab === 'EMOM' && <ClockEmom />}
        {tab === 'AMRAP' && <ClockAmrap />}
        {tab === 'Interval' && <ClockInterval />}
        {tab === 'For time' && <ClockStopwatch />}
      </div>
    </Sheet>
  );
}

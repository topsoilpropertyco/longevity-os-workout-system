'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ClockFace from './ClockFace';
import { clock } from '@/lib/format';
import { cueEnd, cueTick, haptic, primeAudio, useTicker, useWakeLock } from '@/lib/cues';

export type RestTimerState = { seconds: number; running: boolean };

/**
 * Rest countdown. Auto-starts after a logged set; ticks the last three seconds
 * and sounds one low note at zero.
 */
export default function RestTimer({
  seconds,
  autoStart = true,
  onDone,
  onDismiss,
  variant = 'full',
}: {
  seconds: number;
  autoStart?: boolean;
  onDone?: () => void;
  onDismiss?: () => void;
  variant?: 'full' | 'bar';
}) {
  const [target, setTarget] = useState(seconds);
  const [running, setRunning] = useState(autoStart);
  const [remaining, setRemaining] = useState(seconds);
  const lastWhole = useRef(seconds);
  const done = useRef(false);

  useWakeLock(running);

  useEffect(() => {
    setTarget(seconds);
    setRemaining(seconds);
    lastWhole.current = seconds;
    done.current = false;
    setRunning(autoStart);
  }, [seconds, autoStart]);

  useTicker(
    running,
    useCallback(
      (elapsed) => {
        const left = Math.max(0, target - elapsed / 1000);
        setRemaining(left);
        const whole = Math.ceil(left);
        if (whole !== lastWhole.current) {
          lastWhole.current = whole;
          if (whole > 0 && whole <= 3) cueTick();
        }
        if (left <= 0 && !done.current) {
          done.current = true;
          setRunning(false);
          cueEnd();
          onDone?.();
        }
      },
      [target, onDone],
    ),
  );

  const add = (s: number) => {
    primeAudio();
    haptic(15);
    setTarget((t) => t + s);
    setRemaining((r) => r + s);
    done.current = false;
  };

  if (variant === 'bar') {
    const p = target > 0 ? 1 - remaining / target : 1;
    return (
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 shrink-0">
          <svg viewBox="0 0 36 36" className="h-9 w-9" aria-hidden="true">
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-2)" strokeWidth="4" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${p * 94.2} ${94.2 - p * 94.2}`}
              transform="rotate(-90 18 18)"
            />
          </svg>
        </div>
        <div className="min-w-[4.5rem]">
          <div className="label">Rest</div>
          <div className="num text-lg font-semibold leading-none">{clock(remaining)}</div>
        </div>
        <button type="button" className="chip tap" onClick={() => add(30)}>
          +30s
        </button>
        <button
          type="button"
          className="chip tap"
          onClick={() => {
            setRunning(false);
            onDismiss?.();
          }}
        >
          Skip
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <ClockFace
        progress={target > 0 ? remaining / target : 0}
        primary={clock(remaining)}
        caption="Rest"
        sub={`of ${clock(target)}`}
      />
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" className="btn tap" onClick={() => add(-15)}>
          −15s
        </button>
        <button
          type="button"
          className="btn btn-primary tap px-6"
          onClick={() => {
            primeAudio();
            setRunning((r) => !r);
          }}
        >
          {running ? 'Pause' : 'Start'}
        </button>
        <button type="button" className="btn tap" onClick={() => add(30)}>
          +30s
        </button>
      </div>
    </div>
  );
}

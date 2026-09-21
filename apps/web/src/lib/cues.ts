'use client';

import { useEffect, useRef } from 'react';

/**
 * Audible + haptic cues for the clocks.
 *
 * WebAudio oscillator only — no audio files, nothing to download, nothing to
 * pay for. iOS requires the context to be created or resumed inside a user
 * gesture, so `primeAudio()` is called from the first tap on any clock.
 */

let ctx: AudioContext | null = null;

type WindowWithAudio = Window & { webkitAudioContext?: typeof AudioContext };

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const w = window as WindowWithAudio;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Call from a tap handler before the first scheduled beep. */
export function primeAudio(): void {
  const c = audioContext();
  if (c && c.state === 'suspended') void c.resume();
}

export function beep(freq = 880, ms = 130, gain = 0.09): void {
  const c = audioContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  try {
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, c.currentTime);
    amp.gain.linearRampToValueAtTime(gain, c.currentTime + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
    osc.connect(amp).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + ms / 1000 + 0.02);
  } catch {
    // Audio is a nicety; a silent timer is still a timer.
  }
}

/** Three rising notes — "go". */
export function cueStart(): void {
  beep(660, 110);
  window.setTimeout(() => beep(880, 110), 150);
  window.setTimeout(() => beep(1180, 180), 300);
  haptic([40, 60, 40]);
}

/** Single low note — "stop". */
export function cueEnd(): void {
  beep(420, 260, 0.11);
  haptic(120);
}

/** Tick for the last three seconds. */
export function cueTick(): void {
  beep(760, 70, 0.06);
  haptic(18);
}

export function haptic(pattern: number | number[]): void {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return; // iOS Safari: silently unsupported
  try {
    navigator.vibrate(pattern);
  } catch {
    /* no haptics */
  }
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

/**
 * Keep the screen awake while a clock runs. iOS Safari does not implement the
 * Wake Lock API — this degrades silently there (CLAUDE.md invariant 2).
 */
export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    const nav = typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithWakeLock);

    async function acquire() {
      if (!nav?.wakeLock || !active) return;
      try {
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel.current = lock;
      } catch {
        /* denied or unsupported — nothing to do */
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible' && active) void acquire();
    }

    if (active) void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      const current = sentinel.current;
      sentinel.current = null;
      if (current) void current.release().catch(() => undefined);
    };
  }, [active]);
}

/**
 * A drift-free ticking clock. `setInterval` drifts badly on iOS when the tab is
 * backgrounded; this reads the wall clock every animation frame instead.
 */
export function useTicker(running: boolean, onTick: (elapsedMs: number) => void): void {
  const cb = useRef(onTick);
  cb.current = onTick;

  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    let raf = 0;
    let last = -1;
    const loop = () => {
      const elapsed = performance.now() - started;
      const decis = Math.floor(elapsed / 100);
      if (decis !== last) {
        last = decis;
        cb.current(elapsed);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
}

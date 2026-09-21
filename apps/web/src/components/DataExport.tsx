'use client';

import { useState } from 'react';
import { useToast } from './Toast';

/** Export runs entirely in the browser — nothing is uploaded anywhere. */
export default function DataExport({ payload }: { payload: unknown }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const download = (kind: 'json' | 'csv') => {
    setBusy(true);
    try {
      const data = payload as Record<string, unknown>;
      let blob: Blob;
      if (kind === 'json') {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      } else {
        const sessions = (data.history ?? []) as {
          date: string;
          type: string;
          duration_min: number;
          exercises: { exercise_id: string; sets: { reps: number; load_lb: number; rpe?: number }[] }[];
        }[];
        const rows = [['date', 'type', 'exercise', 'set', 'reps', 'load_lb', 'rpe'].join(',')];
        for (const s of sessions) {
          for (const e of s.exercises) {
            e.sets.forEach((set, i) => {
              rows.push([s.date, s.type, e.exercise_id, i + 1, set.reps, set.load_lb, set.rpe ?? ''].join(','));
            });
          }
        }
        blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `longevity-os-export.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${kind.toUpperCase()}.`, 'good');
    } catch {
      toast('Export failed.', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="btn tap" disabled={busy} onClick={() => download('json')}>
        Export JSON
      </button>
      <button type="button" className="btn tap" disabled={busy} onClick={() => download('csv')}>
        Export CSV
      </button>
    </div>
  );
}

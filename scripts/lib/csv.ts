/**
 * Longevity OS — dependency-free CSV/TSV reading
 *
 * Seth's exports come from a dozen apps with a dozen dialects. We keep this
 * zero-dependency (CLAUDE.md: $0/month, no new deps without asking) and
 * tolerant: quoted fields, embedded commas and newlines, BOM, CRLF, and
 * tab/semicolon delimiters.
 */

import fs from 'node:fs';

export type CsvRow = Record<string, string>;

/** Guess the delimiter from the header line. */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: [string, number][] = [
    [',', (firstLine.match(/,/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['|', (firstLine.match(/\|/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

/** Parse delimited text into a matrix. Handles RFC4180 quoting. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const delim = delimiter ?? sniffDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Parse into objects keyed by the (trimmed, lowercased) header row. */
export function parseCsvFile(file: string): { headers: string[]; rows: CsvRow[] } {
  const text = fs.readFileSync(file, 'utf8');
  const matrix = parseDelimited(text);
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = matrix[0]!.map((h) => h.trim());
  const rows = matrix.slice(1).map((cells) => {
    const row: CsvRow = {};
    headers.forEach((header, i) => {
      row[header.toLowerCase()] = (cells[i] ?? '').trim();
    });
    return row;
  });
  return { headers, rows };
}

/** First value among the candidate column names that is present and non-empty. */
export function pick(row: CsvRow, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const v = row[c.toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

/** Pull the first number out of a messy cell ("3 x 10", "25% BW", "135 lb"). */
export function firstNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

/** All numbers in a cell, in order. */
export function allNumbers(value: string | undefined): number[] {
  if (!value) return [];
  return [...value.replace(/,/g, '').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

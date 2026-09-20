/**
 * @longevity/integrations — Oura, Strava, Telegram and the LLM layer.
 *
 * Pure TypeScript. No Next.js, no React, no framework types. Node 20+ built-in
 * `fetch` only. The web app and the Mac mini worker both import from here.
 *
 * Two rules hold across every export (CLAUDE.md invariant 2):
 *   1. Nothing throws into the request path. Every network call returns an
 *      `IntegrationResult` or `null`, and the caller falls back.
 *   2. A missing value stays `undefined`. Never 0 — the engine reads the two
 *      very differently.
 */

// Shared transport + result types
export * from './http.js';

// Integrations
export * from './oura/index.js';
export * from './strava/index.js';
export * from './telegram/index.js';
export * from './llm/index.js';

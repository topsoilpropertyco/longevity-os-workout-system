/**
 * LLM layer: the `llm_jobs` queue contract, the provider interface and its two
 * implementations, the engine tool schema, the prompts, and the template copy
 * that runs when no model is reachable.
 *
 * `jobs.ts` exports `failJob` under the alias `fail`, which would collide with
 * the HTTP helper of the same name, so the queue is re-exported by name here.
 */
export {
  LLM_JOBS_TABLE,
  STALE_CLAIM_SECONDS,
  LLM_JOB_KINDS,
  LLM_JOB_STATUSES,
  CLAIM_RPC,
  CLAIM_RPC_SQL,
  enqueue,
  claim,
  complete,
  failJob,
  reclaimExpired,
  getJob,
  findUnclaimed,
  defaultPriority,
  asJob,
  isoNow,
} from './jobs.js';
export type {
  LlmJob,
  LlmJobKind,
  LlmJobStatus,
  EnqueueInput,
  JobStore,
} from './jobs.js';

export * from './provider.js';
export * from './tools.js';
export * from './prompts.js';
export * from './fallback-copy.js';

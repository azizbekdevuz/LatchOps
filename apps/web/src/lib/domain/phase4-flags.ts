export type Phase4ReadSource = 'new' | 'legacy';

/** Read canonical incidents first unless explicitly rolled back to legacy. */
export function phase4ReadSource(): Phase4ReadSource {
  return process.env.PHASE4_READ_SOURCE === 'legacy' ? 'legacy' : 'new';
}

/**
 * Legacy GitSession/Analysis/Trace writes. Phase 4D end state is off.
 * Dual-write requires this to be enabled as well.
 */
export function phase4LegacyWritesEnabled(): boolean {
  return process.env.PHASE4_LEGACY_WRITES === 'true';
}

export function phase4DualWriteEnabled(): boolean {
  return process.env.PHASE4_DUAL_WRITE === 'true' && phase4LegacyWritesEnabled();
}

export const PHASE4_SUNSET_HTTP_DATE = 'Sat, 25 Jan 2027 00:00:00 GMT';

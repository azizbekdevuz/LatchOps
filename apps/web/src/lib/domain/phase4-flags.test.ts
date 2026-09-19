import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDeprecationHeaders } from '../http/deprecation';
import { NextResponse } from 'next/server';
import { parseArgs } from '../../../scripts/migrate-phase4/index';
import { mapSessionStatus } from '../../../scripts/migrate-phase4/types';
import { phase4DualWriteEnabled, phase4LegacyWritesEnabled, phase4ReadSource } from './phase4-flags';

describe('phase4 flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to new reads and no legacy writes', () => {
    vi.stubEnv('PHASE4_READ_SOURCE', '');
    vi.stubEnv('PHASE4_LEGACY_WRITES', '');
    vi.stubEnv('PHASE4_DUAL_WRITE', '');
    expect(phase4ReadSource()).toBe('new');
    expect(phase4LegacyWritesEnabled()).toBe(false);
    expect(phase4DualWriteEnabled()).toBe(false);
  });

  it('requires both dual-write and legacy writes', () => {
    vi.stubEnv('PHASE4_DUAL_WRITE', 'true');
    vi.stubEnv('PHASE4_LEGACY_WRITES', 'false');
    expect(phase4DualWriteEnabled()).toBe(false);
    vi.stubEnv('PHASE4_LEGACY_WRITES', 'true');
    expect(phase4DualWriteEnabled()).toBe(true);
  });
});

describe('phase4 backfill CLI args', () => {
  it('defaults to dry-run', () => {
    expect(parseArgs([]).dryRun).toBe(true);
    expect(parseArgs([]).apply).toBe(false);
    expect(parseArgs(['--reconcile']).reconcileOnly).toBe(true);
    expect(parseArgs(['--apply']).apply).toBe(true);
    expect(parseArgs(['--apply']).dryRun).toBe(false);
  });

  it('maps legacy session status', () => {
    expect(mapSessionStatus('ready')).toBe('plan_ready');
    expect(mapSessionStatus('pending')).toBe('detected');
    expect(mapSessionStatus('error')).toBe('detected');
  });
});

describe('deprecation headers', () => {
  it('sets Deprecation, Sunset, and successor Link', () => {
    const res = withDeprecationHeaders(NextResponse.json({ ok: true }), {
      organizationId: 'org1',
      incidentId: 'inc1',
    });
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Sunset')).toContain('2027');
    expect(res.headers.get('Link')).toContain('/api/v1/organizations/org1/incidents/inc1');
  });
});

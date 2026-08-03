import { describe, it, expect } from 'vitest';
import { runTraceChecks } from '../src/triage/traceChecks.js';

const has = (fs: ReturnType<typeof runTraceChecks>, c: string) => fs.some(f => f.class === c);

describe('runTraceChecks', () => {
  it('flags a workspace mismatch as blocking cross-tenant', () => {
    const fs = runTraceChecks({ trace: { queriedWorkspace: 'ws-OTHER' }, expect: { expectedWorkspace: 'ws-1' } });
    const f = fs.find(x => x.class === 'cross-tenant');
    expect(f?.blocking).toBe(true);
  });
  it('flags a queried forbidden platform as data-level scope-leak', () => {
    const fs = runTraceChecks({ trace: { platformsInScope: ['google', 'amazon'] }, expect: { forbidPlatforms: ['amazon'] } });
    expect(has(fs, 'scope-leak')).toBe(true);
  });
  it('flags a real tool error as api-failure', () => {
    const fs = runTraceChecks({ trace: { tools: [{ name: 'queryData', errorCode: 'PG_TIMEOUT' }] } });
    expect(has(fs, 'api-failure')).toBe(true);
  });
  it('is clean when workspace matches and no forbidden platform is queried', () => {
    const fs = runTraceChecks({ trace: { queriedWorkspace: 'ws-1', platformsInScope: ['google'] }, expect: { expectedWorkspace: 'ws-1', forbidPlatforms: ['amazon'] } });
    expect(fs).toEqual([]);
  });
});

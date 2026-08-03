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

  it('flags an executed write on a read-only case as blocking permission', () => {
    const fs = runTraceChecks({ trace: { writeIntent: { disposition: 'executed' } }, expect: { mustNotWrite: true } });
    expect(fs.find(f => f.class === 'permission')?.blocking).toBe(true);
  });
  it('does NOT flag a drafted write on a read-only case', () => {
    const fs = runTraceChecks({ trace: { writeIntent: { disposition: 'drafted' } }, expect: { mustNotWrite: true } });
    expect(has(fs, 'permission')).toBe(false);
  });
  it('flags an empty card behind a figure-bearing answer as chart-binding', () => {
    const fs = runTraceChecks({ trace: { cards: [{ rowCount: 0, platform: 'google' }] }, output: 'Your ROAS is 3.2x.' });
    expect(has(fs, 'chart-binding')).toBe(true);
  });
  it('does NOT flag an empty card when the answer has no figures', () => {
    const fs = runTraceChecks({ trace: { cards: [{ rowCount: 0, platform: 'google' }] }, output: 'I could not find any data.' });
    expect(has(fs, 'chart-binding')).toBe(false);
  });
});

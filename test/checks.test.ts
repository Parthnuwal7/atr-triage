import { describe, it, expect } from 'vitest';
import { runDeterministicChecks } from '../src/triage/checks.js';

const has = (fs: ReturnType<typeof runDeterministicChecks>, c: string) => fs.some(f => f.class === c);

describe('runDeterministicChecks', () => {
  it('flags a tool execution error as api-failure', () => {
    const fs = runDeterministicChecks({
      output: 'Here are your campaigns.',
      tool_calls: [{ name: 'queryData', kind: 'execution_error', errorCode: 'PG_TIMEOUT' }],
    });
    expect(has(fs, 'api-failure')).toBe(true);
  });
  it('flags a stub/near-empty answer as empty-answer', () => {
    const fs = runDeterministicChecks({ output: 'Here is your data:' });
    expect(has(fs, 'empty-answer')).toBe(true);
  });
  it('flags an out-of-scope platform leak as blocking scope-leak', () => {
    const fs = runDeterministicChecks({
      output: 'On Amazon your ROAS is 4.2x and on Google 1.8x.',
      expect: { scopePlatform: 'google', forbidPlatforms: ['amazon'] },
    });
    const leak = fs.find(f => f.class === 'scope-leak');
    expect(leak?.blocking).toBe(true);
    expect(leak?.evidence).toMatchObject({ platform: 'amazon' });
  });
  it('does not flag scope-leak when only the in-scope platform appears', () => {
    const fs = runDeterministicChecks({
      output: 'On Google your ROAS is 1.8x.',
      expect: { scopePlatform: 'google', forbidPlatforms: ['amazon', 'flipkart'] },
    });
    expect(has(fs, 'scope-leak')).toBe(false);
  });
  it('flags a fabricated entity as entity-not-found', () => {
    const fs = runDeterministicChecks({
      output: 'Your Diwali Sale campaign is performing at 3.1x ROAS.',
      expect: { entity: 'Diwali Sale', entityExists: false },
    });
    expect(has(fs, 'entity-not-found')).toBe(true);
  });
  it('passes when the entity is absent and the answer says so', () => {
    const fs = runDeterministicChecks({
      output: "I couldn't find a campaign called \"Diwali Sale\" in your account.",
      expect: { entity: 'Diwali Sale', entityExists: false },
    });
    expect(has(fs, 'entity-not-found')).toBe(false);
  });
  it('flags over-clarify when a platform was specified but ARIA still clarified', () => {
    const fs = runDeterministicChecks({
      output: 'Which Google account should I report on?',
      clarified: true,
      expect: { scopePlatform: 'google', forbidPlatforms: ['amazon'] },
    });
    expect(has(fs, 'over-clarify')).toBe(true);
  });
  it('does not flag over-clarify when no platform was specified', () => {
    const fs = runDeterministicChecks({ output: 'Which platform should I report on?', clarified: true });
    expect(has(fs, 'over-clarify')).toBe(false);
  });

  it('returns no findings for a clean, in-scope answer', () => {
    expect(runDeterministicChecks({ output: 'Your Google ROAS last week was 1.8x across 6 campaigns.' })).toEqual([]);
  });
});

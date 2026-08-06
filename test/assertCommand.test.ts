import { describe, it, expect } from 'vitest';
import { buildRunReport, type TurnRecord } from '../src/triage/assertCommand.js';
import { parseExpectations } from '../src/triage/expectations.js';

const turns: TurnRecord[] = [
  { message_id: 'BOUND-06', output: 'On Amazon your ROAS is 4.2x.', tool_calls: null, total_time_ms: 900, ttfb_ms: 100, tool_called: null },
  { message_id: 'LOOK-01',  output: 'Your Google ROAS was 1.8x.',  tool_calls: null, total_time_ms: 800, ttfb_ms: 90,  tool_called: null },
  { message_id: 'BRK-10',   output: 'ERROR: HTTP 500',             tool_calls: null, total_time_ms: 0,   ttfb_ms: -1,  tool_called: null },
];
const exp = parseExpectations(JSON.stringify({ 'BOUND-06': { scopePlatform: 'google', forbidPlatforms: ['amazon'] } }));

describe('buildRunReport', () => {
  it('turns red when any blocking finding is present', () => {
    const r = buildRunReport(turns, exp);
    expect(r.gate).toBe('red');
    expect(r.blockingCount).toBe(2);
    expect(r.byClass['scope-leak']).toBe(1);
    expect(r.byClass['rig-error']).toBe(1);
  });
  it('is green with no blocking findings', () => {
    const r = buildRunReport([turns[1]], parseExpectations('{}'));
    expect(r.gate).toBe('green');
    expect(r.blockingCount).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { classifyRig } from '../src/triage/rigIntegrity.js';

describe('classifyRig', () => {
  it('flags an ERROR: transport failure as rig-failed with the cause', () => {
    const v = classifyRig({ output: 'ERROR: HTTP 500: upstream', ttfb_ms: -1 });
    expect(v.status).toBe('failed');
    expect(v.reason).toMatch(/HTTP 500/);
  });
  it('flags a timeout as rig-failed', () => {
    expect(classifyRig({ output: 'ERROR: The operation was aborted' }).status).toBe('failed');
  });
  it('flags an empty capture (no text, no tools, no first byte) as rig-failed', () => {
    const v = classifyRig({ output: '', ttfb_ms: -1, tool_called: null, all_tools_called: [] });
    expect(v.status).toBe('failed');
    expect(v.reason).toMatch(/no response/i);
  });
  it('passes a real answer', () => {
    expect(classifyRig({ output: 'Your ROAS is 3.2x.', ttfb_ms: 120 }).status).toBe('ok');
  });
  it('passes a tool-only turn with no text (valid)', () => {
    const v = classifyRig({ output: '', ttfb_ms: 90, tool_called: 'queryData', all_tools_called: ['queryData'] });
    expect(v.status).toBe('ok');
  });
});

export type RigStatus = 'ok' | 'failed';

export interface RigInput {
  output: string;
  ttfb_ms?: number | null;
  total_time_ms?: number | null;
  tool_called?: string | null;
  all_tools_called?: string[];
}

export interface RigVerdict {
  status: RigStatus;
  reason?: string;
}

/**
 * Decide whether a captured turn is a valid PRODUCT result or a TEST-HARNESS failure.
 * Rig failures (transport errors, timeouts, empty captures) are quarantined so they
 * never masquerade as model regressions. Pure — no I/O.
 */
export function classifyRig(c: RigInput): RigVerdict {
  const out = (c.output || '').trim();
  if (out.startsWith('ERROR:')) {
    return { status: 'failed', reason: out.slice(0, 160) };
  }
  const hadTools = (c.tool_called != null) || ((c.all_tools_called?.length ?? 0) > 0);
  const noFirstByte = c.ttfb_ms != null && c.ttfb_ms < 0;
  if (out.length === 0 && !hadTools && noFirstByte) {
    return { status: 'failed', reason: 'no response captured (empty output, no tools, no first byte)' };
  }
  return { status: 'ok' };
}

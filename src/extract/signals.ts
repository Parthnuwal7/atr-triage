import type { Turn, Signals } from '../types.js';

const DATA_TERMS = /\b(roas|spend|sales|revenue|cpc|cpm|ctr|acos|impressions|clicks|orders|conversions|budget|units|gmv|aov|by campaign|by account|last week|last month|yesterday|top|how much|how many)\b/i;
const NAV_META_TERMS = /\b(how do i|how to|where (is|do)|navigate|create a|set up|hello|hi|thanks|what can you)\b/i;

export function isDataLookingQuery(q: string): boolean {
  if (!q) return false;
  if (NAV_META_TERMS.test(q)) return false;
  return DATA_TERMS.test(q);
}

const REFUSAL = /\b(i can'?t|i am unable|i'?m unable|cannot help|no data|not available|couldn'?t find|i don'?t have)\b/i;
export function isRefusal(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < 3) return true; // empty/trivial
  return REFUSAL.test(t);
}

export function computeSignals(turn: Turn, opts: { latencyOutlierMs: number }): Signals {
  const noResponse = turn.assistantMessageId === null;
  const toolError = Array.isArray(turn.toolTrace) && turn.toolTrace.some(c => c.kind === 'error');
  // no-tool-call: ONLY assertable when a trace exists (post-patch) and is empty, and the
  // query looked like a data query. Historical turns (trace === null) are never asserted.
  const noToolCall =
    Array.isArray(turn.toolTrace) && turn.toolTrace.length === 0 && isDataLookingQuery(turn.userQuery);
  const emptyOrRefusal = !noResponse && isRefusal(turn.answerText);
  const latencyOutlier = turn.footerLatencyMs !== null && turn.footerLatencyMs >= opts.latencyOutlierMs;
  return { noToolCall, toolError, emptyOrRefusal, noResponse, latencyOutlier };
}

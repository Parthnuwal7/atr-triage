import type { PartsAdapter } from './pairTurns.js';
import type { ToolTraceCall } from '../types.js';

function asArray(parts: unknown): any[] {
  return Array.isArray(parts) ? parts : [];
}

export function answerText(parts: unknown): string {
  return asArray(parts)
    .filter(p => p && p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text)
    .join('')
    .trim();
}

// The user turn is stored as a single text part (see atr-be upsertMessageQuery usage).
export function userText(parts: unknown): string {
  return answerText(parts);
}

// Footer shape (atr-be composable path): "…\n\n---\n*⚙️ normal · 3.2s · 1,000 tokens (…)*"
const FOOTER_SECONDS = /·\s*([\d.]+)s\s*·/;
export function footerLatencyMs(parts: unknown): number | null {
  const text = asArray(parts).map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
  const m = text.match(FOOTER_SECONDS);
  if (!m) return null;
  const secs = Number(m[1]);
  return Number.isFinite(secs) ? Math.round(secs * 1000) : null;
}

export function toolTrace(parts: unknown): ToolTraceCall[] | null {
  const part = asArray(parts).find(p => p && p.type === 'tool-trace');
  if (!part || !Array.isArray(part.calls)) return null;
  return part.calls.map((c: any) => ({
    toolName: String(c.toolName ?? ''),
    kind: String(c.kind ?? ''),
    errorCode: c.errorCode ?? null,
    rowCount: typeof c.rowCount === 'number' ? c.rowCount : null,
  }));
}

export const partsAdapter: PartsAdapter = { userText, answerText, footerLatencyMs, toolTrace };

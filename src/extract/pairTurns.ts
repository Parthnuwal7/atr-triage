import type { RawMessageRow, Turn, ToolTraceCall } from '../types.js';

export interface PartsAdapter {
  userText(parts: unknown): string;
  answerText(parts: unknown): string;
  footerLatencyMs(parts: unknown): number | null;
  toolTrace(parts: unknown): ToolTraceCall[] | null;
}

/**
 * Rows MUST arrive ordered by (chat_id ASC, created_at ASC) — the same order the
 * prod query uses. We walk the list; when a user turn is immediately followed by an
 * assistant turn in the SAME chat, they pair. A user turn with no assistant successor
 * yields a Turn with null assistant fields (a no-response candidate).
 */
export function pairTurns(rows: RawMessageRow[], adapter: PartsAdapter): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    if (cur.role !== 'user') continue;
    const next = rows[i + 1];
    const paired = next && next.chat_id === cur.chat_id && next.role === 'assistant' ? next : null;
    turns.push({
      chatId: cur.chat_id,
      userMessageId: cur.message_id,
      assistantMessageId: paired ? paired.message_id : null,
      createdAt: paired ? paired.created_at : cur.created_at,
      userQuery: adapter.userText(cur.parts),
      enrichedQuery: null,
      answerText: paired ? adapter.answerText(paired.parts) : '',
      footerLatencyMs: paired ? adapter.footerLatencyMs(paired.parts) : null,
      toolTrace: paired ? adapter.toolTrace(paired.parts) : null,
      downvoted: false,
    });
    if (paired) i++; // consume the assistant row
  }
  return turns;
}

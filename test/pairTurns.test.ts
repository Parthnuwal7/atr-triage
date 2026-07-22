import { describe, it, expect } from 'vitest';
import { pairTurns, type PartsAdapter } from '../src/extract/pairTurns.js';
import type { RawMessageRow } from '../src/types.js';

const adapter: PartsAdapter = {
  userText: (p: any) => p?.[0]?.text ?? '',
  answerText: (p: any) => p?.[0]?.text ?? '',
  footerLatencyMs: () => null,
  toolTrace: () => null,
};

const row = (id: string, chat: string, role: string, text: string, t: string): RawMessageRow => ({
  message_id: id, chat_id: chat, role, parts: [{ type: 'text', text }], created_at: t,
});

describe('pairTurns', () => {
  it('pairs each user turn with the following assistant turn in the same chat', () => {
    const rows = [
      row('u1', 'c1', 'user', 'roas last week?', '2026-07-01T10:00:00Z'),
      row('a1', 'c1', 'assistant', 'Your ROAS was 3.2', '2026-07-01T10:00:05Z'),
    ];
    const turns = pairTurns(rows, adapter);
    expect(turns).toHaveLength(1);
    expect(turns[0].userQuery).toBe('roas last week?');
    expect(turns[0].answerText).toBe('Your ROAS was 3.2');
    expect(turns[0].assistantMessageId).toBe('a1');
  });

  it('marks a user turn with no following assistant turn as no-response', () => {
    const turns = pairTurns([row('u1', 'c1', 'user', 'help', '2026-07-01T10:00:00Z')], adapter);
    expect(turns).toHaveLength(1);
    expect(turns[0].assistantMessageId).toBeNull();
    expect(turns[0].answerText).toBe('');
  });

  it('does not pair across different chats', () => {
    const rows = [
      row('u1', 'c1', 'user', 'q1', '2026-07-01T10:00:00Z'),
      row('a1', 'c2', 'assistant', 'a-other', '2026-07-01T10:00:05Z'),
    ];
    const turns = pairTurns(rows, adapter);
    expect(turns[0].assistantMessageId).toBeNull();
  });
});

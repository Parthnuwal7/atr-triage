import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'csv-stringify/sync';
import type { TriageConfig } from '../config.js';
import { getProdReadPool, getLocalPool } from '../db.js';
import type { Turn, Signals, MemoryContext, RawMessageRow } from '../types.js';
import { pairTurns } from './pairTurns.js';
import { partsAdapter } from './parts.js';
import { computeSignals } from './signals.js';
import { formatMemory, NOT_POINT_IN_TIME_NOTE } from './memory.js';
import {
  getTurnsInWindowQuery, getVotesForChatsQuery,
  getWorkspaceMemoryQuery, getConversationMemoryQuery,
} from '../sql/prodQueries.js';
import { insertRunQuery, insertTurnQuery } from '../sql/localQueries.js';

export const CSV_COLUMNS = [
  'run_id', 'chat_id', 'message_id', 'created_at', 'user_query', 'enriched_query', 'answer_text',
  'footer_latency_ms', 'workspace_memory', 'user_preferences', 'conversation_memory', 'downvoted',
  'signal_no_tool_call', 'signal_tool_error', 'signal_empty_or_refusal', 'signal_no_response',
  'signal_latency_outlier', 'tool_trace', 'verdict', 'category', 'severity', 'rationale',
];

const LATENCY_OUTLIER_MS = 15000;

export function buildCsvRows(
  turns: Turn[],
  signalsByMsg: Map<string, Signals>,
  memoryByChat: Map<string, MemoryContext>,
  runId = ''
): Record<string, string>[] {
  return turns.map(t => {
    const key = t.assistantMessageId ?? t.userMessageId ?? '';
    const s = signalsByMsg.get(key) ?? { noToolCall: false, toolError: false, emptyOrRefusal: false, noResponse: false, latencyOutlier: false };
    const mem = memoryByChat.get(t.chatId) ?? { workspaceMemory: '', userPreferences: '', conversationMemory: '' };
    return {
      run_id: runId,
      chat_id: t.chatId,
      message_id: key,
      created_at: t.createdAt ?? '',
      user_query: t.userQuery ?? '',
      enriched_query: t.enrichedQuery ?? '',
      answer_text: t.answerText ?? '',
      footer_latency_ms: t.footerLatencyMs === null ? '' : String(t.footerLatencyMs),
      workspace_memory: mem.workspaceMemory,
      user_preferences: mem.userPreferences,
      conversation_memory: mem.conversationMemory,
      downvoted: String(t.downvoted),
      signal_no_tool_call: String(s.noToolCall),
      signal_tool_error: String(s.toolError),
      signal_empty_or_refusal: String(s.emptyOrRefusal),
      signal_no_response: String(s.noResponse),
      signal_latency_outlier: String(s.latencyOutlier),
      tool_trace: t.toolTrace === null ? '' : JSON.stringify(t.toolTrace),
      verdict: '', category: '', severity: '', rationale: '',
    };
  });
}

function anySignal(s: Signals, downvoted: boolean): boolean {
  return downvoted || s.noToolCall || s.toolError || s.emptyOrRefusal || s.noResponse || s.latencyOutlier;
}

export interface ExtractArgs {
  workspace: string;
  from: string;   // YYYY-MM-DD
  to: string;     // YYYY-MM-DD
  all: boolean;   // false = filtered (default), true = every turn
  limit: number;  // safety cap
}

export async function runExtract(cfg: TriageConfig, args: ExtractArgs) {
  const runId = randomUUID();
  const prod = getProdReadPool(cfg);
  const local = getLocalPool(cfg);
  try {
    const { rows } = await prod.query<RawMessageRow>(getTurnsInWindowQuery, [
      args.workspace, args.from, args.to, args.limit,
    ]);
    const turns = pairTurns(rows, partsAdapter);

    // votes → downvoted flags
    const chatIds = [...new Set(turns.map(t => t.chatId))];
    const votes = chatIds.length
      ? (await prod.query(getVotesForChatsQuery, [chatIds])).rows
      : [];
    const downvotedMsgs = new Set(votes.filter(v => v.is_upvoted === false).map(v => v.message_id));
    for (const t of turns) {
      if (t.assistantMessageId && downvotedMsgs.has(t.assistantMessageId)) t.downvoted = true;
    }

    // memory per chat (workspace memory is workspace-wide; conversation memory per chat)
    const wsMem = formatMemory((await prod.query(getWorkspaceMemoryQuery, [args.workspace])).rows);
    const memoryByChat = new Map<string, MemoryContext>();
    for (const chatId of chatIds) {
      const conv = formatMemory((await prod.query(getConversationMemoryQuery, [chatId])).rows);
      memoryByChat.set(chatId, { workspaceMemory: wsMem, userPreferences: '', conversationMemory: conv });
    }

    // signals
    const signalsByMsg = new Map<string, Signals>();
    for (const t of turns) {
      const key = t.assistantMessageId ?? t.userMessageId ?? '';
      signalsByMsg.set(key, computeSignals(t, { latencyOutlierMs: LATENCY_OUTLIER_MS }));
    }

    // filter
    const selected = args.all
      ? turns
      : turns.filter(t => anySignal(signalsByMsg.get(t.assistantMessageId ?? t.userMessageId ?? '')!, t.downvoted));

    // persist run + turns locally
    await local.query('BEGIN');
    try {
      await local.query(insertRunQuery, [runId, args.workspace, args.from, args.to, args.all ? 'all' : 'filtered', selected.length]);
      for (const t of selected) {
        const key = t.assistantMessageId ?? t.userMessageId ?? '';
        if (!key) throw new Error('extracted turn has no stable message id');
        const s = signalsByMsg.get(key)!;
        const mem = memoryByChat.get(t.chatId)!;
        await local.query(insertTurnQuery, [
          runId, key, t.chatId, t.createdAt || null, t.userQuery, t.enrichedQuery, t.answerText,
          t.footerLatencyMs, mem.workspaceMemory, mem.userPreferences, mem.conversationMemory, t.downvoted,
          s.noToolCall, s.toolError, s.emptyOrRefusal, s.noResponse, s.latencyOutlier,
          t.toolTrace === null ? null : JSON.stringify(t.toolTrace),
        ]);
      }
      await local.query('COMMIT');
    } catch (error) {
      await local.query('ROLLBACK');
      throw error;
    }

    // write CSV
    const csvRows = buildCsvRows(selected, signalsByMsg, memoryByChat, runId);
    const outDir = join(process.cwd(), 'reports');
    mkdirSync(outDir, { recursive: true });
    const csvPath = join(outDir, `${args.workspace}_${args.from}_to_${args.to}_${runId.slice(0, 8)}.csv`);
    const header = `# ${NOT_POINT_IN_TIME_NOTE}\n`;
    writeFileSync(csvPath, header + stringify(csvRows, { header: true, columns: CSV_COLUMNS }));
    return { csvPath, runId, rowCount: selected.length };
  } finally {
    await prod.end();
    await local.end();
  }
}

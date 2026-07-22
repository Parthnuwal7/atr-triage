export interface RawMessageRow {
  message_id: string;
  chat_id: string;
  role: string; // 'user' | 'assistant' | …
  parts: unknown; // jsonb
  created_at: string;
}

export interface ToolTraceCall {
  toolName: string;
  kind: string; // 'ok' | 'empty' | 'error' | …
  errorCode: string | null;
  rowCount: number | null;
}

export interface Turn {
  chatId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  createdAt: string; // assistant turn's timestamp (or user's if no assistant)
  userQuery: string;
  enrichedQuery: string | null;
  answerText: string;
  footerLatencyMs: number | null;
  toolTrace: ToolTraceCall[] | null; // null = not recorded (historical)
  downvoted: boolean;
}

export interface Signals {
  noToolCall: boolean;
  toolError: boolean;
  emptyOrRefusal: boolean;
  noResponse: boolean;
  latencyOutlier: boolean;
}

export interface MemoryContext {
  workspaceMemory: string;
  userPreferences: string;
  conversationMemory: string;
}

export type VerdictLabel = 'good' | 'needs-work' | 'broken';
export interface Verdict {
  verdict: VerdictLabel;
  category: string;
  severity: 'low' | 'med' | 'high';
  rationale: string;
}

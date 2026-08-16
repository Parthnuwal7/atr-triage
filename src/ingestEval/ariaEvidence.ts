function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Preserve benchmark-specific evidence inside turns.artifacts without requiring a schema migration. */
export function buildEvalArtifacts(row: Record<string, unknown>): Record<string, unknown> | null {
  const base = objectValue(row.artifacts);
  const turns = Array.isArray(row.turns) ? row.turns : [];
  const turnSummaries = turns.map(value => {
    const turn = objectValue(value);
    return {
      turn: turn.turn ?? null,
      message_id: turn.message_id ?? null,
      terminal_status: turn.terminal_status ?? null,
      timings: turn.timings ?? null,
      errors: turn.errors ?? null,
    };
  });
  const context = {
    rubric: row.rubric ?? null,
    expect: row.expect ?? null,
    expect_all: row.expect_all ?? null,
    deterministic_validation: row.deterministic_validation ?? null,
    process_trace: row.process_trace ?? null,
    visual_contract: objectValue(row.artifacts).visual_contract ?? null,
    server_events: row.server_events ?? null,
    failure_signals: row.failure_signals ?? null,
    attempt_history: row.attempt_history ?? null,
    terminal_status: row.terminal_status ?? null,
    chat_id: row.chat_id ?? null,
    turns: turnSummaries,
  };
  const hasContext = Object.values(context).some(value => value != null && (!Array.isArray(value) || value.length > 0));
  if (!Object.keys(base).length && !hasContext) return null;
  return { ...base, benchmark_context: context };
}

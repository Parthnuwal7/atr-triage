export const insertRunQuery = `
  INSERT INTO runs (run_id, workspace, from_date, to_date, mode, source_row_count)
  VALUES ($1, $2, $3, $4, $5, $6)
`;

export const insertTurnQuery = `
  INSERT INTO turns (
    run_id, message_id, chat_id, created_at, user_query, enriched_query, answer_text,
    footer_latency_ms, workspace_memory, user_preferences, conversation_memory, downvoted,
    signal_no_tool_call, signal_tool_error, signal_empty_or_refusal, signal_no_response,
    signal_latency_outlier, tool_trace
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
  ON CONFLICT (run_id, message_id) DO NOTHING
`;

export const insertEvalTurnQuery = `
  INSERT INTO turns (
    run_id, message_id, chat_id, created_at, user_query, answer_text, tool_trace,
    category, expected_tool, tool_called, tokens_total, tokens_in, tokens_out,
    cost_usd, steps, total_time_ms, accuracy_score, overall_score
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
  ON CONFLICT (run_id, message_id) DO NOTHING
`;

export const insertVerdictQuery = `
  INSERT INTO verdicts (run_id, message_id, verdict, category, severity, rationale)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (run_id, message_id) DO UPDATE SET
    verdict = EXCLUDED.verdict, category = EXCLUDED.category,
    severity = EXCLUDED.severity, rationale = EXCLUDED.rationale, judged_at = now()
`;

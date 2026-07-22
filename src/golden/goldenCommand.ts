import { writeFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';

export function toBenchmarkFixture(
  golden: Array<{ query: string; category: string; expected_behavior?: string }>
): { prompts: Array<{ id: string; query: string; category: string; note?: string }> } {
  return {
    prompts: golden.map((g, i) => ({
      id: `GOLDEN-${String(i + 1).padStart(3, '0')}`,
      query: g.query,
      category: g.category || 'Uncategorized',
      note: g.expected_behavior || undefined,
    })),
  };
}

// Promote a triaged turn into the golden set (query + judged category as expected behavior).
export async function runGoldenAdd(cfg: TriageConfig, args: { runId: string; messageId: string }): Promise<void> {
  const local = getLocalPool(cfg);
  try {
    await local.query(
      `INSERT INTO golden_queries (source_run_id, source_message_id, query, expected_behavior, category)
       SELECT $1, $2, t.user_query, v.rationale, v.category
       FROM turns t LEFT JOIN verdicts v USING (run_id, message_id)
       WHERE t.run_id=$1 AND t.message_id=$2`,
      [args.runId, args.messageId]
    );
  } finally {
    await local.end();
  }
}

export async function runGoldenExport(cfg: TriageConfig, outPath: string): Promise<{ count: number }> {
  const local = getLocalPool(cfg);
  try {
    const { rows } = await local.query(
      `SELECT query, COALESCE(category,'') category, COALESCE(expected_behavior,'') expected_behavior
       FROM golden_queries ORDER BY added_at`);
    const fixture = toBenchmarkFixture(rows);
    writeFileSync(outPath, JSON.stringify(fixture, null, 2));
    return { count: rows.length };
  } finally {
    await local.end();
  }
}

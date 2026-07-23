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

/**
 * Promote triaged turns into the golden set. Either a single turn (`messageId`) or every
 * turn in the run with a given `verdict` (e.g. 'broken'). Idempotent: a turn already in the
 * golden set is skipped. Returns how many were newly added.
 */
export async function runGoldenAdd(
  cfg: TriageConfig,
  args: { runId: string; messageId?: string; verdict?: string }
): Promise<{ added: number }> {
  const local = getLocalPool(cfg);
  const notDup = `AND NOT EXISTS (
      SELECT 1 FROM golden_queries g
      WHERE g.source_run_id = t.run_id AND g.source_message_id = t.message_id)`;
  try {
    let rows: unknown[];
    if (args.messageId) {
      rows = (await local.query(
        `INSERT INTO golden_queries (source_run_id, source_message_id, query, expected_behavior, category)
         SELECT t.run_id, t.message_id, t.user_query, v.rationale, v.category
         FROM turns t LEFT JOIN verdicts v USING (run_id, message_id)
         WHERE t.run_id=$1 AND t.message_id=$2 ${notDup}
         RETURNING id`,
        [args.runId, args.messageId]
      )).rows;
    } else {
      const verdict = args.verdict ?? 'broken';
      rows = (await local.query(
        `INSERT INTO golden_queries (source_run_id, source_message_id, query, expected_behavior, category)
         SELECT t.run_id, t.message_id, t.user_query, v.rationale, v.category
         FROM turns t JOIN verdicts v USING (run_id, message_id)
         WHERE t.run_id=$1 AND v.verdict=$2 ${notDup}
         RETURNING id`,
        [args.runId, verdict]
      )).rows;
    }
    return { added: rows.length };
  } finally {
    await local.end();
  }
}

export async function runGoldenList(cfg: TriageConfig): Promise<Array<{ id: number; category: string; query: string }>> {
  const local = getLocalPool(cfg);
  try {
    const { rows } = await local.query<{ id: number; category: string; query: string }>(
      `SELECT id, COALESCE(category,'') category, query FROM golden_queries ORDER BY added_at`
    );
    return rows;
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

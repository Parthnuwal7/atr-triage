import { writeFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';

export function toBenchmarkFixture(
  golden: Array<{ id?: number; query: string; category: string; expected_behavior?: string }>
): {
  version: number;
  prompts: Array<{ id: string; query: string; category: string; note?: string }>;
  test_suites: Array<{ category: string; prompts: Array<{ input: string; scenario_tag: string; expected_summary?: string }> }>;
} {
  const prompts = golden.map((g, index) => ({
      id: g.id != null ? `GOLDEN-${String(g.id).padStart(6, '0')}` : `GOLDEN-${String(index + 1).padStart(3, '0')}`,
      query: g.query,
      category: g.category || 'Uncategorized',
      note: g.expected_behavior || undefined,
    }));
  const byCategory = new Map<string, typeof prompts>();
  for (const prompt of prompts) {
    const bucket = byCategory.get(prompt.category) ?? [];
    bucket.push(prompt);
    byCategory.set(prompt.category, bucket);
  }
  return {
    version: 1,
    prompts,
    test_suites: [...byCategory.entries()].map(([category, items]) => ({
      category,
      prompts: items.map(item => ({
        input: item.query,
        scenario_tag: item.id,
        expected_summary: item.note,
      })),
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
      `SELECT id, query, COALESCE(category,'') category, COALESCE(expected_behavior,'') expected_behavior
       FROM golden_queries ORDER BY added_at`);
    const fixture = toBenchmarkFixture(rows);
    writeFileSync(outPath, JSON.stringify(fixture, null, 2));
    return { count: rows.length };
  } finally {
    await local.end();
  }
}

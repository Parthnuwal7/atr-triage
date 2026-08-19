import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import {
  BENCHMARK_SCHEMA_VERSION,
  digest,
  validateJudgment,
  type StructuredJudgment,
} from '../benchmark/schema.js';

interface BundleTurn {
  run_id: string;
  message_id: string;
  category: string | null;
  expected_tool: string | null;
  tool_called: string | null;
  user_query: string;
  answer_text: string;
  tool_trace: unknown;
  artifacts: unknown;
  evidence_status: string;
}

interface BundleManifest {
  schemaVersion: number;
  batchId: string;
  promptVersion: string;
  bundleDigest: string;
  expectedRows: number;
  mapping: Record<string, { runId: string; messageId: string }>;
}

export function normalizeJudgeAnswer(answer: string): string {
  return answer
    .replace(/^\s*🧪\s*\*Reasoning harness\*\s*$/gim, '')
    .replace(/^\s*_[^_\n]*…_\s*$/gim, '')
    .replace(/\n\s*---\s*\n\s*\*🧪\s*harness\b[^\n]*\*\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function runJudgeBundle(
  cfg: TriageConfig,
  runIds: string[],
  outDir: string,
  promptVersion: string
): Promise<{ batchId: string; rows: number; csvPath: string; manifestPath: string }> {
  if (!runIds.length) throw new Error('at least one run is required');
  const local = getLocalPool(cfg);
  try {
    const turns: BundleTurn[] = [];
    for (const runId of runIds) {
      const result = await local.query<BundleTurn>(
        `SELECT run_id, message_id, category, expected_tool, tool_called, user_query, answer_text,
                tool_trace, artifacts, evidence_status
         FROM turns WHERE run_id=$1 ORDER BY message_id`,
        [runId]
      );
      if (!result.rows.length) throw new Error(`run ${runId} has no turns`);
      turns.push(...result.rows);
    }
    const batchId = randomUUID();
    const mapping: BundleManifest['mapping'] = {};
    const rows = turns.map(turn => {
      const blindId = `response-${digest(`${batchId}:${turn.run_id}:${turn.message_id}`).slice(0, 12)}`;
      mapping[blindId] = { runId: turn.run_id, messageId: turn.message_id };
      return {
        blind_id: blindId,
        category: turn.category ?? '',
        expected_tool: turn.expected_tool ?? '',
        tool_called: turn.tool_called ?? '',
        user_query: turn.user_query ?? '',
        answer_text: normalizeJudgeAnswer(turn.answer_text ?? ''),
        tool_trace: turn.tool_trace == null ? '' : JSON.stringify(turn.tool_trace),
        artifacts: turn.artifacts == null ? '' : JSON.stringify(turn.artifacts),
        evidence_status: turn.evidence_status,
      };
    });
    // Sort only by opaque id so approach and run order cannot leak through row order.
    rows.sort((a, b) => a.blind_id.localeCompare(b.blind_id));
    const csv = stringify(rows, { header: true });
    const bundleDigest = digest(csv);
    const manifest: BundleManifest = {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      batchId,
      promptVersion,
      bundleDigest,
      expectedRows: rows.length,
      mapping,
    };
    mkdirSync(outDir, { recursive: true });
    const csvPath = join(outDir, 'responses.csv');
    const manifestPath = join(outDir, 'manifest.json');
    writeFileSync(csvPath, csv);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const runId of runIds) {
      await local.query(
        `INSERT INTO judge_batches (batch_id, run_id, prompt_version, bundle_digest, blind_map, expected_rows)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [`${batchId}:${runId}`, runId, promptVersion, `${bundleDigest}:${runId}`, JSON.stringify(mapping), rows.length]
      );
    }
    return { batchId, rows: rows.length, csvPath, manifestPath };
  } finally {
    await local.end();
  }
}

export async function runImportBundleJudgments(
  cfg: TriageConfig,
  manifestPath: string,
  judgmentsPath: string,
  judgeId: string
): Promise<{ imported: number; reviews: number }> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest;
  const records = parse(readFileSync(judgmentsPath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  if (records.length !== manifest.expectedRows) {
    throw new Error(`expected ${manifest.expectedRows} judgments but received ${records.length}`);
  }
  const seen = new Set<string>();
  const parsed = records.map(row => {
    const blindId = row.blind_id?.trim();
    const target = manifest.mapping[blindId];
    if (!target) throw new Error(`unknown blind_id: ${blindId}`);
    if (seen.has(blindId)) throw new Error(`duplicate blind_id: ${blindId}`);
    seen.add(blindId);
    const dimensions = row.dimensions_json ? JSON.parse(row.dimensions_json) : {};
    const judgment: StructuredJudgment = {
      messageId: target.messageId,
      verdict: row.verdict as StructuredJudgment['verdict'],
      category: row.category ?? '',
      severity: row.severity as StructuredJudgment['severity'],
      rationale: row.rationale ?? '',
      dimensions,
      confidence: row.confidence === '' || row.confidence == null ? null : Number(row.confidence),
      evidenceSufficiency: (row.evidence_sufficiency || 'sufficient') as StructuredJudgment['evidenceSufficiency'],
    };
    validateJudgment(judgment);
    return { ...target, judgment };
  });
  if (seen.size !== Object.keys(manifest.mapping).length) throw new Error('judgment set is incomplete');

  const local = getLocalPool(cfg);
  let reviews = 0;
  try {
    await local.query('BEGIN');
    try {
      for (const item of parsed) {
        const j = item.judgment;
        await local.query(
          `INSERT INTO judgments (
             run_id, message_id, judge_id, schema_version, verdict, category, severity, rationale,
             dimensions, confidence, evidence_sufficiency, blinded
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
           ON CONFLICT (run_id,message_id,judge_id) DO UPDATE SET
             verdict=EXCLUDED.verdict, category=EXCLUDED.category, severity=EXCLUDED.severity,
             rationale=EXCLUDED.rationale, dimensions=EXCLUDED.dimensions,
             confidence=EXCLUDED.confidence, evidence_sufficiency=EXCLUDED.evidence_sufficiency,
             judged_at=now()`,
          [
            item.runId, item.messageId, judgeId, BENCHMARK_SCHEMA_VERSION, j.verdict, j.category,
            j.severity, j.rationale, JSON.stringify(j.dimensions), j.confidence, j.evidenceSufficiency,
          ]
        );
        const all = await local.query<{ verdict: string; confidence: number | null; evidence_sufficiency: string }>(
          'SELECT verdict, confidence, evidence_sufficiency FROM judgments WHERE run_id=$1 AND message_id=$2',
          [item.runId, item.messageId]
        );
        const labels = new Set(all.rows.map(row => row.verdict));
        const disagreement = labels.size > 1;
        const lowConfidence = all.rows.some(row => row.confidence != null && row.confidence < 0.7);
        const insufficient = all.rows.some(row => row.evidence_sufficiency !== 'sufficient' || row.verdict === 'insufficient-evidence');
        const consensus = insufficient ? 'insufficient-evidence' : disagreement ? 'needs-work' : j.verdict;
        await local.query(
          `INSERT INTO verdicts (run_id,message_id,verdict,category,severity,rationale,judge_count,disagreement,confidence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (run_id,message_id) DO UPDATE SET verdict=EXCLUDED.verdict,
             category=EXCLUDED.category, severity=EXCLUDED.severity, rationale=EXCLUDED.rationale,
             judge_count=EXCLUDED.judge_count, disagreement=EXCLUDED.disagreement,
             confidence=EXCLUDED.confidence, judged_at=now()`,
          [
            item.runId, item.messageId, consensus, j.category, j.severity, j.rationale,
            all.rows.length, disagreement,
            all.rows.every(row => row.confidence != null)
              ? all.rows.reduce((sum, row) => sum + Number(row.confidence), 0) / all.rows.length
              : null,
          ]
        );
        if (disagreement || lowConfidence || insufficient) {
          const reason = disagreement ? 'judge-disagreement' : insufficient ? 'insufficient-evidence' : 'low-confidence';
          await local.query(
            `INSERT INTO judgment_reviews (run_id,message_id,reason)
             VALUES ($1,$2,$3) ON CONFLICT (run_id,message_id,status) DO UPDATE SET reason=EXCLUDED.reason`,
            [item.runId, item.messageId, reason]
          );
          reviews++;
        }
      }
      await local.query('COMMIT');
    } catch (error) {
      await local.query('ROLLBACK');
      throw error;
    }
    return { imported: parsed.length, reviews };
  } finally {
    await local.end();
  }
}

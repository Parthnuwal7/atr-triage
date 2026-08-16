import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import {
  BENCHMARK_SCHEMA_VERSION,
  digest,
  validateJudgment,
  type StructuredJudgment,
} from '../benchmark/schema.js';
import { normalizeJudgeAnswer } from '../judgeCsv/judgeBundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT = resolve(HERE, '../../prompts/aria-codex-judge-v1.md');
const DEFAULT_SCHEMA = resolve(HERE, '../../prompts/aria-codex-judge-output.schema.json');

const CODEX_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
  'CODEX_HOME', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'OPENAI_ORGANIZATION', 'OPENAI_PROJECT', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'ALL_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
]);

/** Do not expose triage/application database credentials to the judge subprocess. */
export function codexJudgeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => CODEX_ENV_KEYS.has(key) && typeof value === 'string'
    )
  );
}

type JsonObject = Record<string, unknown>;

interface ReviewTurn {
  run_id: string;
  message_id: string;
  case_id: string | null;
  category: string | null;
  user_query: string;
  answer_text: string;
  tool_trace: unknown;
  trace: unknown;
  artifacts: unknown;
  evidence_status: string;
  total_time_ms: number | null;
  ttfb_ms: number | null;
  model_id: string | null;
  attempt_index: number;
}

export interface CodexReviewCase extends JsonObject {
  schema: 'aria-codex-review-case/v1';
  blind_id: string;
  evidence_digest: string;
  case_id: string;
}

interface ManifestTarget {
  run_id: string;
  message_id: string;
  evidence_digest: string;
  batch_file: string;
  output_file: string;
}

interface CodexManifest {
  schema: 'aria-codex-review-manifest/v1';
  schema_version: number;
  batch_id: string;
  run_id: string;
  prompt_version: string;
  prompt_digest: string;
  output_schema_digest: string;
  evidence_bundle_digest: string;
  expected_cases: number;
  batch_size: number;
  prompt_file: string;
  output_schema_file: string;
  mapping: Record<string, ManifestTarget>;
}

interface CodexJudgment extends JsonObject {
  blind_id: string;
  evidence_digest: string;
  verdict: StructuredJudgment['verdict'];
  category: string;
  severity: StructuredJudgment['severity'];
  failure_stage: string;
  failed_component: string;
  process_error: string;
  causal_evidence: string[];
  likely_root_cause: string;
  fix_layer: string;
  rationale: string;
  dimensions: StructuredJudgment['dimensions'];
  confidence: number;
  evidence_sufficiency: StructuredJudgment['evidenceSufficiency'];
  fixture_issue: boolean;
  deterministic_relation: string;
  reviewer_notes: string;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Bound evidence size while retaining the fields needed for causal and visual review. */
export function compactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (typeof value === 'string') return value.length > 2400 ? `${value.slice(0, 2400)}…` : value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, 40).map(item => compactValue(item, depth + 1));
    return value.length > kept.length ? [...kept, { omitted_items: value.length - kept.length }] : kept;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([key]) => !['events', 'statuses'].includes(key))
      .map(([key, item]) => [key, compactValue(item, depth + 1)])
  );
}

function summarizeTools(value: unknown): unknown[] {
  return arrayValue(value).map(item => {
    const tool = objectValue(item);
    return compactValue({
      call_id: tool.call_id ?? null,
      name: tool.name ?? null,
      args: tool.args ?? null,
      status: tool.status ?? null,
      kind: tool.kind ?? null,
      error_code: tool.error_code ?? null,
      row_count: tool.row_count ?? null,
      duration_ms: tool.duration_ms ?? null,
      result: tool.result ?? null,
    });
  });
}

function summarizeAttempts(value: unknown): unknown[] {
  return arrayValue(value).map(item => {
    const attempt = objectValue(item);
    return compactValue({
      attempt: attempt.attempt ?? null,
      terminal_status: attempt.terminal_status ?? null,
      path_signature: attempt.path_signature ?? null,
      turns: arrayValue(attempt.turns).map(raw => {
        const turn = objectValue(raw);
        const processTrace = objectValue(turn.process_trace);
        return {
          turn: turn.turn ?? null,
          terminal_status: turn.terminal_status ?? null,
          timings: turn.timings ?? null,
          errors: turn.errors ?? null,
          path_signature: processTrace.path_signature ?? null,
          route: processTrace.route ?? null,
          tools: summarizeTools(processTrace.tools),
        };
      }),
    });
  });
}

export function buildCompactReviewCase(turn: ReviewTurn, blindId: string): CodexReviewCase {
  const artifacts = objectValue(turn.artifacts);
  const context = objectValue(artifacts.benchmark_context);
  const visualArtifacts = objectValue(artifacts.visual_artifacts);
  const processTrace = objectValue(context.process_trace ?? turn.trace);
  const payload = {
    schema: 'aria-codex-review-case/v1' as const,
    blind_id: blindId,
    case_id: turn.case_id ?? turn.message_id,
    category: turn.category ?? '',
    query: turn.user_query,
    answer: normalizeJudgeAnswer(turn.answer_text ?? ''),
    rubric: context.rubric ?? null,
    expectations: context.expect_all ?? (context.expect ? [context.expect] : []),
    deterministic_validation: context.deterministic_validation ?? null,
    failure_signal_hypotheses: context.failure_signals ?? [],
    execution: {
      terminal_status: context.terminal_status ?? null,
      evidence_status: turn.evidence_status,
      model_id: turn.model_id,
      attempt_index: turn.attempt_index,
      total_time_ms: turn.total_time_ms,
      ttfb_ms: turn.ttfb_ms,
      path_signature: processTrace.path_signature ?? null,
      observability: processTrace.observability ?? null,
      final_tools: summarizeTools(turn.tool_trace),
      attempts: summarizeAttempts(context.attempt_history),
    },
    visuals: compactValue({
      contract: artifacts.visual_contract ?? context.visual_contract ?? null,
      validation: artifacts.visual_validation ?? null,
      cards_and_companions: visualArtifacts.artifacts ?? [],
      card_count: visualArtifacts.count ?? null,
      companion_artifact_count: visualArtifacts.companion_artifact_count ?? null,
      total_event_count: visualArtifacts.total_event_count ?? null,
    }),
    backend_events: compactValue(arrayValue(context.server_events).map(raw => {
      const event = objectValue(raw);
      return {
        event_id: event.event_id ?? null,
        event_type: event.event_type ?? null,
        attempt: event.attempt ?? null,
        turn: event.turn ?? null,
        request_id: event.request_id ?? null,
        detail: event.detail ?? null,
      };
    })),
  };
  return { ...payload, evidence_digest: digest(payload) };
}

function readManifest(manifestPath: string): CodexManifest {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexManifest;
  if (manifest.schema !== 'aria-codex-review-manifest/v1') throw new Error('unsupported Codex review manifest');
  return manifest;
}

function readJudgmentOutput(path: string): CodexJudgment[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { schema?: string; judgments?: CodexJudgment[] };
  if (parsed.schema !== 'aria-codex-judgments/v1' || !Array.isArray(parsed.judgments)) {
    throw new Error(`invalid Codex judgment output: ${path}`);
  }
  return parsed.judgments;
}

export async function buildCodexReviewBundle(
  cfg: TriageConfig,
  runId: string,
  outDir: string,
  batchSize = 8,
  promptVersion = 'aria-codex-judge-v1'
): Promise<{ manifestPath: string; cases: number; batches: number }> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error('batch size must be an integer from 1 to 25');
  }
  const local = getLocalPool(cfg);
  try {
    const result = await local.query<ReviewTurn>(
      `SELECT run_id, message_id, case_id, category, user_query, answer_text, tool_trace,
              trace, artifacts, evidence_status, total_time_ms, ttfb_ms, model_id, attempt_index
       FROM turns WHERE run_id=$1 ORDER BY message_id`,
      [runId]
    );
    if (!result.rows.length) throw new Error(`run ${runId} has no turns`);

    const batchId = randomUUID();
    const cases = result.rows.map(turn => {
      const blindId = `aria-${digest(`${batchId}:${turn.message_id}`).slice(0, 16)}`;
      return { turn, review: buildCompactReviewCase(turn, blindId) };
    });
    mkdirSync(join(outDir, 'batches'), { recursive: true });
    mkdirSync(join(outDir, 'judgments'), { recursive: true });
    copyFileSync(DEFAULT_PROMPT, join(outDir, 'prompt.md'));
    copyFileSync(DEFAULT_SCHEMA, join(outDir, 'output.schema.json'));

    const mapping: CodexManifest['mapping'] = {};
    for (let offset = 0; offset < cases.length; offset += batchSize) {
      const batchNumber = Math.floor(offset / batchSize) + 1;
      const batchName = `batch-${String(batchNumber).padStart(3, '0')}.json`;
      const outputName = `batch-${String(batchNumber).padStart(3, '0')}.judgments.json`;
      const batchCases = cases.slice(offset, offset + batchSize);
      writeFileSync(join(outDir, 'batches', batchName), `${JSON.stringify({ cases: batchCases.map(item => item.review) }, null, 2)}\n`);
      for (const item of batchCases) {
        mapping[item.review.blind_id] = {
          run_id: item.turn.run_id,
          message_id: item.turn.message_id,
          evidence_digest: item.review.evidence_digest,
          batch_file: join('batches', batchName),
          output_file: join('judgments', outputName),
        };
      }
    }
    const evidenceJsonl = cases.map(item => JSON.stringify(item.review)).join('\n') + '\n';
    writeFileSync(join(outDir, 'review-cases.jsonl'), evidenceJsonl);
    const prompt = readFileSync(DEFAULT_PROMPT, 'utf8');
    const outputSchema = readFileSync(DEFAULT_SCHEMA, 'utf8');
    const manifest: CodexManifest = {
      schema: 'aria-codex-review-manifest/v1',
      schema_version: BENCHMARK_SCHEMA_VERSION,
      batch_id: batchId,
      run_id: runId,
      prompt_version: promptVersion,
      prompt_digest: digest(prompt),
      output_schema_digest: digest(outputSchema),
      evidence_bundle_digest: digest(evidenceJsonl),
      expected_cases: cases.length,
      batch_size: batchSize,
      prompt_file: 'prompt.md',
      output_schema_file: 'output.schema.json',
      mapping,
    };
    const manifestPath = join(outDir, 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await local.query(
      `INSERT INTO judge_batches (batch_id, run_id, prompt_version, bundle_digest, blind_map, expected_rows)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [batchId, runId, promptVersion, manifest.evidence_bundle_digest, JSON.stringify(mapping), cases.length]
    );
    return { manifestPath, cases: cases.length, batches: Math.ceil(cases.length / batchSize) };
  } finally {
    await local.end();
  }
}

function validateBatchOutput(judgments: CodexJudgment[], expected: ManifestTarget[], mapping: CodexManifest['mapping']): void {
  if (judgments.length !== expected.length) throw new Error(`expected ${expected.length} judgments, received ${judgments.length}`);
  const expectedIds = new Set(Object.entries(mapping).filter(([, target]) => expected.includes(target)).map(([id]) => id));
  const seen = new Set<string>();
  for (const judgment of judgments) {
    if (!expectedIds.has(judgment.blind_id)) throw new Error(`unexpected blind_id ${judgment.blind_id}`);
    if (seen.has(judgment.blind_id)) throw new Error(`duplicate blind_id ${judgment.blind_id}`);
    seen.add(judgment.blind_id);
    if (mapping[judgment.blind_id].evidence_digest !== judgment.evidence_digest) {
      throw new Error(`evidence digest mismatch for ${judgment.blind_id}`);
    }
    validateJudgment({
      messageId: mapping[judgment.blind_id].message_id,
      verdict: judgment.verdict,
      category: judgment.category,
      severity: judgment.severity,
      rationale: judgment.rationale,
      dimensions: judgment.dimensions,
      confidence: judgment.confidence,
      evidenceSufficiency: judgment.evidence_sufficiency,
    });
  }
}

export function runCodexJudge(
  manifestPath: string,
  options: { codexBin?: string; model?: string; dryRun?: boolean } = {}
): { completed: number; skipped: number; batches: number } {
  const manifest = readManifest(manifestPath);
  const root = dirname(resolve(manifestPath));
  const promptPath = join(root, manifest.prompt_file);
  const schemaPath = join(root, manifest.output_schema_file);
  if (digest(readFileSync(promptPath, 'utf8')) !== manifest.prompt_digest) throw new Error('judge prompt digest mismatch');
  if (digest(readFileSync(schemaPath, 'utf8')) !== manifest.output_schema_digest) throw new Error('output schema digest mismatch');
  const byBatch = new Map<string, ManifestTarget[]>();
  for (const target of Object.values(manifest.mapping)) {
    if (!byBatch.has(target.batch_file)) byBatch.set(target.batch_file, []);
    byBatch.get(target.batch_file)!.push(target);
  }
  let completed = 0;
  let skipped = 0;
  for (const [batchFile, targets] of [...byBatch.entries()].sort()) {
    const outputFile = targets[0].output_file;
    const outputPath = join(root, outputFile);
    if (existsSync(outputPath)) {
      try {
        validateBatchOutput(readJudgmentOutput(outputPath), targets, manifest.mapping);
        skipped++;
        continue;
      } catch {
        // An interrupted/invalid derived output is regenerated below.
      }
    }
    if (options.dryRun) continue;
    const args = [
      'exec', '--ephemeral', '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules',
      '--json', '--output-schema', schemaPath, '-o', outputPath,
    ];
    if (options.model) args.push('--model', options.model);
    args.push('-');
    const input = `${readFileSync(promptPath, 'utf8')}\n\nINPUT CASES:\n${readFileSync(join(root, batchFile), 'utf8')}`;
    const result = spawnSync(options.codexBin || 'codex', args, {
      cwd: root,
      env: codexJudgeEnvironment(),
      input,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Codex failed for ${batchFile}: ${(result.stderr || result.stdout).slice(-4000)}`);
    validateBatchOutput(readJudgmentOutput(outputPath), targets, manifest.mapping);
    completed++;
  }
  return { completed, skipped, batches: byBatch.size };
}

export async function importCodexJudgments(
  cfg: TriageConfig,
  manifestPath: string,
  judgeId: string,
  modelId = 'codex'
): Promise<{ imported: number; reviews: number }> {
  const manifest = readManifest(manifestPath);
  const root = dirname(resolve(manifestPath));
  const outputs = [...new Set(Object.values(manifest.mapping).map(target => target.output_file))].sort();
  const judgments = outputs.flatMap(file => {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`missing judgment output ${path}`);
    return readJudgmentOutput(path);
  });
  validateBatchOutput(judgments, Object.values(manifest.mapping), manifest.mapping);
  const local = getLocalPool(cfg);
  let reviews = 0;
  try {
    await local.query('BEGIN');
    try {
      for (const judgment of judgments) {
        const target = manifest.mapping[judgment.blind_id];
        await local.query(
          `INSERT INTO judgments (
             run_id, message_id, judge_id, batch_id, schema_version, verdict, category, severity,
             rationale, dimensions, confidence, evidence_sufficiency, blinded, failure_stage,
             failed_component, process_error, causal_evidence, likely_root_cause, fix_layer,
             fixture_issue, deterministic_relation, evidence_digest, prompt_version, model_id,
             judge_metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           ON CONFLICT (run_id,message_id,judge_id) DO UPDATE SET
             verdict=EXCLUDED.verdict, category=EXCLUDED.category, severity=EXCLUDED.severity,
             rationale=EXCLUDED.rationale, dimensions=EXCLUDED.dimensions,
             confidence=EXCLUDED.confidence, evidence_sufficiency=EXCLUDED.evidence_sufficiency,
             failure_stage=EXCLUDED.failure_stage, failed_component=EXCLUDED.failed_component,
             process_error=EXCLUDED.process_error, causal_evidence=EXCLUDED.causal_evidence,
             likely_root_cause=EXCLUDED.likely_root_cause, fix_layer=EXCLUDED.fix_layer,
             fixture_issue=EXCLUDED.fixture_issue, deterministic_relation=EXCLUDED.deterministic_relation,
             evidence_digest=EXCLUDED.evidence_digest, prompt_version=EXCLUDED.prompt_version,
             model_id=EXCLUDED.model_id, judge_metadata=EXCLUDED.judge_metadata, judged_at=now()`,
          [
            target.run_id, target.message_id, judgeId, manifest.batch_id, BENCHMARK_SCHEMA_VERSION,
            judgment.verdict, judgment.category, judgment.severity, judgment.rationale,
            JSON.stringify(judgment.dimensions), judgment.confidence, judgment.evidence_sufficiency,
            judgment.failure_stage, judgment.failed_component, judgment.process_error,
            JSON.stringify(judgment.causal_evidence), judgment.likely_root_cause, judgment.fix_layer,
            judgment.fixture_issue, judgment.deterministic_relation, judgment.evidence_digest,
            manifest.prompt_version, modelId, JSON.stringify({ reviewer_notes: judgment.reviewer_notes }),
          ]
        );
        const allJudges = await local.query<{
          verdict: string;
          confidence: number | null;
          evidence_sufficiency: string;
        }>(
          `SELECT verdict, confidence, evidence_sufficiency FROM judgments
           WHERE run_id=$1 AND message_id=$2`,
          [target.run_id, target.message_id]
        );
        const labels = new Set(allJudges.rows.map(row => row.verdict));
        const disagreement = labels.size > 1;
        const insufficient = allJudges.rows.some(row => row.evidence_sufficiency !== 'sufficient');
        const consensusVerdict = disagreement || insufficient ? 'needs-work' : judgment.verdict;
        const consensusConfidence = allJudges.rows.every(row => row.confidence != null)
          ? allJudges.rows.reduce((sum, row) => sum + Number(row.confidence), 0) / allJudges.rows.length
          : null;
        await local.query(
          `INSERT INTO verdicts (
             run_id,message_id,verdict,category,severity,rationale,judge_count,disagreement,
             confidence,failure_stage,failed_component,process_error,likely_root_cause,fix_layer,
             evidence_sufficiency,fixture_issue,evidence_digest
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (run_id,message_id) DO UPDATE SET
             verdict=EXCLUDED.verdict, category=EXCLUDED.category, severity=EXCLUDED.severity,
             rationale=EXCLUDED.rationale, judge_count=EXCLUDED.judge_count,
             disagreement=EXCLUDED.disagreement, confidence=EXCLUDED.confidence,
             failure_stage=EXCLUDED.failure_stage, failed_component=EXCLUDED.failed_component,
             process_error=EXCLUDED.process_error, likely_root_cause=EXCLUDED.likely_root_cause,
             fix_layer=EXCLUDED.fix_layer, evidence_sufficiency=EXCLUDED.evidence_sufficiency,
             fixture_issue=EXCLUDED.fixture_issue, evidence_digest=EXCLUDED.evidence_digest,
             judged_at=now()`,
          [
            target.run_id, target.message_id, consensusVerdict, judgment.category,
            judgment.severity, judgment.rationale, allJudges.rows.length, disagreement,
            consensusConfidence, judgment.failure_stage, judgment.failed_component,
            judgment.process_error, judgment.likely_root_cause, judgment.fix_layer,
            judgment.evidence_sufficiency, judgment.fixture_issue, judgment.evidence_digest,
          ]
        );
        const needsReview = judgment.confidence < 0.7
          || judgment.evidence_sufficiency !== 'sufficient'
          || judgment.fixture_issue
          || judgment.deterministic_relation === 'overrides'
          || disagreement
          || (judgment.failure_stage === 'unknown' && judgment.verdict !== 'good');
        if (needsReview) {
          const reason = disagreement
            ? 'judge-disagreement'
            : judgment.fixture_issue
              ? 'fixture-issue'
              : judgment.deterministic_relation === 'overrides'
              ? 'deterministic-conflict'
              : judgment.evidence_sufficiency !== 'sufficient'
                ? 'insufficient-evidence'
                : judgment.failure_stage === 'unknown'
                  ? 'unknown-root-cause'
                  : 'low-confidence';
          await local.query(
            `INSERT INTO judgment_reviews (run_id,message_id,reason)
             VALUES ($1,$2,$3)
             ON CONFLICT (run_id,message_id,status) DO UPDATE SET reason=EXCLUDED.reason`,
            [target.run_id, target.message_id, reason]
          );
          reviews++;
        }
      }
      await local.query('UPDATE judge_batches SET imported_at=now() WHERE batch_id=$1', [manifest.batch_id]);
      await local.query('COMMIT');
    } catch (error) {
      await local.query('ROLLBACK');
      throw error;
    }
    return { imported: judgments.length, reviews };
  } finally {
    await local.end();
  }
}

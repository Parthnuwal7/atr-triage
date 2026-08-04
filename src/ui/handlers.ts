/**
 * atr-triage UI — request handlers. Each API route maps to an existing command function
 * (runIngestEval, runAssert, …) and returns a JSON-serializable result. No child processes:
 * we call the command functions directly, so there is no arg-string building or shell risk.
 */
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { listRunsQuery } from '../sql/localQueries.js';
import { runIngestEval } from '../ingestEval/ingestCommand.js';
import { runAssert } from '../triage/assertCommand.js';
import { runJudgeCsv } from '../judgeCsv/judgeCsvCommand.js';
import { runImport } from '../importJudged/importCommand.js';
import { runImportInsights } from '../importJudged/importInsights.js';
import { runDashboard } from '../dashboard/dashboardCommand.js';
import { runGoldenAdd, runGoldenList } from '../golden/goldenCommand.js';

export type RouteName =
  | 'page'
  | 'runs'
  | 'ingest'
  | 'assert'
  | 'judge'
  | 'import'
  | 'dashboard'
  | 'insights'
  | 'goldenList'
  | 'goldenAdd'
  | 'dashboardFile';

/** Pure route resolver: (method, pathname) → a handler name, or null for 404. */
export function matchRoute(method: string, pathname: string): RouteName | null {
  const m = method.toUpperCase();
  if (m === 'GET' && pathname === '/') return 'page';
  if (m === 'GET' && pathname === '/api/runs') return 'runs';
  if (m === 'POST' && pathname === '/api/ingest') return 'ingest';
  if (m === 'POST' && pathname === '/api/assert') return 'assert';
  if (m === 'POST' && pathname === '/api/judge-csv') return 'judge';
  if (m === 'POST' && pathname === '/api/import') return 'import';
  if (m === 'POST' && pathname === '/api/insights') return 'insights';
  if (m === 'POST' && pathname === '/api/dashboard') return 'dashboard';
  if (m === 'GET' && pathname === '/api/golden') return 'goldenList';
  if (m === 'POST' && pathname === '/api/golden') return 'goldenAdd';
  if (m === 'GET' && pathname.startsWith('/dashboards/')) return 'dashboardFile';
  return null;
}

export interface RunSummary {
  runId: string;
  workspace: string;
  fromDate: string;
  toDate: string;
  mode: string;
  turns: number;
  findings: number;
  blocking: number;
  gate: 'red' | 'green' | 'none';
}

const n = (v: unknown): number => Number(v ?? 0) || 0;

/** Map a listRunsQuery row → RunSummary. gate: red if any blocking, green if asserted-clean-ish
 *  (findings computed but none blocking), none if no findings recorded yet. Pure. */
export function toRunSummary(row: Record<string, unknown>): RunSummary {
  const blocking = n(row.blocking_count);
  const findings = n(row.finding_count);
  return {
    runId: String(row.run_id),
    workspace: String(row.workspace ?? ''),
    fromDate: String(row.from_date ?? ''),
    toDate: String(row.to_date ?? ''),
    mode: String(row.mode ?? ''),
    turns: n(row.turn_count),
    findings,
    blocking,
    gate: blocking > 0 ? 'red' : findings > 0 ? 'green' : 'none',
  };
}

export async function handleRuns(cfg: TriageConfig): Promise<{ runs: RunSummary[] }> {
  const db = getLocalPool(cfg);
  try {
    const res = await db.query<Record<string, unknown>>(listRunsQuery);
    return { runs: res.rows.map(toRunSummary) };
  } finally {
    await db.end();
  }
}

export async function handleIngest(cfg: TriageConfig, body: { jsonlPath?: string }) {
  if (!body.jsonlPath) throw new Error('jsonlPath is required');
  return runIngestEval(cfg, body.jsonlPath);
}

export async function handleAssert(cfg: TriageConfig, body: { runId?: string; expectationsPath?: string }) {
  if (!body.runId) throw new Error('runId is required');
  return runAssert(cfg, body.runId, body.expectationsPath || undefined);
}

export async function handleJudge(cfg: TriageConfig, body: { runId?: string; outPath?: string }) {
  if (!body.runId) throw new Error('runId is required');
  const out = body.outPath || `reports/${body.runId}.judge.csv`;
  return { ...(await runJudgeCsv(cfg, body.runId, out)), outPath: out };
}

export async function handleImport(cfg: TriageConfig, body: { csvPath?: string; runId?: string }) {
  if (!body.csvPath) throw new Error('csvPath is required');
  return runImport(cfg, body.csvPath, body.runId || undefined);
}

export async function handleInsights(cfg: TriageConfig, body: { runId?: string; filePath?: string }) {
  if (!body.runId) throw new Error('runId is required');
  if (!body.filePath) throw new Error('filePath is required');
  return runImportInsights(cfg, body.runId, body.filePath);
}

export async function handleDashboard(cfg: TriageConfig, body: { runId?: string; name?: string; compare?: string }) {
  if (!body.runId) throw new Error('runId is required');
  return runDashboard(cfg, body.runId, body.name || undefined, body.compare || undefined);
}

export async function handleGoldenList(cfg: TriageConfig) {
  return { rows: await runGoldenList(cfg) };
}

export async function handleGoldenAdd(cfg: TriageConfig, body: { runId?: string; messageId?: string; verdict?: string }) {
  if (!body.runId) throw new Error('runId is required');
  return runGoldenAdd(cfg, { runId: body.runId, messageId: body.messageId || undefined, verdict: body.verdict || undefined });
}

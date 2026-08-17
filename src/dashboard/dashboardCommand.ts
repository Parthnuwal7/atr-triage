import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { loadAnalysis, loadComparison } from './analysis.js';
import { renderDashboardHtml, renderComparisonHtml } from './renderHtml.js';
import { digest } from '../benchmark/schema.js';

export function safeDashboardName(value: string): string {
  const name = value.trim().replace(/\.html$/i, '');
  if (!name || name.length > 100 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes('..')) {
    throw new Error('dashboard name must be a safe 1–100 character filename');
  }
  return name;
}

export async function runDashboard(
  cfg: TriageConfig,
  runId: string,
  name?: string,
  compareRunId?: string
): Promise<{ htmlPath: string; jsonPath: string }> {
  const local = getLocalPool(cfg);
  let operationError: unknown = null;
  try {
    const dir = join(process.cwd(), 'dashboards');
    mkdirSync(dir, { recursive: true });

    // A/B comparison — additive; single-run output is unchanged when --compare is absent.
    if (compareRunId) {
      const model = await loadComparison(local, runId, compareRunId);
      const html = renderComparisonHtml(model);
      const fileName = `${safeDashboardName(name ?? `ab_${runId.slice(0, 8)}_vs_${compareRunId.slice(0, 8)}`)}.html`;
      const htmlPath = join(dir, fileName);
      const jsonPath = htmlPath.replace(/\.html$/, '.json');
      writeFileSync(htmlPath, html);
      writeFileSync(jsonPath, `${JSON.stringify(model, null, 2)}\n`);
      await local.query(
        `INSERT INTO dashboards (
           run_id, name, html_path, compare_run_id, report_type, input_digest, generation_status
         ) VALUES ($1,$2,$3,$4,'comparison',$5,'complete')`,
        [runId, fileName, htmlPath, compareRunId, digest(model)]
      );
      return { htmlPath, jsonPath };
    }

    const model = await loadAnalysis(local, runId);
    const html = renderDashboardHtml(model);
    const fileName = `${safeDashboardName(name ?? `${model.workspace}_${model.fromDate}_to_${model.toDate}`)}.html`;
    const htmlPath = join(dir, fileName);
    const jsonPath = htmlPath.replace(/\.html$/, '.json');
    writeFileSync(htmlPath, html);
    writeFileSync(jsonPath, `${JSON.stringify(model, null, 2)}\n`);
    await local.query(
      `INSERT INTO dashboards (run_id, name, html_path, report_type, input_digest, generation_status)
       VALUES ($1,$2,$3,'single',$4,'complete')`,
      [runId, fileName, htmlPath, digest(model)]
    );
    return { htmlPath, jsonPath };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await local.end();
    } catch (closeError) {
      if (operationError == null) throw closeError;
    }
  }
}

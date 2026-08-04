import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { loadAnalysis, loadComparison } from './analysis.js';
import { renderDashboardHtml, renderComparisonHtml } from './renderHtml.js';

export async function runDashboard(
  cfg: TriageConfig,
  runId: string,
  name?: string,
  compareRunId?: string
): Promise<{ htmlPath: string }> {
  const local = getLocalPool(cfg);
  try {
    const dir = join(process.cwd(), 'dashboards');
    mkdirSync(dir, { recursive: true });

    // A/B comparison — additive; single-run output is unchanged when --compare is absent.
    if (compareRunId) {
      const model = await loadComparison(local, runId, compareRunId);
      const html = renderComparisonHtml(model);
      const fileName = `${name ?? `ab_${runId.slice(0, 8)}_vs_${compareRunId.slice(0, 8)}`}.html`;
      const htmlPath = join(dir, fileName);
      writeFileSync(htmlPath, html);
      await local.query('INSERT INTO dashboards (run_id, name, html_path) VALUES ($1,$2,$3)', [runId, fileName, htmlPath]);
      return { htmlPath };
    }

    const model = await loadAnalysis(local, runId);
    const html = renderDashboardHtml(model);
    const fileName = `${name ?? `${model.workspace}_${model.fromDate}_to_${model.toDate}`}.html`;
    const htmlPath = join(dir, fileName);
    writeFileSync(htmlPath, html);
    await local.query('INSERT INTO dashboards (run_id, name, html_path) VALUES ($1,$2,$3)', [runId, fileName, htmlPath]);
    return { htmlPath };
  } finally {
    await local.end();
  }
}

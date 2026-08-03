import { loadConfig } from './config.js';
import { getLocalPool } from './db.js';
import { runMigrations } from './migrate.js';
import { runExtract } from './extract/extractCommand.js';
import { runImport } from './importJudged/importCommand.js';
import { runDashboard } from './dashboard/dashboardCommand.js';
import { runGoldenAdd, runGoldenExport, runGoldenList } from './golden/goldenCommand.js';
import { runIngestEval } from './ingestEval/ingestCommand.js';
import { runJudgeCsv } from './judgeCsv/judgeCsvCommand.js';
import { runAssert } from './triage/assertCommand.js';

function flag(name: string, def = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function has(name: string): boolean { return process.argv.includes(`--${name}`); }

async function main() {
  const verb = process.argv[2];
  const cfg = loadConfig();
  switch (verb) {
    case 'migrate': {
      const pool = getLocalPool(cfg);
      await runMigrations(pool); await pool.end();
      console.log('✓ migrations applied'); break;
    }
    case 'extract': {
      const res = await runExtract(cfg, {
        workspace: flag('workspace'), from: flag('from'), to: flag('to'),
        all: has('all'), limit: Number(flag('limit', '5000')),
      });
      console.log(`✓ run ${res.runId} · ${res.rowCount} rows → ${res.csvPath}`); break;
    }
    case 'import': {
      // --run lets a compact judgments CSV (message_id + verdict cols, no run_id) attribute to a run.
      const res = await runImport(cfg, flag('csv'), flag('run') || undefined);
      console.log(`✓ imported ${res.imported} verdicts`); break;
    }
    case 'ingest-eval': {
      const res = await runIngestEval(cfg, flag('jsonl'));
      console.log(`✓ ingested ${res.ingested} eval cases · run ${res.runId}`); break;
    }
    case 'judge-csv': {
      const res = await runJudgeCsv(cfg, flag('run'), flag('out'));
      console.log(`✓ wrote ${res.rows} rows → ${flag('out')} (judge with prompts/judge-prompt.md → import --run ${flag('run')})`); break;
    }
    case 'assert': {
      // Deterministic gate: rig-integrity + assertion checks over a run's turns.
      // --expectations <file> supplies per-case scope/entity/permission expectations.
      const res = await runAssert(cfg, flag('run'), flag('expectations') || undefined);
      const badge = res.gate === 'red' ? '🔴 RED' : '🟢 GREEN';
      const classes = Object.entries(res.byClass).map(([c, n]) => `${c}:${n}`).join(' ');
      console.log(`${badge} · ${res.findings} findings (${res.blocking} blocking) · run ${flag('run')}`);
      if (classes) console.log(`  by class: ${classes}`);
      if (res.gate === 'red') process.exitCode = 1; // gate fails the process for CI
      break;
    }
    case 'dashboard': {
      // --compare <runB> renders an A/B comparison (baseline --run vs candidate --compare);
      // without it, the single-run dashboard is unchanged.
      const res = await runDashboard(cfg, flag('run'), flag('name') || undefined, flag('compare') || undefined);
      console.log(`✓ dashboard → ${res.htmlPath}`); break;
    }
    case 'golden': {
      const sub = process.argv[3];
      if (sub === 'add') {
        // golden add --run X --message Y   (single turn)
        // golden add --run X --verdict broken   (all turns with that verdict; default broken)
        const r = await runGoldenAdd(cfg, {
          runId: flag('run'),
          messageId: flag('message') || undefined,
          verdict: flag('verdict') || undefined,
        });
        console.log(`✓ added ${r.added} to golden set`);
      } else if (sub === 'list') {
        const rows = await runGoldenList(cfg);
        console.log(`golden set: ${rows.length} queries`);
        for (const r of rows) console.log(`  #${r.id} [${r.category || '—'}] ${r.query.slice(0, 90)}`);
      } else if (sub === 'export') {
        const r = await runGoldenExport(cfg, flag('out'));
        console.log(`✓ exported ${r.count} → ${flag('out')}`);
      } else console.error('usage: golden add|list|export');
      break;
    }
    default:
      console.error('usage: atr-triage migrate|extract|ingest-eval|judge-csv|import|assert|dashboard|golden');
      process.exit(1);
  }
}
main().catch(e => { console.error(e); process.exit(1); });

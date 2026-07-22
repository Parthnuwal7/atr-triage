import { loadConfig } from './config.js';
import { getLocalPool } from './db.js';
import { runMigrations } from './migrate.js';
import { runExtract } from './extract/extractCommand.js';
import { runImport } from './importJudged/importCommand.js';
import { runDashboard } from './dashboard/dashboardCommand.js';
import { runGoldenAdd, runGoldenExport } from './golden/goldenCommand.js';

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
      const res = await runImport(cfg, flag('csv'));
      console.log(`✓ imported ${res.imported} verdicts`); break;
    }
    case 'dashboard': {
      const res = await runDashboard(cfg, flag('run'), flag('name') || undefined);
      console.log(`✓ dashboard → ${res.htmlPath}`); break;
    }
    case 'golden': {
      const sub = process.argv[3];
      if (sub === 'add') { await runGoldenAdd(cfg, { runId: flag('run'), messageId: flag('message') }); console.log('✓ added'); }
      else if (sub === 'export') { const r = await runGoldenExport(cfg, flag('out')); console.log(`✓ exported ${r.count} → ${flag('out')}`); }
      else console.error('usage: golden add|export'); break;
    }
    default:
      console.error('usage: atr-triage migrate|extract|import|dashboard|golden');
      process.exit(1);
  }
}
main().catch(e => { console.error(e); process.exit(1); });

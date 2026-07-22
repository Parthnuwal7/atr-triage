import type { AnalysisModel } from './analysis.js';
import { renderDonut, renderBars } from './svg.js';

function esc(s: string): string {
  return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
}

export function renderDashboardHtml(m: AnalysisModel): string {
  const rows = m.brokenTurns.map(t =>
    `<tr><td>${esc(t.user_query)}</td><td>${esc(t.answer_text).slice(0, 300)}</td>` +
    `<td>${esc(t.category)}</td><td>${esc(t.rationale)}</td></tr>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ARIA Triage — ${esc(m.workspace)} ${esc(m.fromDate)}…${esc(m.toDate)}</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#222}
 h1{font-size:20px} h2{font-size:15px;margin-top:28px}
 .cards{display:flex;gap:32px;flex-wrap:wrap;align-items:center}
 table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}
 td,th{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
 .note{color:#666;font-size:12px}
</style></head><body>
 <h1>ARIA Triage — ${esc(m.workspace)}</h1>
 <div class="note">Window ${esc(m.fromDate)} → ${esc(m.toDate)} · ${m.total} turns · ${m.downvotes} downvoted · run ${esc(m.runId)}</div>
 <div class="note">Memory shown in source rows is CURRENT, not point-in-time.</div>
 <div class="cards">
   <div><h2>Verdict split</h2>${renderDonut(m.verdictSplit)}</div>
   <div><h2>Failure categories</h2>${renderBars(m.byCategory)}</div>
 </div>
 <div class="cards">
   <div><h2>Signals</h2>${renderBars(m.bySignal, '#6a1b9a')}</div>
   <div><h2>Tools involved</h2>${renderBars(m.byTool, '#00695c')}</div>
 </div>
 <h2>Broken turns</h2>
 <table><thead><tr><th>Query</th><th>Answer</th><th>Category</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

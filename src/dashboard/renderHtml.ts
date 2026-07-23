import type { AnalysisModel, TurnDetail } from './analysis.js';
import { renderDonut, renderBars } from './svg.js';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
}

function vClass(verdict: string): string {
  return 'v-' + (verdict || 'unjudged').replace(/[^a-z-]/gi, '');
}

function signalList(t: TurnDetail): string {
  const on: string[] = [];
  if (t.downvoted) on.push('downvote');
  if (t.signal_no_tool_call) on.push('no_tool_call');
  if (t.signal_tool_error) on.push('tool_error');
  if (t.signal_empty_or_refusal) on.push('empty_or_refusal');
  if (t.signal_no_response) on.push('no_response');
  if (t.signal_latency_outlier) on.push('latency_outlier');
  return on.length ? on.join(', ') : 'none';
}

function detailBlock(t: TurnDetail): string {
  const trace = t.tool_trace == null ? '' : (typeof t.tool_trace === 'string' ? t.tool_trace : JSON.stringify(t.tool_trace, null, 2));
  const parts = [
    `<div class="d"><b>Answer</b><pre>${esc(t.answer_text)}</pre></div>`,
    t.rationale ? `<div class="d"><b>Judge</b> — ${esc(t.category)} / ${esc(t.severity)}<div class="rat">${esc(t.rationale)}</div></div>` : '',
    t.workspace_memory ? `<div class="d"><b>Workspace memory</b> <span class="mn">(current, not point-in-time)</span><pre>${esc(t.workspace_memory)}</pre></div>` : '',
    t.conversation_memory ? `<div class="d"><b>Conversation memory</b><pre>${esc(t.conversation_memory)}</pre></div>` : '',
    trace ? `<div class="d"><b>Tool trace</b><pre>${esc(trace)}</pre></div>` : `<div class="d note">no tool trace recorded (historical turn)</div>`,
    `<div class="d note">signals: ${esc(signalList(t))}</div>`,
  ];
  return parts.filter(Boolean).join('');
}

function turnRows(turns: TurnDetail[]): string {
  return turns.map(t => {
    const c = vClass(t.verdict);
    const q = esc(t.user_query).slice(0, 200) || '(empty)';
    return (
      `<tr class="turn ${c}" data-v="${esc(t.verdict)}"><td><span class="badge ${c}">${esc(t.verdict)}</span></td>` +
      `<td>${esc(t.category)}</td><td>${esc(t.severity)}</td><td class="q">${q}</td></tr>` +
      `<tr class="detail" hidden><td colspan="4">${detailBlock(t)}</td></tr>`
    );
  }).join('');
}

function chips(m: AnalysisModel): string {
  const counts: Record<string, number> = {};
  for (const t of m.turns) counts[t.verdict] = (counts[t.verdict] || 0) + 1;
  const order = ['all', 'broken', 'needs-work', 'good', '(unjudged)'];
  return order
    .filter(v => v === 'all' || counts[v])
    .map(v => {
      const n = v === 'all' ? m.turns.length : counts[v];
      const on = v === 'all' ? ' on' : '';
      return `<button class="chip${on}" data-filter="${esc(v)}">${esc(v)} <span class="n">${n}</span></button>`;
    })
    .join('');
}

export function renderDashboardHtml(m: AnalysisModel): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ARIA Triage — ${esc(m.workspace)} ${esc(m.fromDate)}…${esc(m.toDate)}</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#222;max-width:1100px}
 h1{font-size:20px} h2{font-size:15px;margin-top:28px}
 .cards{display:flex;gap:32px;flex-wrap:wrap;align-items:center}
 .note{color:#666;font-size:12px}
 .mn{color:#999;font-weight:normal;font-size:11px}
 .chips{margin:14px 0 6px}
 .chip{border:1px solid #ccc;background:#f6f6f6;border-radius:14px;padding:4px 12px;margin-right:6px;cursor:pointer;font-size:13px}
 .chip.on{background:#222;color:#fff;border-color:#222}
 .chip .n{opacity:.7}
 table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}
 td,th{border:1px solid #e0e0e0;padding:6px 8px;text-align:left;vertical-align:top}
 tr.turn{cursor:pointer} tr.turn:hover{background:#fafafa}
 tr.turn .q{max-width:640px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 tr.turn.open .q{white-space:normal}
 .badge{padding:1px 8px;border-radius:10px;color:#fff;font-size:11px}
 .v-broken{background:#c62828} .v-needs-work{background:#f9a825} .v-good{background:#2e7d32} .v-unjudged{background:#607d8b}
 .badge.v-needs-work{color:#222}
 td .d{margin:6px 0} td .d b{font-size:12px} td pre{white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:4px;margin:4px 0;max-height:340px;overflow:auto}
 td .rat{margin-top:2px}
</style></head><body>
 <h1>ARIA Triage — ${esc(m.workspace)}</h1>
 <div class="note">Window ${esc(m.fromDate)} → ${esc(m.toDate)} · ${m.total} turns · ${m.downvotes} downvoted · run ${esc(m.runId)}</div>
 <div class="note">Memory shown is CURRENT, not point-in-time. Click any row to expand.</div>
 <div class="cards">
   <div><h2>Verdict split</h2>${renderDonut(m.verdictSplit)}</div>
   <div><h2>Failure categories</h2>${renderBars(m.byCategory)}</div>
 </div>
 <div class="cards">
   <div><h2>Signals</h2>${renderBars(m.bySignal, '#6a1b9a')}</div>
   <div><h2>Tools involved</h2>${renderBars(m.byTool, '#00695c')}</div>
 </div>
 <h2>Turns</h2>
 <div class="chips">${chips(m)}</div>
 <table><thead><tr><th>Verdict</th><th>Category</th><th>Severity</th><th>Query (click row for full detail)</th></tr></thead>
 <tbody>${turnRows(m.turns)}</tbody></table>
<script>
(function(){
  var rows = document.querySelectorAll('tbody tr.turn');
  rows.forEach(function(r){
    r.addEventListener('click', function(){
      var d = r.nextElementSibling;
      if (d && d.classList.contains('detail')) { d.hidden = !d.hidden; r.classList.toggle('open', !d.hidden); }
    });
  });
  document.querySelectorAll('.chip').forEach(function(b){
    b.addEventListener('click', function(){
      var f = b.getAttribute('data-filter');
      document.querySelectorAll('.chip').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      rows.forEach(function(r){
        var show = (f === 'all') || (r.getAttribute('data-v') === f);
        r.hidden = !show;
        var d = r.nextElementSibling;
        if (d && d.classList.contains('detail') && !show) { d.hidden = true; r.classList.remove('open'); }
      });
    });
  });
})();
</script>
</body></html>`;
}

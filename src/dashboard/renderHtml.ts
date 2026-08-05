import type { AnalysisModel, TurnDetail, EvalMetrics, ComparisonModel, GateSummary } from './analysis.js';
import { renderDonut, renderBars, renderRadar, renderDivergingBars, renderGroupedBars } from './svg.js';
import { renderMarkdown } from './markdown.js';

/** Deterministic safety gate + findings-by-class — the FIRST thing shown: is this run safe? */
function gateSection(g: GateSummary | undefined): string {
  if (!g || g.status === 'none') {
    return `<div class="gate gate-none">⚪ Not asserted — run <code>assert</code> to get the deterministic safety gate.</div>`;
  }
  const badge = g.status === 'red'
    ? `<span class="gate-badge red">🔴 GATE RED</span> ${g.blocking} blocking · ${g.total} findings`
    : `<span class="gate-badge green">🟢 GATE GREEN</span> ${g.total} finding${g.total === 1 ? '' : 's'} (0 blocking)`;
  const rows = g.byClass.length
    ? `<table class="gate-tbl"><thead><tr><th>class</th><th>layer</th><th>sev</th><th>count</th></tr></thead><tbody>${
        g.byClass.map(c => `<tr class="${c.blocking ? 'blk' : ''}"><td>${esc(c.label)}${c.blocking ? ' 🔒' : ''}</td><td>${esc(c.layer)}</td><td>${esc(c.severity)}</td><td>${c.value}</td></tr>`).join('')
      }</tbody></table>`
    : `<div class="note">No deterministic findings — clean on every checked invariant.</div>`;
  return `<div class="gate gate-${g.status}">${badge}</div>${rows}`;
}

/** The judge's insights.md report, rendered as a collapsible panel when present. */
function insightsSection(md: string | undefined): string {
  if (!md || !md.trim()) return '';
  return `<details class="insights" open><summary><h2 style="display:inline">🔎 Judge insights</h2></summary>
    <div class="insights-body">${renderMarkdown(md)}</div></details>`;
}

function evalSection(m: EvalMetrics): string {
  const pct = m.toolTotal ? Math.round((100 * m.toolCorrect) / m.toolTotal) : null;
  const stat = (label: string, val: string) => `<div class="stat"><div class="sv">${val}</div><div class="sl">${label}</div></div>`;
  const cards = [
    stat('Tool-call correct', pct == null ? '—' : `${pct}% <span class="mn">(${m.toolCorrect}/${m.toolTotal})</span>`),
    stat('Avg auto-accuracy', m.avgAccuracy == null ? '—' : `${m.avgAccuracy}/100`),
    stat('Avg tokens', m.avgTokens == null ? '—' : String(m.avgTokens)),
    stat('Total cost', m.totalCost == null ? '—' : `$${m.totalCost.toFixed(4)}`),
    stat('Avg steps', m.avgSteps == null ? '—' : String(m.avgSteps)),
    stat('Avg latency', m.avgLatencyMs == null ? '—' : `${(m.avgLatencyMs / 1000).toFixed(1)}s`),
  ].join('');
  const rows = m.byCategory.map(c => {
    const bad = c.total ? Math.round((100 * (c.broken + c.needsWork)) / c.total) : 0;
    return `<tr><td>${esc(c.category)}</td><td>${c.total}</td><td class="v-broken-t">${c.broken}</td>` +
      `<td class="v-needs-t">${c.needsWork}</td><td class="v-good-t">${c.good}</td>` +
      `<td>${c.avgAccuracy == null ? '—' : c.avgAccuracy}</td><td>${bad}%</td></tr>`;
  }).join('');
  return `<h2>Benchmark metrics</h2>
    <div class="stats">${cards}</div>
    <h2>Where it performs well vs. poorly (by category)</h2>
    <table><thead><tr><th>Category</th><th>Total</th><th>Broken</th><th>Needs-work</th><th>Good</th><th>Avg acc</th><th>% not-good</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

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

// Bars, or an explanatory note when there's nothing to chart (so the section isn't blank).
function barsOrNote(items: Array<{ label: string; value: number }>, note: string, color?: string): string {
  return items.length ? renderBars(items, color) : `<div class="note">${note}</div>`;
}

function detailBlock(t: TurnDetail): string {
  const trace = t.tool_trace == null ? '' : (typeof t.tool_trace === 'string' ? t.tool_trace : JSON.stringify(t.tool_trace, null, 2));
  const evalLine = t.expected_tool != null || t.tokens_total != null
    ? `<div class="d note">expected tool: <b>${esc(t.expected_tool ?? '—')}</b> · called: <b>${esc(t.tool_called ?? '—')}</b>` +
      ` · steps ${t.steps ?? '—'} · tokens ${t.tokens_total ?? '—'} · cost ${t.cost_usd == null ? '—' : '$' + t.cost_usd}` +
      ` · ${t.total_time_ms == null ? '—' : (t.total_time_ms / 1000).toFixed(1) + 's'} · auto-acc ${t.accuracy_score ?? '—'}</div>`
    : '';
  const parts = [
    `<div class="d note">message_id: <code>${esc(t.message_id)}</code> — curate with: <code>pnpm triage golden add --run &lt;runId&gt; --message ${esc(t.message_id)}</code></div>`,
    evalLine,
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

// ─── A/B comparison page ─────────────────────────────────────────────────────

function fmtKpi(v: number, fmt: 'pct' | 'ms' | 'usd' | 'int'): string {
  if (fmt === 'pct') return `${v}%`;
  if (fmt === 'ms') return `${(v / 1000).toFixed(1)}s`;
  if (fmt === 'usd') return `$${v.toFixed(4)}`;
  return String(v);
}

function kpiTiles(m: ComparisonModel): string {
  return m.kpis
    .map(k => {
      const cls = k.delta === 0 ? 'flat' : k.betterIsB ? 'up' : 'down';
      const sign = k.delta > 0 ? '+' : '';
      const deltaStr = k.fmt === 'ms' ? `${sign}${(k.delta / 1000).toFixed(1)}s`
        : k.fmt === 'usd' ? `${sign}$${k.delta.toFixed(4)}`
        : k.fmt === 'pct' ? `${sign}${k.delta}pp`
        : `${sign}${k.delta}`;
      return `<div class="tile ${cls}"><div class="tl">${esc(k.label)}</div>` +
        `<div class="tv">${fmtKpi(k.a, k.fmt)} <span class="ar">→</span> ${fmtKpi(k.b, k.fmt)}</div>` +
        `<div class="td">${deltaStr}</div></div>`;
    })
    .join('');
}

/** Safety-gate comparison: both arms' gate badges + a findings-by-class A/B/Δ table.
 *  This is the headline for a harness A/B — did the candidate add or remove blocking findings? */
function gateCompareSection(m: ComparisonModel): string {
  const g = m.gate;
  const deltas = m.findingDeltas ?? [];
  if (!g || (g.a.status === 'none' && g.b.status === 'none')) {
    return `<h2>Safety gate</h2>
 <div class="note">Not asserted — run <code>assert</code> on both arms to compare the deterministic safety gate.</div>`;
  }
  const badge = (label: string, gs: typeof g.a) => {
    if (gs.status === 'none') return `<div class="gcell"><div class="gl">${label}</div><span class="gate-badge none">⚪ not asserted</span></div>`;
    const b = gs.status === 'red'
      ? `<span class="gate-badge red">🔴 RED</span> ${gs.blocking} blocking · ${gs.total} findings`
      : `<span class="gate-badge green">🟢 GREEN</span> ${gs.total} finding${gs.total === 1 ? '' : 's'}`;
    return `<div class="gcell"><div class="gl">${label}</div>${b}</div>`;
  };
  const blkDelta = (g.b.blocking ?? 0) - (g.a.blocking ?? 0);
  const verdict = blkDelta > 0
    ? `<span class="reg">B added ${blkDelta} blocking safety finding${blkDelta === 1 ? '' : 's'}</span>`
    : blkDelta < 0
      ? `<span class="imp">B removed ${-blkDelta} blocking safety finding${blkDelta === -1 ? '' : 's'}</span>`
      : `<span class="flat">no change in blocking findings</span>`;
  const rows = deltas.length
    ? `<table class="fd-tbl"><thead><tr><th>finding class</th><th>A</th><th>B</th><th>Δ (B−A)</th></tr></thead><tbody>${
        deltas.map(d => {
          const cls = d.delta > 0 ? 'reg' : d.delta < 0 ? 'imp' : 'flat';
          const sign = d.delta > 0 ? '+' : '';
          return `<tr class="${d.blocking ? 'blk' : ''}"><td>${esc(d.class)}${d.blocking ? ' 🔒' : ''}</td><td>${d.a}</td><td>${d.b}</td><td class="${cls}">${sign}${d.delta}</td></tr>`;
        }).join('')
      }</tbody></table>`
    : `<div class="note">No deterministic findings in either arm.</div>`;
  return `<h2>Safety gate (deterministic)</h2>
 <div class="gcells">${badge(`A · ${esc(m.a.workspace)}`, g.a)}${badge(`B · ${esc(m.b.workspace)}`, g.b)}<div class="gcell"><div class="gl">Blocking delta</div>${verdict}</div></div>
 ${rows}
 <div class="cap">🔒 = blocking class (scope-leak / permission / cross-tenant). Δ &gt; 0 means the candidate produced more findings of that class — a regression.</div>`;
}

export function renderComparisonHtml(m: ComparisonModel): string {
  const aLabel = `A · ${esc(m.a.workspace)}`;
  const bLabel = `B · ${esc(m.b.workspace)}`;
  const catBars = m.categoryDeltas.map(c => ({ label: c.category, value: c.delta }));
  const caption = [
    m.relativeAxes.length
      ? `Speed, Cost efficiency and Step efficiency are scaled <b>relative to the pair</b> (better arm = 100); they measure the gap between arms, not an absolute quality.`
      : '',
    m.notMeasured.length
      ? `Not measured (zero denominator, shown as 0): <b>${m.notMeasured.map(esc).join(', ')}</b>.`
      : '',
  ].filter(Boolean).join(' ');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ARIA A/B — ${esc(m.a.workspace)} vs ${esc(m.b.workspace)}</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#222;max-width:1100px}
 h1{font-size:20px} h2{font-size:15px;margin-top:28px}
 .note{color:#666;font-size:12px;margin:4px 0}
 .cards{display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start}
 .tiles{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
 .tile{border:1px solid #e0e0e0;border-radius:8px;padding:10px 16px;min-width:150px;border-left-width:4px}
 .tile.up{border-left-color:#2e7d32} .tile.down{border-left-color:#c62828} .tile.flat{border-left-color:#9e9e9e}
 .tile .tl{font-size:11px;color:#666} .tile .tv{font-size:16px;font-weight:600;margin-top:3px}
 .tile .tv .ar{color:#999;font-weight:400} .tile .td{font-size:12px;margin-top:2px;font-weight:600}
 .tile.up .td{color:#2e7d32} .tile.down .td{color:#c62828} .tile.flat .td{color:#9e9e9e}
 .chart{border:1px solid #eee;border-radius:8px;padding:12px}
 .cap{color:#777;font-size:11px;max-width:640px;margin:6px 0 0}
 code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:11px}
 .gate-badge{padding:2px 8px;border-radius:12px;margin-right:6px;font-size:12px}
 .gate-badge.red{background:#c62828;color:#fff} .gate-badge.green{background:#2e7d32;color:#fff} .gate-badge.none{background:#e0e0e0;color:#555}
 .gcells{display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin:8px 0}
 .gcell .gl{font-size:11px;color:#666;margin-bottom:3px} .gcell{font-size:13px}
 .fd-tbl{border-collapse:collapse;font-size:13px;margin:8px 0}
 .fd-tbl th,.fd-tbl td{border-bottom:1px solid #eee;padding:4px 16px 4px 0;text-align:left}
 .fd-tbl td:nth-child(2),.fd-tbl td:nth-child(3),.fd-tbl td:nth-child(4){text-align:right}
 .fd-tbl tr.blk td:first-child{color:#c62828;font-weight:600}
 .reg{color:#c62828;font-weight:600} .imp{color:#2e7d32;font-weight:600} .flat{color:#9e9e9e;font-weight:600}
</style></head><body>
 <h1>ARIA A/B comparison</h1>
 <div class="note">Baseline <b>A</b> = ${esc(m.a.workspace)} <code>${esc(m.a.runId)}</code> · Candidate <b>B</b> = ${esc(m.b.workspace)} <code>${esc(m.b.runId)}</code></div>
 <div class="note">Deltas read as <b>B − A</b>; tiles are coloured by direction (green = improvement, red = regression), not raw sign.</div>

 ${gateCompareSection(m)}

 <h2>Headline deltas</h2>
 <div class="tiles">${kpiTiles(m)}</div>

 <div class="cards">
   <div class="chart"><h2 style="margin-top:0">Quality dimensions</h2>${renderRadar(m.qualityRadar, { aLabel, bLabel })}</div>
   <div class="chart"><h2 style="margin-top:0">Where it moved (category families)</h2>${renderRadar(m.familyRadar, { aLabel, bLabel })}</div>
 </div>
 ${caption ? `<div class="cap">${caption}</div>` : ''}

 <h2>Per-category shift (B − A pass rate, worst regression first)</h2>
 <div class="chart">${renderDivergingBars(catBars)}</div>

 <h2>Verdict split (A vs B)</h2>
 <div class="chart">${renderGroupedBars(m.verdictGroups, { aLabel: 'A', bLabel: 'B' })}</div>
</body></html>`;
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
 .gate{border-radius:8px;padding:10px 16px;margin:14px 0 6px;font-size:14px;font-weight:600}
 .gate-red{background:#fdecef;border:1px solid #f4b6c0} .gate-green{background:#eaf6ec;border:1px solid #b6dcbd}
 .gate-none{background:#f3f4f6;border:1px solid #dfe3e8;color:#555;font-weight:400}
 .gate-badge{padding:2px 8px;border-radius:12px;margin-right:8px}
 .gate-badge.red{background:#c62828;color:#fff} .gate-badge.green{background:#2e7d32;color:#fff}
 .gate-tbl{border-collapse:collapse;font-size:13px;margin:2px 0 8px}
 .gate-tbl th,.gate-tbl td{border-bottom:1px solid #eee;padding:4px 14px 4px 0;text-align:left}
 .gate-tbl tr.blk td{color:#c62828;font-weight:600}
 .insights{border:1px solid #d9e2ec;background:#f7fafc;border-radius:8px;padding:8px 16px;margin:16px 0}
 .insights summary{cursor:pointer;list-style:none}
 .insights-body{font-size:13px;line-height:1.55}
 .insights-body h1,.insights-body h2,.insights-body h3{margin:14px 0 4px}
 .insights-body h1{font-size:15px} .insights-body h2{font-size:14px} .insights-body h3{font-size:13px}
 .insights-body code{background:#eef2f6;padding:1px 4px;border-radius:3px}
 .insights-body ul{margin:4px 0 4px 4px}
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
 .stats{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0}
 .stat{border:1px solid #e0e0e0;border-radius:8px;padding:10px 16px;min-width:120px}
 .stat .sv{font-size:18px;font-weight:600} .stat .sl{font-size:11px;color:#666;margin-top:2px}
 .v-broken-t{color:#c62828;font-weight:600} .v-needs-t{color:#b26a00} .v-good-t{color:#2e7d32}
 code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:11px}
</style></head><body>
 <h1>ARIA Triage — ${esc(m.workspace)}</h1>
 ${gateSection(m.gate)}
 ${insightsSection(m.insightsMd)}
 <div class="note">Window ${esc(m.fromDate)} → ${esc(m.toDate)} · ${m.total} turns · ${m.downvotes} downvoted · run ${esc(m.runId)}</div>
 <div class="note">Memory shown is CURRENT, not point-in-time. Click any row to expand.</div>
 <div class="cards">
   <div><h2>Verdict split</h2>${renderDonut(m.verdictSplit)}</div>
   <div><h2>Failure categories</h2>${renderBars(m.byCategory)}</div>
 </div>
 <div class="cards">
   <div><h2>Signals</h2>${barsOrNote(m.bySignal, 'No deterministic signals fired (no downvotes, refusals, errors, or latency outliers).', '#6a1b9a')}</div>
   <div><h2>Tools involved</h2>${barsOrNote(m.byTool, 'No tool traces — these are historical turns; tool traces are recorded for new turns only (patch C).', '#00695c')}</div>
 </div>
 ${m.evalMetrics ? evalSection(m.evalMetrics) : ''}
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

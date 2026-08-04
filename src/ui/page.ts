/** The single self-contained atr-triage UI page (inline CSS/JS — no external assets). */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>atr-triage</title>
<style>
  :root { --bg:#0f1216; --panel:#171b21; --line:#262c35; --fg:#e6e9ee; --mut:#8b95a3; --acc:#4f9cf7; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:14px 20px; border-bottom:1px solid var(--line); font-weight:600; }
  header small { color:var(--mut); font-weight:400; margin-left:8px; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px 20px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .panel h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--mut); }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); font-size:13px; }
  tr.run { cursor:pointer; }
  tr.run.sel { background:#1e2530; }
  .badge { padding:1px 7px; border-radius:10px; font-size:11px; font-weight:600; }
  .red { background:#3a1720; color:#ff8095; } .green { background:#12301c; color:#71d88a; } .none { background:#20262f; color:var(--mut); }
  label { display:block; color:var(--mut); font-size:12px; margin:8px 0 3px; }
  input { width:100%; padding:7px 9px; background:#0e1216; border:1px solid var(--line); border-radius:6px; color:var(--fg); }
  button { margin-top:10px; padding:7px 12px; background:var(--acc); color:#04121f; border:0; border-radius:6px; font-weight:600; cursor:pointer; }
  button.sec { background:#232a33; color:var(--fg); }
  .out { white-space:pre-wrap; background:#0b0e12; border:1px solid var(--line); border-radius:6px; padding:10px; margin-top:10px; font-family:ui-monospace,Menlo,monospace; font-size:12px; min-height:38px; color:var(--fg); }
  .sel-run { color:var(--acc); }
  a { color:var(--acc); }
</style>
</head>
<body>
<header>atr-triage <small>select a run, then run an action — no CLI needed</small></header>
<main>
  <section class="panel" style="grid-column:1 / -1">
    <h2>Runs <span id="selinfo" class="sel-run"></span> <button class="sec" style="margin:0 0 0 8px;padding:3px 8px" onclick="loadRuns()">↻ refresh</button></h2>
    <table><thead><tr><th>gate</th><th>run</th><th>workspace</th><th>date</th><th>mode</th><th>turns</th><th>findings</th></tr></thead>
      <tbody id="runs"><tr><td colspan="7" style="color:var(--mut)">loading…</td></tr></tbody></table>
  </section>

  <section class="panel">
    <h2>Ingest a run (JSONL)</h2>
    <label>run-eval JSONL path</label>
    <input id="ingestPath" placeholder="../atr-be/scripts/evals/reports/slice15.jsonl" />
    <button onclick="post('/api/ingest',{jsonlPath:val('ingestPath')},'ingestOut',loadRuns)">Ingest</button>
    <div id="ingestOut" class="out"></div>
  </section>

  <section class="panel">
    <h2>Assert (deterministic gate)</h2>
    <label>expectations JSON path</label>
    <input id="expPath" placeholder="reports/expectations.json" value="reports/expectations.json" />
    <button onclick="needRun()&&post('/api/assert',{runId:RUN,expectationsPath:val('expPath')},'assertOut',loadRuns)">Assert selected run</button>
    <div id="assertOut" class="out"></div>
  </section>

  <section class="panel">
    <h2>Judge CSV</h2>
    <button onclick="needRun()&&post('/api/judge-csv',{runId:RUN},'judgeOut')">Generate judge CSV</button>
    <label>judged CSV path (after you judge it — sibling .insights.md auto-attaches)</label>
    <input id="impPath" placeholder="reports/<run>.judged.csv" />
    <button class="sec" onclick="needRun()&&post('/api/import',{runId:RUN,csvPath:val('impPath')},'judgeOut',loadRuns)">Import judged (+insights)</button>
    <label>insights.md path (only if importing it separately)</label>
    <input id="insPath" placeholder="reports/<run>.insights.md" />
    <button class="sec" onclick="needRun()&&post('/api/insights',{runId:RUN,filePath:val('insPath')},'judgeOut')">Import insights</button>
    <div id="judgeOut" class="out"></div>
  </section>

  <section class="panel">
    <h2>Dashboard &amp; Golden</h2>
    <label>dashboard name</label>
    <input id="dashName" placeholder="my-run" />
    <button onclick="needRun()&&post('/api/dashboard',{runId:RUN,name:val('dashName')},'dashOut')">Build dashboard</button>
    <button class="sec" onclick="post('/api/golden',{},'dashOut','GET')">List golden</button>
    <div id="dashOut" class="out"></div>
  </section>
</main>
<script>
  let RUN = null;
  const val = id => document.getElementById(id).value.trim();
  const needRun = () => RUN || (alert('Select a run from the table first.'), false);
  function show(id, data){
    const el = document.getElementById(id);
    if (data && data.htmlPath){ const f = data.htmlPath.split(/[\\\\/]/).pop();
      el.innerHTML = 'Built. <a href="/dashboards/'+f+'" target="_blank">Open '+f+'</a>'; return; }
    el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 1);
  }
  async function post(url, body, outId, after){
    show(outId, 'running…');
    try {
      const opt = after === 'GET' ? {} : { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) };
      const r = await fetch(url, opt); const j = await r.json();
      show(outId, r.ok ? j : ('ERROR: '+(j.error||r.status)));
      if (typeof after === 'function' && r.ok) after();
    } catch(e){ show(outId, 'ERROR: '+e.message); }
  }
  function pick(runId, tr){ RUN = runId; document.querySelectorAll('tr.run').forEach(x=>x.classList.remove('sel'));
    tr.classList.add('sel'); document.getElementById('selinfo').textContent = '→ '+runId.slice(0,8);
    document.getElementById('dashName').value = runId.slice(0,8); }
  async function loadRuns(){
    const tb = document.getElementById('runs');
    try {
      const r = await fetch('/api/runs'); const {runs} = await r.json();
      if (!runs.length){ tb.innerHTML = '<tr><td colspan=7 style="color:var(--mut)">no runs yet — ingest one</td></tr>'; return; }
      tb.innerHTML = runs.map(s => '<tr class="run" onclick="pick(\\''+s.runId+'\\',this)">'
        + '<td><span class="badge '+s.gate+'">'+(s.gate==='red'?'● RED':s.gate==='green'?'● GREEN':'—')+'</span></td>'
        + '<td title="'+s.runId+'">'+s.runId.slice(0,8)+'</td><td>'+(s.workspace||'').slice(0,8)+'</td>'
        + '<td>'+s.fromDate+'</td><td>'+s.mode+'</td><td>'+s.turns+'</td>'
        + '<td>'+s.findings+(s.blocking?(' ('+s.blocking+' blk)'):'')+'</td></tr>').join('');
    } catch(e){ tb.innerHTML = '<tr><td colspan=7>ERROR: '+e.message+'</td></tr>'; }
  }
  loadRuns();
</script>
</body>
</html>`;
}

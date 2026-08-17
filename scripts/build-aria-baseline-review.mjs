#!/usr/bin/env node
import{mkdirSync,readFileSync,readdirSync,writeFileSync}from'node:fs';
import{join,resolve}from'node:path';
const bundle=resolve(process.argv[2]||''),out=resolve(process.argv[3]||join(bundle,'baseline-review'));
if(!process.argv[2])throw Error('usage: node scripts/build-aria-baseline-review.mjs <bundle-dir> [out-dir]');
const cases=readFileSync(join(bundle,'review-cases.jsonl'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const judgments=readdirSync(join(bundle,'judgments')).filter(x=>x.endsWith('.judgments.json')).sort().flatMap(x=>JSON.parse(readFileSync(join(bundle,'judgments',x),'utf8')).judgments||[]);
const byId=new Map(judgments.map(j=>[j.blind_id,j]));
if(cases.length!==judgments.length)throw Error(`case/judgment mismatch: ${cases.length}/${judgments.length}`);
const norm=v=>v==='insufficient-evidence'?'needs-work':v;
const reason=j=>j.fixture_issue?'fixture-issue':j.deterministic_relation==='overrides'?'deterministic-conflict':j.evidence_sufficiency!=='sufficient'?'insufficient-evidence':j.failure_stage==='unknown'&&j.verdict!=='good'?'unknown-root-cause':j.confidence<.7?'low-confidence':'';
const calls=c=>(c.execution?.attempts||[]).flatMap(a=>a.turns||[]).flatMap(t=>t.tools||[]);
const name=c=>c.name||c.tool_name||c.toolName||'(unknown)',ok=c=>c.status==='ok'||c.kind==='success';
const inc=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const cell=v=>{const s=v==null?'':typeof v==='string'?v:JSON.stringify(v);return/[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s};
const csv=rows=>rows.map(r=>r.map(cell).join(',')).join('\n')+'\n';
const verdicts={},reviewReasons={},stages={},layers={},categories={},dimensions={},tools=new Map();
const rows=cases.map(c=>{const j=byId.get(c.blind_id);if(!j)throw Error(`missing judgment ${c.blind_id}`);const v=norm(j.verdict),rr=reason(j),trace=calls(c),names=trace.map(name),unique=[...new Set(names)];
inc(verdicts,v);if(rr)inc(reviewReasons,rr);inc(stages,j.failure_stage||'(none)');inc(layers,j.fix_layer||'(none)');
categories[c.category]||={total:0,good:0,'needs-work':0,broken:0};categories[c.category].total++;categories[c.category][v]++;
for(const[k,x]of Object.entries(j.dimensions||{})){dimensions[k]||={count:0,sum:0};dimensions[k].count++;dimensions[k].sum+=Number(x)}
for(const n of unique){if(!tools.has(n))tools.set(n,{calls:0,successful_calls:0,failed_calls:0,cases:new Set(),good:new Set(),'needs-work':new Set(),broken:new Set(),failure_stages:{}});const s=tools.get(n);s.cases.add(c.case_id);s[v].add(c.case_id);inc(s.failure_stages,j.failure_stage||'(none)')}
for(const x of trace){const s=tools.get(name(x));s.calls++;s[ok(x)?'successful_calls':'failed_calls']++}
const visual=c.visuals?.validation||{};
return[c.case_id,c.category,c.query,v,j.verdict,j.confidence,rr?'yes':'no',rr,j.failure_stage,j.failed_component,j.process_error,j.likely_root_cause,j.fix_layer,j.evidence_sufficiency,j.fixture_issue?'yes':'no',j.deterministic_relation,unique.join(' > '),trace.map(x=>`${name(x)}:${ok(x)?'ok':'error'}`).join(' > '),j.causal_evidence,j.rationale,c.deterministic_validation?.asserted?(c.deterministic_validation.passed?'pass':'fail'):'not-asserted',visual.requested?'yes':'no',visual.emitted?'yes':'no',visual.data_observable?'yes':'no',visual.render_status||'not-observed']});
const header=['case_id','benchmark_category','query','report_verdict','raw_judge_grade','confidence','manual_review','review_reason','first_failure_stage','failed_component','process_error','likely_root_cause','fix_layer','evidence_sufficiency','fixture_issue','deterministic_relation','unique_tools','tool_trace','causal_evidence','judge_rationale','deterministic_result','visual_requested','visual_emitted','visual_data_observable','browser_render_status'];
const toolRows=[...tools].map(([n,s])=>[n,s.calls,s.successful_calls,s.failed_calls,s.cases.size,s.good.size,s['needs-work'].size,s.broken.size,s.failure_stages]).sort((a,b)=>b[4]-a[4]||String(a[0]).localeCompare(String(b[0])));
const toolHeader=['tool','calls','successful_calls','failed_calls','cases_used','good_cases','needs_work_cases','broken_cases','case_failure_stages'];
for(const x of Object.values(dimensions)){x.average=Math.round(x.sum/x.count*100)/100;delete x.sum}
const toolSummary=Object.fromEntries(toolRows.map(r=>[r[0],{calls:r[1],successful_calls:r[2],failed_calls:r[3],cases_used:r[4],case_verdicts:{good:r[5],'needs-work':r[6],broken:r[7]},case_failure_stages:r[8]}]));
const summary={schema:'aria-baseline-review/v1',source_bundle:bundle,cases:cases.length,judgments:judgments.length,verdicts,manual_review:{total:Object.values(reviewReasons).reduce((a,b)=>a+b,0),reasons:reviewReasons},failure_stages:stages,fix_layers:layers,categories,dimensions,tools_observed:toolSummary,notes:{verdict_scope:'The verdict grades the complete case, not the tool implementation in isolation.',tool_success_scope:'A successful call does not prove correct selection, scope, data, or synthesis.',visual_scope:'Browser rendering and plotted chart points were not observable in this API-only run.'}};
mkdirSync(out,{recursive:true});writeFileSync(join(out,'case-review.csv'),csv([header,...rows]));writeFileSync(join(out,'tool-trace-summary.csv'),csv([toolHeader,...toolRows]));writeFileSync(join(out,'baseline-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(`Wrote ${cases.length} case reviews and ${toolRows.length} tool summaries to ${out}`);

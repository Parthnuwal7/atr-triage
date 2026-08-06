export type Layer =
  | 'router' | 'planner' | 'engine' | 'data' | 'renderer'
  | 'auth' | 'memory' | 'infra' | 'rig';

export type FailureClass =
  | 'scope-leak' | 'permission' | 'cross-tenant' | 'api-failure'
  | 'entity-not-found' | 'chart-binding' | 'empty-answer'
  | 'hallucination' | 'wrong-inference' | 'dropped-followup'
  | 'missed-clarify' | 'over-clarify' | 'wrong-language' | 'rig-error'
  | 'evidence-missing' | 'trace-missing' | 'tool-mismatch' | 'route-mismatch'
  | 'shape-mismatch' | 'premise-failure' | 'subgoal-missing';

export type FixType = 'guard' | 'data' | 'routing' | 'reasoning' | 'infra' | 'rig';
export type Detector = 'assertion' | 'judge';
export type Severity = 'p0' | 'high' | 'med' | 'low';

export interface Finding {
  class: FailureClass;
  layer: Layer;
  detector: Detector;
  fixType: FixType;
  severity: Severity;
  blocking: boolean;
  message: string;
  evidence?: Record<string, unknown>;
}

export const CLASS_META: Record<FailureClass, { layer: Layer; fixType: FixType; severity: Severity }> = {
  'scope-leak':       { layer: 'auth',     fixType: 'guard',     severity: 'p0' },
  'permission':       { layer: 'auth',     fixType: 'guard',     severity: 'p0' },
  'cross-tenant':     { layer: 'auth',     fixType: 'guard',     severity: 'p0' },
  'api-failure':      { layer: 'infra',    fixType: 'infra',     severity: 'high' },
  'entity-not-found': { layer: 'memory',   fixType: 'guard',     severity: 'high' },
  'chart-binding':    { layer: 'renderer', fixType: 'data',      severity: 'high' },
  'empty-answer':     { layer: 'renderer', fixType: 'guard',     severity: 'high' },
  'hallucination':    { layer: 'engine',   fixType: 'reasoning', severity: 'high' },
  'wrong-inference':  { layer: 'engine',   fixType: 'reasoning', severity: 'med' },
  'dropped-followup': { layer: 'router',   fixType: 'routing',   severity: 'med' },
  'missed-clarify':   { layer: 'router',   fixType: 'routing',   severity: 'med' },
  'over-clarify':     { layer: 'router',   fixType: 'routing',   severity: 'med' },
  'wrong-language':   { layer: 'renderer', fixType: 'guard',     severity: 'low' },
  'rig-error':        { layer: 'rig',      fixType: 'rig',       severity: 'high' },
  'evidence-missing': { layer: 'rig',      fixType: 'rig',       severity: 'high' },
  'trace-missing':    { layer: 'rig',      fixType: 'rig',       severity: 'high' },
  'tool-mismatch':    { layer: 'planner',  fixType: 'routing',   severity: 'high' },
  'route-mismatch':   { layer: 'router',   fixType: 'routing',   severity: 'high' },
  'shape-mismatch':   { layer: 'renderer', fixType: 'guard',     severity: 'high' },
  'premise-failure':  { layer: 'engine',   fixType: 'reasoning', severity: 'high' },
  'subgoal-missing':  { layer: 'planner',  fixType: 'reasoning', severity: 'high' },
};

const BLOCKING: ReadonlySet<FailureClass> = new Set([
  'scope-leak', 'permission', 'cross-tenant', 'rig-error', 'evidence-missing',
  'trace-missing', 'tool-mismatch', 'route-mismatch', 'shape-mismatch',
  'premise-failure', 'subgoal-missing', 'chart-binding',
]);

export function isBlocking(c: FailureClass): boolean {
  return BLOCKING.has(c);
}

export function makeFinding(
  c: FailureClass,
  detector: Detector,
  message: string,
  evidence?: Record<string, unknown>
): Finding {
  const m = CLASS_META[c];
  return {
    class: c, detector, message, evidence,
    layer: m.layer, fixType: m.fixType, severity: m.severity,
    blocking: isBlocking(c),
  };
}

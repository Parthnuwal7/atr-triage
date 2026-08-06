export interface CaseExpectation {
  scopePlatform?: string;
  forbidPlatforms?: string[];
  entity?: string;
  entityExists?: boolean;
  mustNotWrite?: boolean;
  /** The workspace this turn must have queried (cross-tenant assertion, needs the trace). */
  expectedWorkspace?: string;
  /** Evidence and behavior contract used by paired-rollout assertions. */
  requiredEvidence?: Array<'trace' | 'tools'>;
  expectedTool?: string;
  expectedRoute?: string;
  answerShape?: 'text' | 'table' | 'chart' | 'clarification' | 'refusal';
  premisePolicy?: 'accept' | 'challenge' | 'verify';
  requiredSubgoals?: string[];
  chart?: 'optional' | 'required' | 'forbidden' | 'data-backed';
}

export type ExpectationMap = Record<string, CaseExpectation>;

export interface ExpectationMetadata {
  schemaVersion: number;
  contractVersion: string | null;
}

const metadata = new WeakMap<ExpectationMap, ExpectationMetadata>();

export function expectationMetadata(map: ExpectationMap): ExpectationMetadata {
  return metadata.get(map) ?? { schemaVersion: 1, contractVersion: null };
}

/** Parse a hand-authored expectations file. Invalid policy must never degrade to no policy. */
export function parseExpectations(json: string): ExpectationMap {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (error) {
    throw new Error(`invalid expectations JSON: ${(error as Error).message}`);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('expectations must be an object keyed by case id');
  }
  const top = obj as Record<string, unknown>;
  const versioned = 'cases' in top || 'schemaVersion' in top || 'contractVersion' in top;
  let schemaVersion = 1;
  let contractVersion: string | null = null;
  let cases: unknown = obj;
  if (versioned) {
    if (top.schemaVersion !== 1) throw new Error(`unsupported expectations schemaVersion: ${String(top.schemaVersion)}`);
    if (typeof top.contractVersion !== 'string' || !top.contractVersion.trim()) {
      throw new Error('versioned expectations require a non-empty contractVersion');
    }
    if (!top.cases || typeof top.cases !== 'object' || Array.isArray(top.cases)) {
      throw new Error('versioned expectations require a cases object');
    }
    for (const key of Object.keys(top)) {
      if (!['schemaVersion', 'contractVersion', 'cases'].includes(key)) {
        throw new Error(`unknown expectations bundle field ${key}`);
      }
    }
    schemaVersion = 1;
    contractVersion = top.contractVersion;
    cases = top.cases;
  }
  const allowed = new Set([
    'scopePlatform', 'forbidPlatforms', 'entity', 'entityExists', 'mustNotWrite', 'expectedWorkspace',
    'requiredEvidence', 'expectedTool', 'expectedRoute', 'answerShape', 'premisePolicy',
    'requiredSubgoals', 'chart',
  ]);
  for (const [caseId, raw] of Object.entries(cases as Record<string, unknown>)) {
    if (!caseId.trim() || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`invalid expectation for case ${caseId || '(empty)'}`);
    }
    const expectation = raw as Record<string, unknown>;
    for (const key of Object.keys(expectation)) {
      if (!allowed.has(key)) throw new Error(`unknown expectation field ${key} for case ${caseId}`);
    }
    for (const key of ['scopePlatform', 'entity', 'expectedWorkspace', 'expectedTool', 'expectedRoute']) {
      if (expectation[key] != null && typeof expectation[key] !== 'string') {
        throw new Error(`${key} for case ${caseId} must be a string`);
      }
    }
    if (expectation.forbidPlatforms != null && (
      !Array.isArray(expectation.forbidPlatforms) ||
      !expectation.forbidPlatforms.every(value => typeof value === 'string')
    )) {
      throw new Error(`forbidPlatforms for case ${caseId} must be a string array`);
    }
    for (const key of ['requiredEvidence', 'requiredSubgoals']) {
      if (expectation[key] != null && (
        !Array.isArray(expectation[key]) ||
        !(expectation[key] as unknown[]).every(value => typeof value === 'string')
      )) {
        throw new Error(`${key} for case ${caseId} must be a string array`);
      }
    }
    if (Array.isArray(expectation.requiredEvidence) &&
        !expectation.requiredEvidence.every(value => ['trace', 'tools'].includes(value as string))) {
      throw new Error(`requiredEvidence for case ${caseId} contains an unsupported value`);
    }
    const enums: Record<string, string[]> = {
      answerShape: ['text', 'table', 'chart', 'clarification', 'refusal'],
      premisePolicy: ['accept', 'challenge', 'verify'],
      chart: ['optional', 'required', 'forbidden', 'data-backed'],
    };
    for (const [key, values] of Object.entries(enums)) {
      if (expectation[key] != null && !values.includes(expectation[key] as string)) {
        throw new Error(`${key} for case ${caseId} must be one of ${values.join(', ')}`);
      }
    }
    for (const key of ['entityExists', 'mustNotWrite']) {
      if (expectation[key] != null && typeof expectation[key] !== 'boolean') {
        throw new Error(`${key} for case ${caseId} must be a boolean`);
      }
    }
  }
  const map = cases as ExpectationMap;
  metadata.set(map, { schemaVersion, contractVersion });
  return map;
}

export function expectationFor(map: ExpectationMap, messageId: string): CaseExpectation | undefined {
  return map[messageId] ?? map[messageId.split('::')[0]];
}

import { createHash } from 'node:crypto';

export const BENCHMARK_SCHEMA_VERSION = 1 as const;
export const JUDGMENT_VERDICTS = ['good', 'needs-work', 'broken', 'insufficient-evidence'] as const;
export const JUDGMENT_SEVERITIES = ['low', 'med', 'high'] as const;
export const EVIDENCE_STATUSES = ['sufficient', 'partial', 'missing', 'contradictory'] as const;
export const JUDGMENT_DIMENSIONS = [
  'correctness', 'grounding', 'relevance', 'scope', 'chartChoice', 'usefulness',
] as const;

export type JudgmentVerdict = typeof JUDGMENT_VERDICTS[number];
export type JudgmentSeverity = typeof JUDGMENT_SEVERITIES[number];
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];

export interface BenchmarkProvenance {
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  fixtureVersion: string;
  promptVersion: string;
  deploymentVersion?: string;
  sourceDigest?: string;
  generatedAt: string;
}

export interface ExperimentManifest {
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  experimentId: string;
  name: string;
  seed: number;
  fixtureVersion: string;
  promptVersion: string;
  approaches: Array<{ id: string; label?: string; config?: Record<string, unknown> }>;
  repeats: number;
  cases: Array<{ id: string; query: string; category: string; expected?: Record<string, unknown> }>;
  attempts: BenchmarkAttempt[];
  provenance: BenchmarkProvenance;
}

export interface BenchmarkAttempt {
  caseId: string;
  approachId: string;
  repeatIndex: number;
  sequenceIndex: number;
  blindLabel: string;
}

export interface JudgmentDimensions {
  correctness?: number;
  grounding?: number;
  relevance?: number;
  scope?: number;
  chartChoice?: number;
  usefulness?: number;
}

export interface StructuredJudgment {
  messageId: string;
  verdict: JudgmentVerdict;
  category: string;
  severity: JudgmentSeverity;
  rationale: string;
  dimensions: JudgmentDimensions;
  confidence: number | null;
  evidenceSufficiency: EvidenceStatus;
}

export interface ReviewRecord {
  runId: string;
  messageId: string;
  reason: 'judge-disagreement' | 'low-confidence' | 'insufficient-evidence' | 'manual';
  status: 'pending' | 'resolved';
  resolution?: string;
  reviewer?: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

export function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

export function validateJudgment(j: StructuredJudgment): void {
  assertNonEmpty(j.messageId, 'messageId');
  if (!(JUDGMENT_VERDICTS as readonly string[]).includes(j.verdict)) {
    throw new Error(`invalid verdict for ${j.messageId}: ${j.verdict}`);
  }
  if (!(JUDGMENT_SEVERITIES as readonly string[]).includes(j.severity)) {
    throw new Error(`invalid severity for ${j.messageId}: ${j.severity}`);
  }
  if (!(EVIDENCE_STATUSES as readonly string[]).includes(j.evidenceSufficiency)) {
    throw new Error(`invalid evidence status for ${j.messageId}: ${j.evidenceSufficiency}`);
  }
  if (j.confidence != null && (j.confidence < 0 || j.confidence > 1)) {
    throw new Error(`confidence for ${j.messageId} must be between 0 and 1`);
  }
  if ((j.verdict === 'insufficient-evidence') !== (j.evidenceSufficiency !== 'sufficient')) {
    throw new Error(`verdict and evidence sufficiency disagree for ${j.messageId}`);
  }
  const keys = Object.keys(j.dimensions);
  for (const [dimension, score] of Object.entries(j.dimensions)) {
    if (!(JUDGMENT_DIMENSIONS as readonly string[]).includes(dimension)) {
      throw new Error(`unknown judgment dimension ${dimension} for ${j.messageId}`);
    }
    if (!Number.isInteger(score) || score == null || score < 0 || score > 4) {
      throw new Error(`${dimension} score for ${j.messageId} must be an integer between 0 and 4`);
    }
  }
  for (const dimension of JUDGMENT_DIMENSIONS) {
    if (!keys.includes(dimension)) throw new Error(`missing ${dimension} score for ${j.messageId}`);
  }
  assertNonEmpty(j.rationale, `rationale for ${j.messageId}`);
}

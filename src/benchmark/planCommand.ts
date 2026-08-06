import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BENCHMARK_SCHEMA_VERSION,
  digest,
  type BenchmarkAttempt,
  type ExperimentManifest,
} from './schema.js';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';

interface FixtureCase {
  id?: string;
  scenario_tag?: string;
  query?: string;
  input?: string;
  category?: string;
  expected_summary?: string;
  expected_tool?: string;
}

function fixtureCases(raw: unknown): ExperimentManifest['cases'] {
  const root = raw as Record<string, unknown>;
  const flat = Array.isArray(root.prompts)
    ? root.prompts as FixtureCase[]
    : Array.isArray(root.test_suites)
      ? (root.test_suites as Array<{ category?: string; prompts?: FixtureCase[] }>).flatMap(
          suite => (suite.prompts ?? []).map(item => ({ ...item, category: item.category ?? suite.category }))
        )
      : [];
  if (!flat.length) throw new Error('fixture has no prompts');
  const seen = new Set<string>();
  return flat.map((item, index) => {
    const id = item.id ?? item.scenario_tag;
    if (!id) throw new Error(`fixture prompt ${index + 1} has no stable id or scenario_tag`);
    if (seen.has(id)) throw new Error(`duplicate fixture case id: ${id}`);
    seen.add(id);
    const query = item.query ?? item.input;
    if (!query) throw new Error(`fixture case ${id} has no query/input`);
    return {
      id,
      query,
      category: item.category ?? 'Uncategorized',
      expected: {
        ...(item.expected_summary ? { summary: item.expected_summary } : {}),
        ...(item.expected_tool ? { tool: item.expected_tool } : {}),
      },
    };
  });
}

/** Mulberry32: deterministic across supported Node versions. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildInterleavedAttempts(
  caseIds: string[],
  approachIds: string[],
  repeats: number,
  seed: number
): BenchmarkAttempt[] {
  if (approachIds.length < 2) throw new Error('at least two approaches are required');
  if (new Set(approachIds).size !== approachIds.length) throw new Error('approach ids must be unique');
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('repeats must be a positive integer');
  const random = rng(seed);
  const attempts: BenchmarkAttempt[] = [];
  let sequenceIndex = 0;
  for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex++) {
    const cases = shuffled(caseIds, random);
    for (let casePosition = 0; casePosition < cases.length; casePosition++) {
      // Rotate which approach runs first to avoid systematic warm-cache/time-order bias.
      const offset = (casePosition + repeatIndex) % approachIds.length;
      const ordered = approachIds.map((_, i) => approachIds[(i + offset) % approachIds.length]);
      for (const approachId of ordered) {
        attempts.push({
          caseId: cases[casePosition],
          approachId,
          repeatIndex,
          sequenceIndex: sequenceIndex++,
          blindLabel: `response-${digest(`${seed}:${approachId}`).slice(0, 8)}`,
        });
      }
    }
  }
  return attempts;
}

export interface PlanBenchmarkArgs {
  fixturePath: string;
  approaches: string[];
  repeats: number;
  seed: number;
  name: string;
  promptVersion: string;
  outPath: string;
}

export function runPlanBenchmark(args: PlanBenchmarkArgs): ExperimentManifest {
  const fixtureText = readFileSync(args.fixturePath, 'utf8');
  const raw = JSON.parse(fixtureText) as Record<string, unknown>;
  const cases = fixtureCases(raw);
  const fixtureVersion = String(raw.version ?? digest(fixtureText).slice(0, 12));
  const manifest: ExperimentManifest = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    experimentId: randomUUID(),
    name: args.name,
    seed: args.seed,
    fixtureVersion,
    promptVersion: args.promptVersion,
    approaches: args.approaches.map(id => ({ id })),
    repeats: args.repeats,
    cases,
    attempts: buildInterleavedAttempts(cases.map(c => c.id), args.approaches, args.repeats, args.seed),
    provenance: {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      fixtureVersion,
      promptVersion: args.promptVersion,
      sourceDigest: digest(fixtureText),
      generatedAt: new Date().toISOString(),
    },
  };
  mkdirSync(dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function persistExperimentPlan(cfg: TriageConfig, manifest: ExperimentManifest): Promise<void> {
  const local = getLocalPool(cfg);
  try {
    await local.query('BEGIN');
    try {
      await local.query(
        `INSERT INTO benchmark_experiments (
           experiment_id, schema_version, name, seed, fixture_version, prompt_version, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (experiment_id) DO NOTHING`,
        [
          manifest.experimentId, manifest.schemaVersion, manifest.name, manifest.seed,
          manifest.fixtureVersion, manifest.promptVersion,
          JSON.stringify({ provenance: manifest.provenance, approaches: manifest.approaches, repeats: manifest.repeats }),
        ]
      );
      for (const attempt of manifest.attempts) {
        await local.query(
          `INSERT INTO benchmark_attempts (
             experiment_id, case_id, approach_id, repeat_index, sequence_index, blind_label
           ) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (experiment_id,case_id,approach_id,repeat_index) DO UPDATE SET
             sequence_index=EXCLUDED.sequence_index, blind_label=EXCLUDED.blind_label`,
          [
            manifest.experimentId, attempt.caseId, attempt.approachId, attempt.repeatIndex,
            attempt.sequenceIndex, attempt.blindLabel,
          ]
        );
      }
      await local.query('COMMIT');
    } catch (error) {
      await local.query('ROLLBACK');
      throw error;
    }
  } finally {
    await local.end();
  }
}

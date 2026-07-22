import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import type { TriageConfig } from './config.js';

export function getProdReadPool(cfg: TriageConfig): pg.Pool {
  // ssl relaxed for managed PG; max kept low to stay light on the primary.
  return new pg.Pool({ connectionString: cfg.prodReadUrl, ssl: { rejectUnauthorized: false }, max: 3 });
}

/**
 * Minimal DB surface the local store needs. Backed by embedded PGlite (real Postgres,
 * in-process) so there is no Docker/WSL dependency. `query` runs a single parameterized
 * statement ($1 style); `exec` runs a multi-statement script (migrations); `end` closes.
 */
export interface LocalDb {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  end(): Promise<void>;
}

/**
 * cfg.localUrl is a PGlite data location, NOT a postgres:// URL:
 *   - 'memory://'        → ephemeral in-memory DB (tests)
 *   - './localdb' (path) → persisted to that directory
 */
export function getLocalPool(cfg: TriageConfig): LocalDb {
  const db = new PGlite(cfg.localUrl);
  return {
    query: async <T = any>(sql: string, params?: unknown[]) => {
      const res = await db.query<T>(sql, params as any[] | undefined);
      return { rows: res.rows };
    },
    exec: async (sql: string) => { await db.exec(sql); },
    end: async () => { await db.close(); },
  };
}

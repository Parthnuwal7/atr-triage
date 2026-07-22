import pg from 'pg';
import type { TriageConfig } from './config.js';

export function getProdReadPool(cfg: TriageConfig): pg.Pool {
  // ssl relaxed for managed PG; max kept low to stay light on the primary.
  return new pg.Pool({ connectionString: cfg.prodReadUrl, ssl: { rejectUnauthorized: false }, max: 3 });
}

export function getLocalPool(cfg: TriageConfig): pg.Pool {
  return new pg.Pool({ connectionString: cfg.localUrl, max: 5 });
}

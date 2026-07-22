import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    process.env.PROD_READ_DATABASE_URL = 'postgres://ro@h/db';
    process.env.LOCAL_DATABASE_URL = 'postgres://triage@localhost:5544/triage';
  });
  it('reads both connection strings from env', () => {
    const cfg = loadConfig();
    expect(cfg.prodReadUrl).toBe('postgres://ro@h/db');
    expect(cfg.localUrl).toBe('postgres://triage@localhost:5544/triage');
  });
  it('throws when a required var is missing', () => {
    delete process.env.PROD_READ_DATABASE_URL;
    expect(() => loadConfig()).toThrow(/PROD_READ_DATABASE_URL/);
  });
});

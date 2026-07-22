import 'dotenv/config';

export interface TriageConfig {
  prodReadUrl: string;
  localUrl: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): TriageConfig {
  return {
    prodReadUrl: required('PROD_READ_DATABASE_URL'),
    localUrl: required('LOCAL_DATABASE_URL'),
  };
}

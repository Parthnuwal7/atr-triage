/**
 * atr-triage UI — a tiny localhost HTTP server (Node built-in `http`, no framework).
 * Serves the single page and a handful of JSON endpoints that call the command functions
 * directly. Bound to 127.0.0.1 — a local dev tool, no auth. Every handler is try/caught so
 * a bad input returns {error} and never takes the server down.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { TriageConfig } from '../config.js';
import { renderPage } from './page.js';
import {
  matchRoute,
  handleRuns,
  handleIngest,
  handleAssert,
  handleJudge,
  handleImport,
  handleDashboard,
  handleGoldenList,
  handleGoldenAdd,
} from './handlers.js';

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => (d += c));
    req.on('end', () => {
      try {
        resolve(d ? (JSON.parse(d) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export function createUiServer(cfg: TriageConfig) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = matchRoute(req.method || 'GET', url.pathname);
    try {
      if (route === 'page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderPage());
        return;
      }
      if (route === 'dashboardFile') {
        // basename() strips any ../ traversal — only files directly in dashboards/ are served.
        const html = await readFile(join(process.cwd(), 'dashboards', basename(url.pathname)), 'utf8').catch(
          () => null
        );
        if (html == null) {
          res.writeHead(404);
          res.end('dashboard not found');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (route === 'runs') return sendJson(res, 200, await handleRuns(cfg));
      if (route === 'goldenList') return sendJson(res, 200, await handleGoldenList(cfg));

      const body = route ? await readJson(req) : {};
      switch (route) {
        case 'ingest':
          return sendJson(res, 200, await handleIngest(cfg, body));
        case 'assert':
          return sendJson(res, 200, await handleAssert(cfg, body));
        case 'judge':
          return sendJson(res, 200, await handleJudge(cfg, body));
        case 'import':
          return sendJson(res, 200, await handleImport(cfg, body));
        case 'dashboard':
          return sendJson(res, 200, await handleDashboard(cfg, body));
        case 'goldenAdd':
          return sendJson(res, 200, await handleGoldenAdd(cfg, body));
        default:
          return sendJson(res, 404, { error: 'not found' });
      }
    } catch (e) {
      sendJson(res, 500, { error: (e as Error)?.message ?? 'internal error' });
    }
  });
}

export function startUi(cfg: TriageConfig, port = 4180) {
  const server = createUiServer(cfg);
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  atr-triage UI → http://127.0.0.1:${port}\n  (Ctrl-C to stop)\n`);
  });
  return server;
}

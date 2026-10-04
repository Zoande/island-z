import { createServer } from 'node:http';
import { GENERATOR_VERSION, parseWorldConfig } from '../shared/config';
export function createWorldServer(configuration: unknown) {
  const world = Object.freeze({ ...parseWorldConfig(configuration), generatorVersion: GENERATOR_VERSION });
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(JSON.stringify({ error: 'Read-only world server.' })); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/world') { res.end(JSON.stringify(world)); return; }
    if (path === '/api/health') { res.end(JSON.stringify({ status: 'ok', generatorVersion: GENERATOR_VERSION })); return; }
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found.' }));
  });
}

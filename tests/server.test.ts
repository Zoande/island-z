import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createWorldServer } from '../server/app';
import { GENERATOR_VERSION } from '../shared/config';
describe('world server', () => {
  it('serves an immutable authoritative world, health, and clear method errors', async () => {
    const configuration = { seed: 'server-test', islandSizeMeters: 30720 };
    const server = createWorldServer(configuration);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      configuration.seed = 'mutated';
      const response = await fetch(url + '/api/world');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ seed: 'server-test', islandSizeMeters: 30720, generatorVersion: GENERATOR_VERSION });
      expect(await (await fetch(url + '/api/health')).json()).toEqual({ status: 'ok', generatorVersion: GENERATOR_VERSION });
      expect((await fetch(url + '/api/world', { method: 'POST' })).status).toBe(405);
      expect((await fetch(url + '/unknown')).status).toBe(404);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('fails startup on invalid world configuration', () => {
    expect(() => createWorldServer({ seed: '', islandSizeMeters: 30720 })).toThrow();
    expect(() => createWorldServer({ seed: 'x', islandSizeMeters: Infinity })).toThrow();
  });
});

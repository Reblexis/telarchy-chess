// The feed's HTTP surface (docs/chess.md, "The feed"): written before the server.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';

const fakeOp = {
  publicState: (_now: Date) => ({ schema: 1, phase: 'seeking' }),
  games: [{ number: 1, id: 'g1', result: 100 }],
  history: (g: number | 'current') => (g === 1 || g === 'current' ? { game: { number: 1 }, plies: [] } : null),
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer(fakeOp as never);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('the feed', () => {
  it('/state is JSON, open to any origin, never cached', async () => {
    const res = await fetch(`${base}/state`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ schema: 1, phase: 'seeking' });
  });
  it('/games lists the games', async () => {
    expect(await (await fetch(`${base}/games`)).json()).toEqual({ games: [{ number: 1, id: 'g1', result: 100 }] });
  });
  it('/history answers a known game and 404s an unknown one in JSON', async () => {
    expect((await fetch(`${base}/history?game=current`)).status).toBe(200);
    const res = await fetch(`${base}/history?game=7`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such game' });
  });
  it('an unknown path is a JSON 404', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
  it('a write method is a 405 naming what is allowed, and OPTIONS is a 204 preflight', async () => {
    const res = await fetch(`${base}/state`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    const pre = await fetch(`${base}/state`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
  });
  it('one reader past 600 reads a minute gets a 429 with retry-after', async () => {
    let last = 0;
    let retry: string | null = null;
    for (let i = 0; i < 601; i++) {
      const res = await fetch(`${base}/state`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
      last = res.status;
      retry = res.headers.get('retry-after');
      await res.arrayBuffer();
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
  }, 30_000);
});

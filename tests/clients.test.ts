// The HTTP clients against a fake fetch: the calls docs/chess.md names, the
// beta session and branch cookie, and no trade, draw or resign anywhere.
import { describe, it, expect } from 'vitest';
import { HttpTelarchyClient } from '../src/telarchy.js';
import { HttpLichessClient, ndjsonLines } from '../src/lichess.js';

type Req = { url: string; method: string; headers: Record<string, string>; body: string | null };

function fakeFetch(route: (r: Req) => { status?: number; body?: unknown; headers?: Record<string, string | string[]> }) {
  const reqs: Req[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const r: Req = { url: String(url), method: init.method ?? 'GET', headers, body: typeof init.body === 'string' ? init.body : init.body ? String(init.body) : null };
    reqs.push(r);
    const out = route(r);
    const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {});
    const h = new Headers();
    let setCookies: string[] = [];
    for (const [k, v] of Object.entries(out.headers ?? {})) {
      if (k.toLowerCase() === 'set-cookie') setCookies = Array.isArray(v) ? v : [v];
      else h.set(k, String(v));
    }
    const res = new Response(text, { status: out.status ?? 200, headers: h });
    (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie = () => setCookies;
    return res;
  }) as unknown as typeof fetch;
  return { f, reqs };
}

const CELL = '2026-09-14T14:00';

describe('the Telarchy client', () => {
  const base = { baseUrl: 'https://telarchy.com/beta/api', workspaceId: 'ws1', metricId: 'm1', workspaceUrl: 'https://telarchy.com/beta/chess' };

  it('an agent key goes in X-Agent-Key with the workspace header', async () => {
    const { f, reqs } = fakeFetch(() => ({ status: 201, body: { id: 'p9', number: 9 } }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k1' }, f);
    const ref = await c.postProposal('Game 1, move 1', 'desc', new Date('2026-09-13T14:00:20Z'), [{ id: 'e2e4', label: 'e4' }, { id: 'd2d4', label: 'd4' }]);
    expect(ref).toEqual({ id: 'p9', number: 9, url: 'https://telarchy.com/beta/chess/p/9' });
    expect(reqs[0].url).toBe('https://telarchy.com/beta/api/proposals');
    expect(reqs[0].headers['x-agent-key']).toBe('k1');
    expect(reqs[0].headers['x-workspace-id']).toBe('ws1');
    expect(JSON.parse(reqs[0].body!)).toEqual({
      title: 'Game 1, move 1', description: 'desc', decideBy: '2026-09-13T14:00:20.000Z',
      options: [{ id: 'e2e4', label: 'e4' }, { id: 'd2d4', label: 'd4' }],
    });
  });

  it('on the beta a session signs in once and every call carries the session and the branch cookie', async () => {
    const { f, reqs } = fakeFetch(r =>
      r.url.endsWith('/auth/sign-in/email')
        ? { body: {}, headers: { 'set-cookie': ['better-auth.session_token=abc; Path=/; HttpOnly'] } }
        : { body: { ok: true } },
    );
    const c = new HttpTelarchyClient({ ...base, apiKey: '', branch: 'br-many-option-proposals', session: { email: 'a@b.c', password: 'pw', authUrl: 'https://telarchy.com/api' } }, f);
    await c.declineProposal({ id: 'p1', number: 1, url: '' });
    await c.refreshBooks();
    expect(reqs.filter(r => r.url.endsWith('/auth/sign-in/email'))).toHaveLength(1);
    const call = reqs.find(r => r.url.endsWith('/proposals/p1/decline'))!;
    expect(call.headers.cookie).toContain('better-auth.session_token=abc');
    expect(call.headers.cookie).toContain('telarchy_beta_branch=br-many-option-proposals');
    expect(call.headers['x-agent-key']).toBeUndefined();
    expect(JSON.parse(call.body!)).toEqual({ refund: true });
  });

  it('a key and a session together: the key is who acts, the session only opens the beta gate', async () => {
    const { f, reqs } = fakeFetch(r =>
      r.url.endsWith('/auth/sign-in/email')
        ? { body: {}, headers: { 'set-cookie': ['better-auth.session_token=abc; Path=/; HttpOnly'] } }
        : { body: { ok: true } },
    );
    const c = new HttpTelarchyClient({ ...base, apiKey: 'op-key', branch: 'br-x', session: { email: 'a@b.c', password: 'pw', authUrl: 'https://telarchy.com/api' } }, f);
    await c.declineProposal({ id: 'p1', number: 1, url: '' });
    const call = reqs.find(r => r.url.endsWith('/proposals/p1/decline'))!;
    expect(call.headers['x-agent-key']).toBe('op-key');
    expect(call.headers.cookie).toContain('better-auth.session_token=abc');
    expect(call.headers.cookie).toContain('telarchy_beta_branch=br-x');
  });

  it('prices are read per option from the row on the game cell', async () => {
    const { f } = fakeFetch(() => ({
      body: {
        markets: [
          { targetDate: '2026-09-15T10:00', options: [{ id: 'e2e4', consensus: 1, delta: 0, marketId: 'wrong' }] },
          { targetDate: CELL, options: [
            { id: 'e2e4', consensus: 55.5, delta: 2, marketId: 'mk1' },
            { id: 'd2d4', consensus: null, delta: null, marketId: 'mk2' },
          ] },
        ],
      },
    }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k' }, f);
    expect(await c.readPrices({ id: 'p1', number: 1, url: '' }, CELL)).toEqual({
      e2e4: { price: 55.5, lead: 2, marketId: 'mk1' },
      d2d4: { price: null, lead: null, marketId: 'mk2' },
    });
  });

  it('a row named by its settlement instant rather than a target date is found too', async () => {
    const { f } = fakeFetch(() => ({ body: { markets: [{ resolvesOn: '2026-09-14T14:01:00.000Z', options: [{ id: 'a2a3', consensus: 40, delta: 1, marketId: 'x' }] }] } }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k' }, f);
    expect((await c.readPrices({ id: 'p1', number: 1, url: '' }, CELL)).a2a3.price).toBe(40);
  });

  it('a refused call throws with the status and the error', async () => {
    const { f } = fakeFetch(() => ({ status: 409, body: { error: 'proposal_closed' } }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k' }, f);
    await expect(c.approveOption({ id: 'p1', number: 1, url: '' }, 'e2e4')).rejects.toThrow(/409 proposal_closed/);
  });

  it('the horizon, the reading and the settlement name the metric', async () => {
    const { f, reqs } = fakeFetch(r => (r.method === 'GET' ? { body: { timePreference: { horizonCredits: {} } } } : { body: {} }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k' }, f);
    await c.setHorizon(CELL);
    await c.postReading(100, new Date('2026-09-13T15:00:00Z'));
    await c.settleMetric(100, new Date('2026-09-13T15:00:00Z'), 'Game 1 vs X: win');
    const put = reqs.find(r => r.method === 'PUT' && r.body?.includes('customHorizons'))!;
    expect(JSON.parse(put.body!).timePreference).toEqual({ enabled: false, customHorizons: [CELL], horizonCredits: { [CELL]: { book: 3000, proposal: 1000 } } });
    expect(JSON.parse(reqs.find(r => r.body?.includes('"value":100') && r.method === 'PUT')!.body!)).toMatchObject({ value: 100, asOf: '2026-09-13T15:00:00.000Z' });
    const settle = reqs.find(r => r.url.endsWith('/metrics/m1/settle'))!;
    expect(JSON.parse(settle.body!)).toEqual({ value: 100, asOf: '2026-09-13T15:00:00.000Z', reason: 'Game 1 vs X: win' });
  });

  it('the operator client has no way to trade', () => {
    const names = Object.getOwnPropertyNames(HttpTelarchyClient.prototype);
    expect(names.some(n => /trade|order|buy|sell/i.test(n))).toBe(false);
  });
});

describe('the Lichess client', () => {
  it('a move is POST /api/bot/game/:id/move/:uci with the bearer token', async () => {
    const { f, reqs } = fakeFetch(() => ({ body: { ok: true } }));
    const c = new HttpLichessClient('tok', f);
    await c.move('g1', 'e7e8q');
    expect(reqs[0]).toMatchObject({ url: 'https://lichess.org/api/bot/game/g1/move/e7e8q', method: 'POST' });
    expect(reqs[0].headers.authorization).toBe('Bearer tok');
  });
  it('accept, decline with a reason, cancel, and a challenge with its clock', async () => {
    const { f, reqs } = fakeFetch(r => (r.url.includes('/api/challenge/somebot') ? { body: { id: 'chX' } } : { body: { ok: true } }));
    const c = new HttpLichessClient('tok', f);
    await c.acceptChallenge('c1');
    await c.declineChallenge('c2', 'timeControl');
    await c.cancelChallenge('c3');
    expect(await c.challenge('somebot', { limit: 1800, increment: 20, rated: true })).toEqual({ id: 'chX' });
    expect(reqs.map(r => r.url)).toEqual([
      'https://lichess.org/api/challenge/c1/accept',
      'https://lichess.org/api/challenge/c2/decline',
      'https://lichess.org/api/challenge/c3/cancel',
      'https://lichess.org/api/challenge/somebot',
    ]);
    expect(new URLSearchParams(reqs[1].body!).get('reason')).toBe('timeControl');
    const form = new URLSearchParams(reqs[3].body!);
    expect([form.get('clock.limit'), form.get('clock.increment'), form.get('rated'), form.get('variant')]).toEqual(['1800', '20', 'true', 'standard']);
  });
  it('the account reads the classical rating, whether it is provisional, and the game counts', async () => {
    const { f } = fakeFetch(() => ({
      body: { username: 'TelarchyBot', url: 'https://lichess.org/@/TelarchyBot', perfs: { classical: { rating: 1720, prov: true } }, count: { all: 12, win: 3, loss: 8, draw: 1 } },
    }));
    expect(await new HttpLichessClient('tok', f).account()).toEqual({
      username: 'TelarchyBot', url: 'https://lichess.org/@/TelarchyBot', rating: 1720, provisional: true,
      games: { played: 12, won: 3, lost: 8, drawn: 1 },
    });
  });
  it('an account with no classical games yet is 1500 provisional with zero counts', async () => {
    const { f } = fakeFetch(() => ({ body: { username: 'TelarchyBot', perfs: {} } }));
    expect(await new HttpLichessClient('tok', f).account()).toEqual({
      username: 'TelarchyBot', url: 'https://lichess.org/@/TelarchyBot', rating: 1500, provisional: true,
      games: { played: 0, won: 0, lost: 0, drawn: 0 },
    });
  });
  it('online bots are read as ndjson', async () => {
    const { f } = fakeFetch(() => ({ body: '{"id":"a","username":"A"}\n{"id":"b","username":"B"}\n' }));
    expect((await new HttpLichessClient('tok', f).onlineBots()).map(b => b.id)).toEqual(['a', 'b']);
  });
  it('a refused move throws with the status', async () => {
    const { f } = fakeFetch(() => ({ status: 400, body: { error: 'Not your turn, or game already over' } }));
    await expect(new HttpLichessClient('tok', f).move('g1', 'e2e4')).rejects.toThrow(/400/);
  });
  it('a win against a departed opponent is claimed at POST /api/bot/game/:id/claim-victory', async () => {
    const { f, reqs } = fakeFetch(() => ({ body: { ok: true } }));
    await new HttpLichessClient('tok', f).claimVictory('g7');
    expect(reqs[0]).toMatchObject({ url: 'https://lichess.org/api/bot/game/g7/claim-victory', method: 'POST' });
  });
  it('the client can neither offer a draw nor resign', () => {
    const names = Object.getOwnPropertyNames(HttpLichessClient.prototype);
    expect(names.some(n => /draw|resign|takeback|abort/i.test(n))).toBe(false);
  });
});

describe('ndjson streams', () => {
  it('lines split across chunks are joined, keep-alive blank lines skipped, a bad line skipped', async () => {
    const chunks = ['{"type":"gameSta', 'rt","game":{"id":"g1"}}\n\n', 'not json\n{"type":"gameFinish"}\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); },
    });
    const out: unknown[] = [];
    for await (const v of ndjsonLines(stream)) out.push(v);
    expect(out).toEqual([{ type: 'gameStart', game: { id: 'g1' } }, { type: 'gameFinish' }]);
  });
});

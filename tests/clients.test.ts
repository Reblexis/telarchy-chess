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

  it('reads game-end prices from the no-deadline response even without a targetDate', async () => {
    const { f } = fakeFetch(() => ({ body: { markets: [
      { resolvesOn: '2026-09-14T14:01:00.000Z', options: [{ id: 'e2e4', consensus: 1, marketId: 'wrong' }] },
      { resolvesOn: '9999-12-31T00:00:00Z', options: [{ id: 'e2e4', consensus: 55, marketId: 'right' }] },
    ] } }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k1' }, f);
    expect(await c.readPrices({ id: 'p1', number: 1, url: '' }, 'until-settled')).toMatchObject({ e2e4: { price: 55, marketId: 'right' } });
  });
  it('names the game-end horizon without a calendar deadline', async () => {
    const { f, reqs } = fakeFetch(() => ({ body: {} }));
    const c = new HttpTelarchyClient({ ...base, apiKey: 'k1' }, f);
    await c.setHorizon('until-settled');
    expect(JSON.parse(reqs[0].body!).timePreference).toMatchObject({
      customHorizons: ['until-settled'],
      horizonTitles: { 'until-settled': 'when the game ends' },
    });
  });
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
    expect(JSON.parse(put.body!).timePreference).toEqual({ enabled: false, customHorizons: [CELL], horizonCredits: { [CELL]: { book: 6000, proposal: 2000 } } });
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
      body: { username: 'TelarchyRookie', url: 'https://lichess.org/@/TelarchyRookie', perfs: { classical: { rating: 1720, prov: true } }, count: { all: 12, win: 3, loss: 8, draw: 1 } },
    }));
    expect(await new HttpLichessClient('tok', f).account()).toEqual({
      username: 'TelarchyRookie', url: 'https://lichess.org/@/TelarchyRookie', rating: 1720, provisional: true,
      games: { played: 12, won: 3, lost: 8, drawn: 1 },
    });
  });
  it('an account with no classical games yet is 1500 provisional with zero counts', async () => {
    const { f } = fakeFetch(() => ({ body: { username: 'TelarchyRookie', perfs: {} } }));
    expect(await new HttpLichessClient('tok', f).account()).toEqual({
      username: 'TelarchyRookie', url: 'https://lichess.org/@/TelarchyRookie', rating: 1500, provisional: true,
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


describe('closure retries stop only when the proposal is known closed', () => {
  const base = { baseUrl: 'https://telarchy.com/beta/api', workspaceId: 'ws', metricId: 'm', workspaceUrl: '' };
  it.each(['approved', 'declined', 'lapsed', 'withdrawn', 'declined_spam'])('accepts an already %s proposal without another decision', async status => {
    const { f } = fakeFetch(() => ({ status: 409, body: { code: 'not_pending', status } }));
    await expect(new HttpTelarchyClient({ ...base, apiKey: 'k' }, f).declineProposal({ id: 'p1', number: 1, url: '' })).resolves.toBeUndefined();
  });
  it.each([404, 500, 401, 409])('keeps an unconfirmed %s failure retryable', async status => {
    const { f } = fakeFetch(() => ({ status, body: { error: 'failed' } }));
    await expect(new HttpTelarchyClient({ ...base, apiKey: 'k' }, f).declineProposal({ id: 'p1', number: 1, url: '' })).rejects.toThrow();
  });
});

// docs/chess.md "Liquidity": twice the snake's, because a chess move waits on
// the opponent and so takes about twice as long (Viktor, 2026-09-17).
import { MAIN_BOOK_CREDITS, OPTION_BOOK_CREDITS } from '../src/telarchy.js';
describe('liquidity is double the snake\'s: 6,000 on the game book, 2,000 on each move', () => {
  it('the main book opens with 6,000 credits', () => expect(MAIN_BOOK_CREDITS).toBe(6000));
  it('each legal move\'s book opens with 2,000 credits', () => expect(OPTION_BOOK_CREDITS).toBe(2000));
});

// docs/chess.md "The feed", `call` and `recentTrades`: Telarchy's public reads.
describe('the Telarchy client reads the game\'s call and the floor\'s trades', () => {
  const base = { baseUrl: 'https://telarchy.com/api', workspaceId: 'ws1', metricId: 'm1', workspaceUrl: 'https://telarchy.com/chess', apiKey: 'k1' };
  const route = (r: Req) => {
    const u = new URL(r.url);
    if (u.pathname === '/api/marketplace/ws1') return { body: { markets: [
      { marketId: 'other', metricId: 'mX', consensus: 3 },
      { marketId: 'main', metricId: 'm1', consensus: 57.46 },
    ] } };
    if (u.pathname === '/api/marketplace/ws1/markets/main/history') return { body: { history: [
      { at: '2026-09-17T18:50:56.365Z', consensus: 50 }, { at: '2026-09-17T18:51:26.416Z', consensus: 57.46 }, { at: 'bad', consensus: 'x' },
    ] } };
    if (u.pathname === '/api/data-room/actions') return { body: { rows: [
      { id: 'trade:a', at: '2026-09-17T18:51:26.416Z', kind: 'trade', actor: { id: 'gemini-flash', handle: 'gemini-flash' },
        detail: { side: 'buy', direction: 'lower', shares: 0.09, cost: 0.085, callBefore: 8, callAfter: 7.9, marketId: 'main' } },
      { id: 'trade:b', at: '2026-09-17T18:50:56.365Z', kind: 'trade', actor: { id: 'p1' },
        detail: { side: 'sell', direction: 'higher', cost: 31.85, callAfter: 8, marketId: 'opt' } },
      { id: 'order:c', at: '2026-09-17T18:50:00.000Z', kind: 'order', detail: { marketId: 'opt' } },
      { id: 'trade:d', at: '2026-09-17T18:49:00.000Z', kind: 'trade', detail: {} },
    ] } };
    return { status: 404, body: { error: 'nope' } };
  };

  it('one read each of the floor, the main book\'s history and the trade log', async () => {
    const { f, reqs } = fakeFetch(route);
    const a = await new HttpTelarchyClient(base, f).readActivity();
    expect(a.call).toEqual({ marketId: 'main', value: 57.46, history: [
      { at: '2026-09-17T18:50:56.365Z', value: 50 }, { at: '2026-09-17T18:51:26.416Z', value: 57.46 },
    ] });
    expect(a.trades).toEqual([
      { id: 'trade:a', at: '2026-09-17T18:51:26.416Z', handle: 'gemini-flash', side: 'buy', direction: 'lower', credits: 0.085, marketId: 'main', price: 7.9 },
      { id: 'trade:b', at: '2026-09-17T18:50:56.365Z', handle: 'p1', side: 'sell', direction: 'higher', credits: 31.85, marketId: 'opt', price: 8 },
    ]);
    const log = reqs.find(r => r.url.includes('/data-room/actions'))!;
    expect(new URL(log.url).searchParams.get('workspace')).toBe('ws1');
    expect(new URL(log.url).searchParams.get('kinds')).toBe('trade');
    expect(reqs.every(r => r.method === 'GET')).toBe(true);
  });

  it('THE OPERATOR NEVER TRADES: the activity read sends no key and writes nothing', async () => {
    const { f, reqs } = fakeFetch(route);
    await new HttpTelarchyClient(base, f).readActivity();
    expect(reqs.some(r => 'x-agent-key' in r.headers)).toBe(false);
    expect(reqs.some(r => r.method !== 'GET')).toBe(false);
  });

  it('no main book for the metric: the call is null, the trades still come', async () => {
    const { f } = fakeFetch(r => (new URL(r.url).pathname === '/api/marketplace/ws1' ? { body: { markets: [] } } : route(r)));
    const a = await new HttpTelarchyClient(base, f).readActivity();
    expect(a.call).toBeNull();
    expect(a.trades).toHaveLength(2);
  });

  it('a failed trade log rejects, so the operator keeps what it had', async () => {
    const { f } = fakeFetch(r => (r.url.includes('/data-room/') ? { status: 502, body: 'bad gateway' } : route(r)));
    await expect(new HttpTelarchyClient(base, f).readActivity()).rejects.toThrow();
  });
});

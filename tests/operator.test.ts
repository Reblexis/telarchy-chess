// The operator of docs/chess.md driven with fake Telarchy and Lichess clients
// and an explicit clock: written before the code.
import { describe, it, expect, vi } from 'vitest';
import { Operator, type TelarchyClient, type LichessClient, type Prices } from '../src/operator.js';
import { legalOptions, fenAfter } from '../src/rules.js';

const ME = 'TelarchyBot';
const T0 = new Date('2026-09-13T14:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const seq = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };

type Call = { name: string; args: unknown[] };

function fakes(opts: {
  prices?: (proposalNumber: number) => Prices;
  failPost?: boolean;
  failApprove?: boolean;
  settleFailures?: number;
  bots?: unknown[];
} = {}) {
  const calls: Call[] = [];
  let n = 0;
  let settleFails = opts.settleFailures ?? 0;
  const telarchy: TelarchyClient = {
    async setHorizon(cell) { calls.push({ name: 'setHorizon', args: [cell] }); },
    async refreshBooks() { calls.push({ name: 'refreshBooks', args: [] }); },
    async postProposal(title, description, decideBy, options) {
      calls.push({ name: 'postProposal', args: [title, description, decideBy.toISOString(), options] });
      if (opts.failPost) throw new Error('POST /proposals -> 500 boom');
      n++;
      return { id: `p${n}`, number: n, url: `https://telarchy.com/beta/chess/p/${n}` };
    },
    async readPrices(ref) {
      calls.push({ name: 'readPrices', args: [ref.id] });
      return opts.prices ? opts.prices(ref.number) : {};
    },
    async approveOption(ref, option) {
      calls.push({ name: 'approveOption', args: [ref.id, option] });
      if (opts.failApprove) throw new Error('approve -> 409 proposal_closed');
    },
    async declineProposal(ref) { calls.push({ name: 'declineProposal', args: [ref.id] }); },
    async postReading(value, when) { calls.push({ name: 'postReading', args: [value, when.toISOString()] }); },
    async settleMetric(value, when, reason) {
      calls.push({ name: 'settleMetric', args: [value, when.toISOString(), reason] });
      if (settleFails > 0) { settleFails--; throw new Error('settle -> 500'); }
    },
  };
  const lichess: LichessClient = {
    async move(gameId, uci) { calls.push({ name: 'move', args: [gameId, uci] }); },
    async acceptChallenge(id) { calls.push({ name: 'accept', args: [id] }); },
    async declineChallenge(id, reason) { calls.push({ name: 'decline', args: [id, reason] }); },
    async challenge(username, tc) { calls.push({ name: 'challenge', args: [username, tc] }); return { id: `ch-${username}` }; },
    async cancelChallenge(id) { calls.push({ name: 'cancel', args: [id] }); },
    async claimVictory(gameId) { calls.push({ name: 'claimVictory', args: [gameId] }); },
    async onlineBots() { calls.push({ name: 'onlineBots', args: [] }); return (opts.bots ?? []) as never; },
    async account() {
      calls.push({ name: 'account', args: [] });
      return { username: ME, url: 'https://lichess.org/@/TelarchyBot', rating: 1500, provisional: true, games: { played: 6, won: 0, lost: 6, drawn: 0 } };
    },
  };
  const names = () => calls.map(c => c.name);
  const of = (name: string) => calls.filter(c => c.name === name);
  return { telarchy, lichess, calls, names, of };
}

const full = (color: 'white' | 'black', over: Record<string, unknown> = {}) => ({
  id: 'g1',
  rated: true,
  clock: { initial: 1_800_000, increment: 20_000 },
  white: color === 'white' ? { id: 'telarchybot', name: ME, rating: 1500 } : { id: 'oppbot', name: 'OppBot', title: 'BOT', rating: 1520 },
  black: color === 'black' ? { id: 'telarchybot', name: ME, rating: 1500 } : { id: 'oppbot', name: 'OppBot', title: 'BOT', rating: 1520 },
  state: { moves: '', wtime: 1_800_000, btime: 1_800_000, winc: 20_000, binc: 20_000, status: 'started' },
  ...over,
});
const st = (moves: string, over: Record<string, unknown> = {}) => ({ moves, wtime: 1_800_000, btime: 1_800_000, winc: 20_000, binc: 20_000, status: 'started', ...over });

function operator(f: ReturnType<typeof fakes>, rng = seq(0), seek = true) {
  return new Operator(f.telarchy, f.lichess, rng, { username: ME, seek, workspaceId: 'ws-chess' });
}

const challenge = (over: Record<string, unknown> = {}) => ({
  id: 'c1', variant: { key: 'standard' }, rated: true,
  timeControl: { type: 'clock', limit: 1800, increment: 20 },
  challenger: { id: 'somebot', name: 'SomeBot', rating: 1900 },
  ...over,
});

describe('challenges', () => {
  it('an allowed challenge is accepted while idle', async () => {
    const f = fakes();
    await operator(f).onChallenge(challenge(), T0);
    expect(f.of('accept')).toEqual([{ name: 'accept', args: ['c1'] }]);
  });
  it('a challenge during a game is declined with later', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onChallenge(challenge({ id: 'c2' }), at(5));
    expect(f.of('decline')).toEqual([{ name: 'decline', args: ['c2', 'later'] }]);
  });
  it('a challenge the rules refuse is declined with their reason', async () => {
    const f = fakes();
    await operator(f).onChallenge(challenge({ variant: { key: 'atomic' } }), T0);
    expect(f.of('decline')).toEqual([{ name: 'decline', args: ['c1', 'variant'] }]);
  });
});

describe('a game opens its book', () => {
  it('a new game posts a reading of 50 before setting its cell, so its books never open at the last result', async () => {
    const f = fakes();
    await operator(f).onGameFull(full('black'), T0);
    expect(f.of('postReading')).toEqual([{ name: 'postReading', args: [50, T0.toISOString()] }]);
    expect(f.names().indexOf('postReading')).toBeLessThan(f.names().indexOf('setHorizon'));
  });
  it('the same game reported again posts no reading', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onGameFull(full('black'), at(30));
    expect(f.of('postReading')).toHaveLength(1);
  });
  it('the start sets the metric horizon to the cell 24 hours out and refreshes the books', async () => {
    const f = fakes();
    await operator(f).onGameFull(full('black'), T0);
    expect(f.of('setHorizon')).toEqual([{ name: 'setHorizon', args: ['until-settled'] }]);
    expect(f.names().indexOf('refreshBooks')).toBeGreaterThan(f.names().indexOf('setHorizon'));
  });
});

describe('our turn is one proposal with every legal move', () => {
  it('as white the first move posts Game 1, move 1 with the 20 legal moves and a 20-second deadline', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    const posts = f.of('postProposal');
    expect(posts).toHaveLength(1);
    const [title, description, decideBy, options] = posts[0].args as [string, string, string, Array<{ id: string; label: string }>];
    expect(title).toBe('Game 1, move 1');
    expect(options).toEqual(legalOptions(fenAfter([])));
    expect(decideBy).toBe(at(20).toISOString());
    expect(description).toContain('lichess.org/g1');
    expect(description).toContain('OppBot');
  });
  it('as black nothing is posted until the opponent has moved', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    expect(f.of('postProposal')).toHaveLength(0);
    await op.onGameState(st('e2e4'), at(3));
    expect(f.of('postProposal')).toHaveLength(1);
    expect((f.of('postProposal')[0].args[3] as unknown[]).length).toBe(20);
  });
  it('the same position reported twice never opens a second proposal', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.onGameState(st(''), at(2));
    expect(f.of('postProposal')).toHaveLength(1);
  });
  it('after the first move the window follows the clock', async () => {
    const f = fakes({ prices: () => ({ e2e4: { price: 55, lead: 1, marketId: 'm-e2e4' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    await op.onGameState(st('e2e4 e7e5', { wtime: 600_000 }), at(25));
    // 20 s increment + (600 - 120) / 30 = 36 s
    expect(f.of('postProposal')[1].args[2]).toBe(at(25 + 36).toISOString());
    expect(f.of('postProposal')[1].args[0]).toBe('Game 1, move 2');
  });
  it('a position with one legal move is played at once without a proposal', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black', { state: st('e2e4 f7f6 d1h5') }), T0);
    // After 1.e4 f6 2.Qh5+ black's only legal move is g6.
    expect(legalOptions(fenAfter(['e2e4', 'f7f6', 'd1h5']))).toEqual([{ id: 'g7g6', label: 'g6' }]);
    expect(f.of('postProposal')).toHaveLength(0);
    expect(f.of('move')).toEqual([{ name: 'move', args: ['g1', 'g7g6'] }]);
    expect(op.recentDecisions[0].kind).toBe('forced');
  });
  it('under 30 seconds on the clock a random legal move is played at once, recorded as clock', async () => {
    const f = fakes();
    const op = operator(f, seq(0));
    await op.onGameFull(full('black'), T0);
    await op.onGameState(st('e2e4', { btime: 25_000 }), at(3));
    expect(f.of('postProposal')).toHaveLength(0);
    const legal = legalOptions(fenAfter(['e2e4']));
    expect(f.of('move')).toEqual([{ name: 'move', args: ['g1', legal[0].id] }]);
    expect(op.recentDecisions[0].kind).toBe('clock');
  });
  it('when posting fails a random legal move is played at once, recorded as undecided with the error', async () => {
    const f = fakes({ failPost: true });
    const op = operator(f, seq(0.999));
    await op.onGameFull(full('white'), T0);
    const legal = legalOptions(fenAfter([]));
    expect(f.of('move')).toEqual([{ name: 'move', args: ['g1', legal[legal.length - 1].id] }]);
    expect(op.recentDecisions[0].kind).toBe('undecided');
    expect(op.recentDecisions[0].undecidedReason).toMatch(/500 boom/);
  });
});

describe('the market ids are published at once', () => {
  it('the first price read happens at the first tick after posting, not five seconds later', async () => {
    const f = fakes({ prices: () => ({ e2e4: { price: 50, lead: 0, marketId: 'm-e2e4' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(1));
    expect(f.of('readPrices')).toHaveLength(1);
    expect(op.publicState(at(1)).open?.options.find(o => o.id === 'e2e4')?.marketId).toBe('m-e2e4');
    await op.tick(at(3));
    expect(f.of('readPrices')).toHaveLength(1);
    await op.tick(at(6));
    expect(f.of('readPrices')).toHaveLength(2);
  });
});

describe('two seconds before the deadline the market decides', () => {
  it('nothing is decided before second 18 of a 20-second window', async () => {
    const f = fakes({ prices: () => ({ e2e4: { price: 60, lead: 5, marketId: 'm' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(17));
    expect(f.of('approveOption')).toHaveLength(0);
    expect(f.of('move')).toHaveLength(0);
  });
  it('the highest priced option is approved and that move is played', async () => {
    const f = fakes({ prices: () => ({ e2e4: { price: 52, lead: -3, marketId: 'm1' }, d2d4: { price: 55, lead: 3, marketId: 'm2' }, g1f3: { price: 50, lead: -5, marketId: 'm3' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    expect(f.of('approveOption')).toEqual([{ name: 'approveOption', args: ['p1', 'd2d4'] }]);
    expect(f.of('move')).toEqual([{ name: 'move', args: ['g1', 'd2d4'] }]);
    expect(f.of('declineProposal')).toHaveLength(0);
    expect(op.recentDecisions[0]).toMatchObject({ game: 1, move: 1, chosen: 'd2d4', san: 'd4', price: 55, tied: 1, kind: 'market', undecidedReason: null });
  });
  it('a tie is random among the tied', async () => {
    const f = fakes({ prices: () => ({ a2a3: { price: 50, lead: 0, marketId: 'x' }, h2h4: { price: 50, lead: 0, marketId: 'y' }, e2e4: { price: 40, lead: -10, marketId: 'z' } }) });
    const op = operator(f, seq(0.9));
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    expect(f.of('move')[0].args[1]).toBe('h2h4');
    expect(op.recentDecisions[0].tied).toBe(2);
  });
  it('no price at all declines with refund and plays a random legal move, undecided', async () => {
    const f = fakes({ prices: () => ({}) });
    const op = operator(f, seq(0));
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    expect(f.of('approveOption')).toHaveLength(0);
    expect(f.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    expect(f.of('move')[0].args[1]).toBe(legalOptions(fenAfter([]))[0].id);
    expect(op.recentDecisions[0].kind).toBe('undecided');
    expect(op.recentDecisions[0].undecidedReason).toMatch(/no option has a price/);
  });
  it('a refused approval declines with refund and plays a random legal move, undecided, with the error', async () => {
    const f = fakes({ failApprove: true, prices: () => ({ e2e4: { price: 60, lead: 1, marketId: 'm' } }) });
    const op = operator(f, seq(0));
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    expect(f.of('declineProposal')).toHaveLength(1);
    expect(f.of('move')).toHaveLength(1);
    expect(op.recentDecisions[0].kind).toBe('undecided');
    expect(op.recentDecisions[0].undecidedReason).toMatch(/proposal_closed/);
  });
  it('prices read during the window stand in when the last read fails', async () => {
    let reads = 0;
    const f = fakes({ prices: () => { reads++; if (reads > 1) throw new Error('read -> timeout'); return { h2h3: { price: 70, lead: 9, marketId: 'm' } }; } });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(5));
    await op.tick(at(18));
    expect(f.of('move')[0].args[1]).toBe('h2h3');
  });
  it('a tick after the decision never decides twice', async () => {
    const f = fakes({ prices: () => ({ e2e4: { price: 60, lead: 1, marketId: 'm' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    await op.tick(at(19));
    expect(f.of('move')).toHaveLength(1);
    expect(f.of('approveOption')).toHaveLength(1);
  });
});

describe('the end settles the game, before anything else starts', () => {
  it('a win posts 100 and settles the metric at 100 with the reason', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onGameState(st('f2f3 e7e5 g2g4 d8h4', { status: 'mate', winner: 'black' }), at(90));
    expect(f.of('postReading').at(-1)).toEqual({ name: 'postReading', args: [100, at(90).toISOString()] });
    expect(f.of('settleMetric')).toEqual([{ name: 'settleMetric', args: [100, at(90).toISOString(), 'Game 1 vs OppBot: win'] }]);
    expect(op.publicState(at(91)).phase).toBe('seeking');
  });
  it('a loss is 0 and a draw 50', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.onGameState(st('', { status: 'resign', winner: 'black' }), at(30));
    expect(f.of('settleMetric')[0].args[0]).toBe(0);
    const g = fakes();
    const op2 = operator(g);
    await op2.onGameFull(full('black'), T0);
    await op2.onGameState(st('e2e4', { status: 'draw' }), at(30));
    expect(g.of('settleMetric')[0].args).toEqual([50, at(30).toISOString(), 'Game 1 vs OppBot: draw']);
  });
  it('a game that ends while our proposal is open declines it and plays nothing', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.onGameState(st('', { status: 'aborted' }), at(10));
    await op.tick(at(18));
    expect(f.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    expect(f.of('move')).toHaveLength(0);
  });
  it('an aborted game settles nothing', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onGameState(st('', { status: 'aborted' }), at(40));
    expect(f.of('settleMetric')).toHaveLength(0);
    expect(f.of('postReading').map(c => c.args[0])).toEqual([50]); // only the game's opening reading
  });
  it('a refused settlement blocks every new game and is retried each minute until it goes through', async () => {
    const f = fakes({ settleFailures: 2 });
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onGameState(st('e2e4', { status: 'resign', winner: 'white' }), at(60));
    expect(op.publicState(at(61)).phase).toBe('settling');
    await op.onChallenge(challenge({ id: 'c9' }), at(70));
    expect(f.of('decline')).toEqual([{ name: 'decline', args: ['c9', 'later'] }]);
    await op.tick(at(100));
    expect(f.of('settleMetric')).toHaveLength(1); // not before a minute has passed
    await op.tick(at(121));
    expect(f.of('settleMetric')).toHaveLength(2);
    await op.tick(at(182));
    expect(f.of('settleMetric')).toHaveLength(3);
    expect(op.publicState(at(183)).phase).toBe('seeking');
    await op.onChallenge(challenge({ id: 'c10' }), at(190));
    expect(f.of('accept')).toEqual([{ name: 'accept', args: ['c10'] }]);
  });
});

describe('seeking a bot', () => {
  const bot = (username: string, rating: number) => ({ id: username.toLowerCase(), username, perfs: { classical: { rating, games: 50, prov: false } } });
  it('after two idle minutes one bot is challenged at 30+20 rated, not before', async () => {
    const f = fakes({ bots: [bot('Alpha', 1600)] });
    const op = operator(f);
    await op.tick(T0);
    await op.tick(at(119));
    expect(f.of('challenge')).toHaveLength(0);
    await op.tick(at(120));
    expect(f.of('challenge')).toEqual([{ name: 'challenge', args: ['alpha', { limit: 1800, increment: 20, rated: true }] }]);
    await op.tick(at(125));
    expect(f.of('challenge')).toHaveLength(1);
  });
  it('an unanswered challenge is cancelled after 60 seconds and the next is tried 30 seconds later, a different bot', async () => {
    const f = fakes({ bots: [bot('Alpha', 1600), bot('Beta', 1400)] });
    const op = operator(f, seq(0));
    await op.tick(T0);
    await op.tick(at(120));
    await op.tick(at(181));
    expect(f.of('cancel')).toEqual([{ name: 'cancel', args: ['ch-alpha'] }]);
    await op.tick(at(200));
    expect(f.of('challenge')).toHaveLength(1);
    await op.tick(at(212));
    expect(f.of('challenge')).toHaveLength(2);
    expect(f.of('challenge')[1].args[0]).toBe('beta');
  });
  it('a declined challenge moves on 30 seconds later', async () => {
    const f = fakes({ bots: [bot('Alpha', 1600), bot('Beta', 1400)] });
    const op = operator(f, seq(0));
    await op.tick(T0);
    await op.tick(at(120));
    op.onChallengeGone('ch-alpha', at(125));
    await op.tick(at(150));
    expect(f.of('challenge')).toHaveLength(1);
    await op.tick(at(156));
    expect(f.of('challenge')).toHaveLength(2);
  });
  it('Rookie searched in silence for 26 minutes (2026-09-14): an empty search is logged with the rating and the band it tried', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // A bot no step can take (its own rating is provisional), so the search is empty under any rule.
      const f = fakes({ bots: [{ id: 'provbot', username: 'ProvBot', perfs: { classical: { rating: 1500, games: 50, prov: true } } }] });
      const op = operator(f);
      await op.tick(T0);
      await op.tick(at(120));
      expect(f.of('challenge')).toHaveLength(0);
      const lines = errors.mock.calls.map(c => String(c[0]));
      expect(lines.some(l => /^seek: nobody to challenge at rating \d+\??, within 400 of it, the last opponent excluded$/.test(l))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });
  it('with seeking off nobody is challenged', async () => {
    const f = fakes({ bots: [bot('Alpha', 1600)] });
    const op = operator(f, seq(0), false);
    await op.tick(T0);
    await op.tick(at(600));
    expect(f.of('challenge')).toHaveLength(0);
  });
  it('no challenge is sent while a game runs', async () => {
    const f = fakes({ bots: [bot('Alpha', 1600)] });
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.tick(at(600));
    expect(f.of('challenge')).toHaveLength(0);
  });
});

describe('a restart', () => {
  it('declines a proposal left open and posts a fresh one when the stream says it is our turn', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    const saved = JSON.parse(JSON.stringify(op.toJSON()));
    const g = fakes();
    const back = Operator.fromJSON(g.telarchy, g.lichess, seq(0), { username: ME, seek: true, workspaceId: 'ws-chess' }, saved);
    await back.resume(at(30));
    expect(g.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    await back.onGameFull(full('white'), at(31));
    expect(g.of('postProposal')).toHaveLength(1);
    expect(g.of('setHorizon')).toHaveLength(0); // same game, its book already exists
    expect(back.publicState(at(32)).game?.number).toBe(1);
  });
});

describe('the feed', () => {
  it('while our move is open /state carries every option with its price, lead and market id', async () => {
    const f = fakes({ prices: () => ({ e2e4: { price: 55, lead: 2, marketId: 'm-e2e4' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(5));
    const s = op.publicState(at(6));
    expect(s.schema).toBe(1);
    expect(s.phase).toBe('our-move');
    expect(s.open?.tradeable).toBe(true);
    expect(s.open?.options).toHaveLength(20);
    expect(s.open?.options.find(o => o.id === 'e2e4')).toMatchObject({ san: 'e4', price: 55, lead: 2, marketId: 'm-e2e4' });
    expect(s.open?.options.find(o => o.id === 'a2a3')).toMatchObject({ price: null, reason: 'no price' });
    expect(s.game).toMatchObject({ number: 1, id: 'g1', url: 'https://lichess.org/g1', color: 'white', opponent: { name: 'OppBot', rating: 1520 } });
    expect(s.cell).toBe('until-settled');
    expect(s.cellEndsAt).toBeNull();
    expect(s.trade).toMatchObject({ endpoint: 'POST /api/predictions/trade', workspaceId: 'ws-chess', rangeMin: 0, rangeMax: 100 });
    expect(s.rules.windowSeconds).toEqual({ min: 15, max: 50, firstMove: 20 });
  });
  it('before the first poll an option says not polled yet', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    expect(op.publicState(at(1)).open?.options[0]).toMatchObject({ price: null, reason: 'not polled yet' });
  });
  it('the opponent to move is their-move, and past the deadline an open move is not tradeable', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    expect(op.publicState(at(1)).phase).toBe('their-move');
    const g = fakes();
    const op2 = operator(g);
    await op2.onGameFull(full('white'), T0);
    expect(op2.publicState(at(21)).open?.tradeable).toBe(false);
  });
  it('recent decisions are newest first and hold at most 20', async () => {
    const f = fakes({ prices: () => ({}) });
    const op = operator(f, seq(0));
    await op.onGameFull(full('white'), T0);
    let moves: string[] = [];
    let t = 0;
    for (let i = 0; i < 22; i++) {
      await op.tick(at(t + 55)); // past the deadline of the first (20 s) and later (50 s) windows
      moves = [...moves, String(f.of('move').at(-1)!.args[1])];
      const reply = legalOptions(fenAfter(moves))[0].id;
      moves = [...moves, reply];
      t += 60;
      await op.onGameState(st(moves.join(' ')), at(t));
    }
    expect(op.recentDecisions).toHaveLength(20);
    expect(op.recentDecisions[0].move).toBeGreaterThan(op.recentDecisions[1].move);
  });
});

describe('the record of a game', () => {
  it('history lists every ply with who played it, in UCI and SAN, and lays our decisions on our plies', async () => {
    const f = fakes({ prices: () => ({ d2d4: { price: 58, lead: 3, marketId: 'm' } }) });
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    await op.onGameState(st('d2d4'), at(19));
    await op.onGameState(st('d2d4 g8f6'), at(30));
    const h = op.history('current')!;
    expect(h.game).toMatchObject({ number: 1, id: 'g1' });
    expect(h.plies).toEqual([
      { ply: 1, at: at(19).toISOString(), by: 'us', uci: 'd2d4', san: 'd4', fen: fenAfter(['d2d4']), kind: 'market', price: 58, tied: 1 },
      { ply: 2, at: at(30).toISOString(), by: 'them', uci: 'g8f6', san: 'Nf6', fen: fenAfter(['d2d4', 'g8f6']) },
    ]);
    expect(op.history(1)).toEqual(h);
    expect(op.history(2)).toBeNull();
  });
  it('a restart keeps the record', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onGameState(st('e2e4'), at(3));
    const back = Operator.fromJSON(f.telarchy, f.lichess, seq(0), { username: ME, seek: true, workspaceId: 'ws-chess' }, JSON.parse(JSON.stringify(op.toJSON())));
    expect(back.history('current')!.plies).toHaveLength(1);
  });
});

describe('an opponent who leaves', () => {
  it('the win is claimed once Lichess says it may be', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onOpponentGone({ gone: true, claimWinInSeconds: 12 }, at(10));
    expect(f.of('claimVictory')).toHaveLength(0);
    await op.onOpponentGone({ gone: true, claimWinInSeconds: 0 }, at(22));
    expect(f.of('claimVictory')).toEqual([{ name: 'claimVictory', args: ['g1'] }]);
  });
  it('an opponent who comes back is not claimed against', async () => {
    const f = fakes();
    const op = operator(f);
    await op.onGameFull(full('black'), T0);
    await op.onOpponentGone({ gone: false }, at(10));
    expect(f.of('claimVictory')).toHaveLength(0);
  });
});

describe("the player's record", () => {
  it('is read once a minute and published on /state', async () => {
    const f = fakes();
    const op = operator(f, seq(0), false);
    expect(op.publicState(T0).player).toBeNull();
    await op.tick(T0);
    expect(f.of('account')).toHaveLength(1);
    expect(op.publicState(at(1)).player).toEqual({
      username: ME, url: 'https://lichess.org/@/TelarchyBot', rating: 1500, provisional: true, games: { played: 6, won: 0, lost: 6, drawn: 0 },
    });
    await op.tick(at(30));
    expect(f.of('account')).toHaveLength(1);
    await op.tick(at(61));
    expect(f.of('account')).toHaveLength(2);
  });

  it('is read again right after a game ends, so the record moves with the result', async () => {
    const f = fakes();
    const op = operator(f, seq(0), false);
    await op.tick(T0);
    await op.onGameFull(full('black'), at(5));
    await op.onGameState(st('e2e4', { status: 'resign', winner: 'white' }), at(20));
    await op.tick(at(21));
    expect(f.of('account')).toHaveLength(2);
  });

  it('a failed read keeps the last record', async () => {
    const f = fakes();
    const op = operator(f, seq(0), false);
    await op.tick(T0);
    (f.lichess as { account: () => Promise<unknown> }).account = async () => { throw new Error('lichess 429'); };
    await op.tick(at(61));
    expect(op.publicState(at(62)).player?.games.played).toBe(6);
  });
});


describe('an old move never stays pending because its failed decline was forgotten', () => {
  it('persists the failed closure, retries after restart, and never approves the fallback', async () => {
    const f = fakes();
    f.telarchy.declineProposal = vi.fn().mockRejectedValue(new Error('404'));
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    expect(f.of('move')).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(op.toJSON()));
    expect(saved.pendingDeclines).toHaveLength(1);
    const next = fakes();
    const back = Operator.fromJSON(next.telarchy, next.lichess, seq(0), { username: ME, seek: true, workspaceId: 'ws-chess' }, saved);
    await back.tick(at(77));
    expect(next.of('declineProposal')).toHaveLength(0);
    await Promise.all([back.tick(at(78)), back.tick(at(78))]);
    expect(next.of('declineProposal')).toHaveLength(1);
    await back.tick(at(139));
    expect(next.of('declineProposal')).toHaveLength(1);
    expect(back.toJSON().pendingDeclines).toEqual([]);
    expect(next.of('approveOption')).toHaveLength(0);
  });

  it('does not settle or accept another game until abandoned proposals close', async () => {
    const f = fakes();
    f.telarchy.declineProposal = vi.fn().mockRejectedValue(new Error('offline'));
    const op = operator(f);
    await op.onGameFull(full('white'), T0);
    await op.tick(at(18));
    await op.onGameState(st('a2a3', { status: 'mate', winner: 'black' }), at(20));
    expect(f.of('settleMetric')).toHaveLength(0);
    await op.onChallenge(challenge(), at(100));
    expect(f.of('accept')).toHaveLength(0);
    await op.tick(at(200));
    expect(f.of('challenge')).toHaveLength(0);
    f.telarchy.declineProposal = vi.fn().mockResolvedValue(undefined);
    await op.tick(at(260));
    expect(f.of('settleMetric')).toHaveLength(1);
  });
});

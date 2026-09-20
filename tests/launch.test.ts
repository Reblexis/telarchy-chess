// docs/chess.md "The launch gate", driven with fake clients and an explicit
// clock: written before the code.
import { describe, it, expect } from 'vitest';
import { Operator, type TelarchyClient, type LichessClient } from '../src/operator.js';
import { launchBudgetFits } from '../src/rules.js';

const ME = 'TelarchyRookie';
const T0 = new Date('2026-09-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const GATE = { wall: 2500, depth: 1000 };
const BOT = { id: 'oppbot', username: 'OppBot', title: 'BOT', perfs: { classical: { rating: 1520, games: 200, prov: false } } };

type Call = { name: string; args: unknown[] };

function fakes(o: { failPost?: number; failFund?: number; failWall?: number; failApprove?: number } = {}) {
  const calls: Call[] = [];
  const fail = { post: o.failPost ?? 0, fund: o.failFund ?? 0, wall: o.failWall ?? 0, approve: o.failApprove ?? 0 };
  const order = { filled: 0, remaining: GATE.wall, status: 'open' };
  const book = { price: 50 as number | null, fail: false };
  let n = 0;
  const telarchy: TelarchyClient = {
    async setHorizon(cell, proposalCredits) { calls.push({ name: 'setHorizon', args: proposalCredits === undefined ? [cell] : [cell, proposalCredits] }); },
    async refreshBooks() { calls.push({ name: 'refreshBooks', args: [] }); },
    async postProposal(title) { calls.push({ name: 'postProposal', args: [title] }); n++; return { id: `p${n}`, number: n, url: `u/p/${n}` }; },
    async readPrices() { return {}; },
    async approveOption(ref, option) { calls.push({ name: 'approveOption', args: [ref.id, option] }); },
    async declineProposal(ref) { calls.push({ name: 'declineProposal', args: [ref.id] }); },
    async setOpensAt(value) { calls.push({ name: 'setOpensAt', args: [value] }); },
    async postReading() {},
    async settleMetric(value) { calls.push({ name: 'settleMetric', args: [value] }); },
    async postQuestion(title, description, decideBy) {
      calls.push({ name: 'postQuestion', args: [title, decideBy.toISOString()] });
      if (fail.post > 0) { fail.post--; throw new Error('POST /proposals -> 500'); }
      n++;
      order.filled = 0; order.remaining = GATE.wall; order.status = 'open'; book.price = 50;
      return { id: `p${n}`, number: n, url: `u/p/${n}` };
    },
    async approvedBook(ref) { calls.push({ name: 'approvedBook', args: [ref.id] }); return `m-${ref.id}`; },
    async fundBook(marketId, amount) {
      calls.push({ name: 'fundBook', args: [marketId, amount] });
      if (fail.fund > 0) { fail.fund--; throw new Error('liquidity -> 400'); }
    },
    async placeWall(marketId, budget) {
      calls.push({ name: 'placeWall', args: [marketId, budget] });
      if (fail.wall > 0) { fail.wall--; throw new Error('limit-orders -> 403'); }
      return `o-${marketId}`;
    },
    async bookPrice(ref) {
      calls.push({ name: 'bookPrice', args: [ref.id] });
      if (book.fail) throw new Error('GET /proposals -> 502');
      return book.price;
    },
    async readOrder(id) { calls.push({ name: 'readOrder', args: [id] }); return { ...order }; },
    async approveProposal(ref) {
      calls.push({ name: 'approveProposal', args: [ref.id] });
      if (fail.approve > 0) { fail.approve--; throw new Error('approve -> 500'); }
    },
  };
  const lichess: LichessClient = {
    async move() {},
    async acceptChallenge(id) { calls.push({ name: 'accept', args: [id] }); },
    async declineChallenge(id, reason) { calls.push({ name: 'decline', args: [id, reason] }); },
    async challenge(username, tc) { calls.push({ name: 'challenge', args: [username, tc] }); return { id: `ch-${username}` }; },
    async cancelChallenge() {},
    async claimVictory() {},
    async onlineBots() { return [BOT] as never; },
    async account() { return { username: ME, url: 'x', rating: 1500, provisional: false, games: { played: 6, won: 0, lost: 6, drawn: 0 } }; },
  };
  const of = (name: string) => calls.filter(c => c.name === name);
  const fill = (filled = GATE.wall, price: number | null = filled >= GATE.wall ? 56.2 : 50) => { order.filled = filled; order.remaining = GATE.wall - filled; order.status = order.remaining === 0 ? 'filled' : 'open'; book.price = price; };
  return { telarchy, lichess, calls, of, fill, book, names: () => calls.map(c => c.name) };
}

const opts = (over: Record<string, unknown> = {}) => ({ username: ME, seek: true, workspaceId: 'ws', launch: GATE, ...over });
const operator = (f: ReturnType<typeof fakes>, over: Record<string, unknown> = {}) => new Operator(f.telarchy, f.lichess, () => 0, opts(over) as never);

const full = (id = 'g1', status = 'started') => ({
  id, rated: false, clock: { initial: 1_800_000, increment: 20_000 },
  white: { id: 'oppbot', name: 'OppBot', title: 'BOT', rating: 1520 },
  black: { id: 'telarchyrookie', name: ME, rating: 1500 },
  state: { moves: '', wtime: 1_800_000, btime: 1_800_000, winc: 20_000, binc: 20_000, status },
});
const ended = (status: string, winner?: 'white' | 'black') => ({ moves: 'e2e4', wtime: 1, btime: 1, winc: 0, binc: 0, status, winner });
const challenge = (id = 'c1') => ({ id, variant: { key: 'standard' }, rated: false, timeControl: { type: 'clock', limit: 1800, increment: 20 }, challenger: { id: 'somebot', name: 'SomeBot', rating: 1900 } });

describe('the owner\'s money on a game never exceeds the wall', () => {
  it('the depth, the main book and 100 chosen move books fit inside the wall', () => {
    expect(launchBudgetFits(2500, 1000)).toBe(true);
    expect(launchBudgetFits(2010, 1000)).toBe(true);
  });
  it('one credit over is refused', () => {
    expect(launchBudgetFits(2009, 1000)).toBe(false);
    expect(launchBudgetFits(2500, 1491)).toBe(false);
  });
  it('a wall or a depth that is zero, negative or not a number is refused', () => {
    for (const [w, d] of [[0, 0], [-1, 10], [2500, 0], [2500, -5], [NaN, 10], [2500, NaN], [Infinity, 10]]) expect(launchBudgetFits(w, d)).toBe(false);
  });
});

describe('the question', () => {
  it('with the gate off nothing is posted and the idle rule seeks as before', async () => {
    const f = fakes();
    const op = operator(f, { launch: undefined });
    await op.tick(T0); await op.tick(at(121));
    expect(f.of('postQuestion')).toEqual([]);
    expect(f.of('challenge')).toHaveLength(1);
  });
  it('idle with the gate on: branches unfunded, question posted, approved book funded, the order rested, in that order', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    expect(f.calls.filter(c => ['setOpensAt', 'setHorizon', 'postQuestion', 'approvedBook', 'fundBook', 'placeWall'].includes(c.name))).toEqual([
      { name: 'setOpensAt', args: [50] },
      { name: 'setHorizon', args: ['until-settled', 0] },
      { name: 'postQuestion', args: ['Start game 1?', at(3600).toISOString()] },
      { name: 'approvedBook', args: ['p1'] },
      { name: 'fundBook', args: ['m-p1', 1000] },
      { name: 'placeWall', args: ['m-p1', 2500] },
    ]);
  });
  it('is posted once, however many ticks pass', async () => {
    const f = fakes();
    const op = operator(f);
    for (let s = 0; s < 600; s += 5) await op.tick(at(s));
    expect(f.of('postQuestion')).toHaveLength(1);
  });
  it('the feed says launch and carries the question, the book, the wall and what is filled', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    f.fill(400);
    await op.tick(at(5));
    const s = op.publicState(at(6));
    expect(s.phase).toBe('launch');
    expect(s.launch).toEqual({ proposal: { id: 'p1', number: 1, url: 'u/p/1' }, marketId: 'm-p1', wall: 2500, filled: 400, postedAt: T0.toISOString() });
  });
  it('the feed carries launch null with the gate off', async () => {
    const f = fakes();
    const op = operator(f, { launch: undefined });
    await op.tick(T0);
    expect(op.publicState(T0).launch).toBeNull();
    expect(op.publicState(T0).phase).toBe('seeking');
  });
  it('is numbered after the last game on the floor', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    await op.onGameFull(full('g1'), at(10));
    await op.onGameState(ended('mate', 'white'), at(900));
    await op.tick(at(901));
    expect(f.of('postQuestion').map(c => c.args[0])).toEqual(['Start game 1?', 'Start game 2?']);
  });
  it('is not posted while a settlement has not gone through', async () => {
    const f = fakes();
    f.telarchy.settleMetric = async () => { throw new Error('settle -> 500'); };
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    await op.onGameFull(full('g1'), at(10));
    await op.onGameState(ended('mate', 'white'), at(900));
    await op.tick(at(905));
    expect(f.of('postQuestion')).toHaveLength(1);
  });
  it('is not posted while the search is paused', async () => {
    const f = fakes();
    const op = operator(f);
    op.paused = { since: T0.toISOString(), reason: 'no price' };
    f.telarchy.refreshBooks = async () => { throw new Error('down'); };
    await op.tick(T0); await op.tick(at(30));
    expect(f.of('postQuestion')).toEqual([]);
  });
  it('is not posted during a game', async () => {
    const f = fakes();
    const op = operator(f, { launch: undefined });
    await op.onGameFull(full('g1'), T0);
    const gated = Operator.fromJSON(f.telarchy, f.lichess, () => 0, opts() as never, JSON.parse(JSON.stringify(op.toJSON())));
    await gated.tick(at(5));
    expect(f.of('postQuestion')).toEqual([]);
  });
});

describe('the question\'s book opens at 50, where the wall rests', () => {
  it('a refused opening value posts no question and is tried again a minute later', async () => {
    const f = fakes();
    let fails = 1;
    f.telarchy.setOpensAt = async () => { if (fails-- > 0) throw new Error('PUT /metrics -> 500'); };
    const op = operator(f);
    await op.tick(T0); await op.tick(at(30));
    expect(f.of('postQuestion')).toEqual([]);
    await op.tick(at(60));
    expect(f.of('postQuestion')).toHaveLength(1);
  });
});

describe('while the wall stands', () => {
  it('nobody is challenged, however long the player idles', async () => {
    const f = fakes();
    const op = operator(f);
    for (let s = 0; s < 1200; s += 5) await op.tick(at(s));
    expect(f.of('challenge')).toEqual([]);
  });
  it('an incoming challenge is declined with later', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    await op.onChallenge(challenge(), at(40));
    expect(f.of('decline')).toEqual([{ name: 'decline', args: ['c1', 'later'] }]);
    expect(f.of('accept')).toEqual([]);
  });
  it('a challenge arriving before the first question is posted is declined too', async () => {
    const f = fakes();
    await operator(f).onChallenge(challenge(), T0);
    expect(f.of('accept')).toEqual([]);
  });
  it('the order is read every 5 seconds, not faster', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    for (let s = 1; s <= 10; s++) await op.tick(at(s));
    expect(f.of('readOrder')).toHaveLength(2);
  });
  it('a part filled order launches nothing', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(2400); await op.tick(at(5)); await op.tick(at(200));
    expect(f.of('approveProposal')).toEqual([]);
    expect(f.of('challenge')).toEqual([]);
  });
});

describe('the launch', () => {
  it('a filled order approves the question and a game is sought at once', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    expect(f.of('approveProposal')).toEqual([{ name: 'approveProposal', args: ['p1'] }]);
    await op.tick(at(6));
    expect(f.of('challenge')).toHaveLength(1);
    expect(op.publicState(at(6)).launch).toBeNull();
    expect(op.publicState(at(6)).phase).toBe('seeking');
  });
  it('THE GAME STARTS ONCE THE BOOK SAYS MORE THAN 50: a hair above launches', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(2500, 50.01); await op.tick(at(5));
    expect(f.of('approveProposal')).toHaveLength(1);
  });
  it('exactly 50 launches nothing, however much of the wall is spent', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(2500, 50); await op.tick(at(5)); await op.tick(at(10));
    expect(f.of('approveProposal')).toEqual([]);
    expect(op.publicState(at(11)).phase).toBe('launch');
  });
  it('a wall spent and the price sold back under 50 before the read launches nothing', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(2500, 41); await op.tick(at(5));
    expect(f.of('approveProposal')).toEqual([]);
  });
  it('a book opened under 50 and bought up towards it launches nothing until it is over', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(0, 25); await op.tick(at(5)); f.fill(900, 50); await op.tick(at(10));
    expect(f.of('approveProposal')).toEqual([]);
    f.fill(2500, 53); await op.tick(at(15));
    expect(f.of('approveProposal')).toHaveLength(1);
  });
  it('a price that cannot be read, or is missing, launches nothing', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(2500, null); await op.tick(at(5));
    f.book.fail = true; await op.tick(at(10));
    expect(f.of('approveProposal')).toEqual([]);
    expect(op.publicState(at(11)).phase).toBe('launch');
  });
  it('the feed still says how much of the wall is spent', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(1200); await op.tick(at(5));
    expect(op.publicState(at(6)).launch?.filled).toBe(1200);
  });
  it('a refused approval is retried at the next read and nothing is sought meanwhile', async () => {
    const f = fakes({ failApprove: 1 });
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5)); await op.tick(at(6));
    expect(f.of('challenge')).toEqual([]);
    await op.tick(at(10)); await op.tick(at(11));
    expect(f.of('approveProposal')).toHaveLength(2);
    expect(f.of('challenge')).toHaveLength(1);
  });
  it('once launched an incoming challenge is accepted', async () => {
    const f = fakes();
    const op = operator(f, { seek: false });
    await op.tick(T0); f.fill(); await op.tick(at(5));
    await op.onChallenge(challenge(), at(40));
    expect(f.of('accept')).toHaveLength(1);
  });
  it('the game opens its move books at their own depth again', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    await op.onGameFull(full('g1'), at(10));
    expect(f.of('setHorizon').at(-1)).toEqual({ name: 'setHorizon', args: ['until-settled'] });
  });
  it('a launched game that Lichess aborts is still owed: no new question, the player seeks again', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    await op.onGameFull(full('g1'), at(10));
    await op.onGameState(ended('aborted'), at(40));
    for (let s = 45; s < 400; s += 5) await op.tick(at(s));
    expect(f.of('postQuestion')).toHaveLength(1);
    expect(f.of('challenge').length).toBeGreaterThan(0);
  });
  it('a game that ends with a result uses the launch up: the next game waits for its own question', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    await op.onGameFull(full('g1'), at(10));
    await op.onGameState(ended('mate', 'white'), at(900));
    const before = f.of('challenge').length;
    for (let s = 901; s < 1500; s += 5) await op.tick(at(s));
    expect(f.of('postQuestion')).toHaveLength(2);
    expect(f.of('challenge')).toHaveLength(before);
    await op.onChallenge(challenge('c9'), at(1501));
    expect(f.of('decline').at(-1)).toEqual({ name: 'decline', args: ['c9', 'later'] });
  });
});

describe('failures', () => {
  it('a question that cannot be posted is tried again a minute later, not sooner', async () => {
    const f = fakes({ failPost: 1 });
    const op = operator(f);
    await op.tick(T0); await op.tick(at(30)); await op.tick(at(59));
    expect(f.of('postQuestion')).toHaveLength(1);
    await op.tick(at(60));
    expect(f.of('postQuestion')).toHaveLength(2);
    expect(op.publicState(at(61)).phase).toBe('launch');
  });
  it('a book that cannot be funded declines the question with refund and posts again a minute later', async () => {
    const f = fakes({ failFund: 1 });
    const op = operator(f);
    await op.tick(T0);
    expect(f.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    expect(f.of('placeWall')).toEqual([]);
    await op.tick(at(30));
    expect(f.of('postQuestion')).toHaveLength(1);
    await op.tick(at(61));
    expect(f.of('postQuestion')).toHaveLength(2);
    expect(f.of('placeWall')).toEqual([{ name: 'placeWall', args: ['m-p2', 2500] }]);
  });
  it('a refused order declines the question with refund and posts again a minute later', async () => {
    const f = fakes({ failWall: 1 });
    const op = operator(f);
    await op.tick(T0);
    expect(f.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    await op.tick(at(61));
    expect(f.of('postQuestion')).toHaveLength(2);
  });
  it('A QUESTION NOT APPROVED WITHIN THE HOUR is declined with refund and posted again at once, for another hour', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    f.fill(1200);
    await op.tick(at(3600 - 61));
    expect(f.of('declineProposal')).toEqual([]);
    await op.tick(at(3600 - 60));
    expect(f.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    expect(f.of('approveProposal')).toEqual([]);
    await op.tick(at(3600 - 59));
    expect(f.of('postQuestion').map(c => c.args)).toEqual([
      ['Start game 1?', at(3600).toISOString()],
      ['Start game 1?', at(3600 - 59 + 3600).toISOString()],
    ]);
    expect(op.publicState(at(3600)).launch?.filled).toBe(0);
  });
  it('it is reposted hour after hour for as long as nobody approves', async () => {
    const f = fakes();
    const op = operator(f);
    for (let s = 0; s <= 5 * 3600; s += 5) await op.tick(at(s));
    expect(f.of('postQuestion').length).toBe(6);
    expect(f.of('declineProposal').length).toBe(5);
    expect(f.of('challenge')).toEqual([]);
  });
  it('a game that starts while the question is open declines the question with refund', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    await op.onGameFull(full('g1'), at(20));
    expect(f.of('declineProposal')).toEqual([{ name: 'declineProposal', args: ['p1'] }]);
    expect(op.publicState(at(21)).launch).toBeNull();
  });
  it('an order that cannot be read keeps the question open and launches nothing', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    f.telarchy.readOrder = async () => { throw new Error('GET limit-orders -> 502'); };
    await op.tick(at(5)); await op.tick(at(10));
    expect(f.of('approveProposal')).toEqual([]);
    expect(op.publicState(at(11)).phase).toBe('launch');
  });
});

describe('a restart', () => {
  const again = (f: ReturnType<typeof fakes>, op: Operator) => Operator.fromJSON(f.telarchy, f.lichess, () => 0, opts() as never, JSON.parse(JSON.stringify(op.toJSON())));
  it('keeps the open question: it is neither declined nor posted twice', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0);
    const op2 = again(f, op);
    await op2.resume(at(30)); await op2.tick(at(31));
    expect(f.of('postQuestion')).toHaveLength(1);
    expect(f.of('declineProposal')).toEqual([]);
    f.fill(); await op2.tick(at(40));
    expect(f.of('approveProposal')).toEqual([{ name: 'approveProposal', args: ['p1'] }]);
  });
  it('keeps a paid, unplayed launch: no second question', async () => {
    const f = fakes();
    const op = operator(f);
    await op.tick(T0); f.fill(); await op.tick(at(5));
    const op2 = again(f, op);
    await op2.tick(at(30)); await op2.tick(at(200));
    expect(f.of('postQuestion')).toHaveLength(1);
    expect(f.of('challenge').length).toBeGreaterThan(0);
  });
});

describe('casual games', () => {
  it('the player challenges rated by default', async () => {
    const f = fakes();
    const op = operator(f, { launch: undefined });
    await op.tick(T0); await op.tick(at(121));
    expect((f.of('challenge')[0].args[1] as { rated: boolean }).rated).toBe(true);
  });
  it('with rated off the challenge is casual, same clock', async () => {
    const f = fakes();
    const op = operator(f, { launch: undefined, rated: false });
    await op.tick(T0); await op.tick(at(121));
    expect(f.of('challenge')[0].args[1]).toEqual({ limit: 1800, increment: 20, rated: false });
  });
});

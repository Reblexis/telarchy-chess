// The rules of docs/chess.md as pure functions: written before the code.
import { describe, it, expect } from 'vitest';
import {
  legalOptions,
  fenAfter,
  decide,
  windowSeconds,
  proposalTitle,
  moveNumber,
  scoreOf,
  challengeVerdict,
  pickOpponent,
  horizonCell,
  sanOf,
} from '../src/rules.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Sequenced rng: returns the given values in order, then repeats the last. */
const seq = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };

describe('the options are exactly the legal moves', () => {
  it('the start position offers its 20 moves, id in UCI, label in SAN, ordered by id', () => {
    const o = legalOptions(START);
    expect(o).toHaveLength(20);
    expect(o.map(x => x.id)).toEqual([...o.map(x => x.id)].sort());
    expect(o).toContainEqual({ id: 'g1f3', label: 'Nf3' });
    expect(o).toContainEqual({ id: 'e2e4', label: 'e4' });
  });
  it('a promotion id carries the piece and castling is labelled O-O', () => {
    expect(legalOptions('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1')).toContainEqual({ id: 'e7e8q', label: 'e8=Q' });
    expect(legalOptions('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').map(x => x.label)).toEqual(expect.arrayContaining(['O-O', 'O-O-O']));
  });
  it('a position with one legal move has one option (the forced case)', () => {
    // Black king on a8, the rook on b1 holds the b-file and the king on c6 holds b7: only Ka7.
    expect(legalOptions('k7/8/2K5/8/8/8/8/1R6 b - - 0 1')).toEqual([{ id: 'a8a7', label: 'Ka7' }]);
  });
  it('the position after a UCI move list is replayed from the start', () => {
    expect(fenAfter(['e2e4', 'e7e5', 'g1f3'])).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
    expect(fenAfter([])).toBe(START);
    expect(sanOf(['e2e4', 'e7e5'], 1)).toBe('e5');
  });
  it('a move list with an illegal move throws rather than guessing', () => {
    expect(() => fenAfter(['e2e5'])).toThrow();
  });
});

describe('the option the market prices highest is played', () => {
  const o = (id: string, price: number | null) => ({ id, price });
  it('the highest price is chosen, no tie', () => {
    expect(decide([o('a', 40), o('b', 61), o('c', 55)], seq(0))).toEqual({ chosen: 'b', kind: 'market', tied: 1, reason: null });
  });
  it('a tie at the top is broken at random among the tied only', () => {
    const opts = [o('a', 60), o('b', 10), o('c', 60 + 1e-12), o('d', 60)];
    expect(decide(opts, seq(0)).chosen).toBe('a');
    expect(decide(opts, seq(0.5)).chosen).toBe('c');
    expect(decide(opts, seq(0.99)).chosen).toBe('d');
    expect(decide(opts, seq(0.99)).tied).toBe(3);
    expect(decide(opts, seq(0.99)).kind).toBe('market');
  });
  it('unpriced options never win over a priced one', () => {
    expect(decide([o('a', null), o('b', 0), o('c', null)], seq(0)).chosen).toBe('b');
  });
  it('no price at all is a random legal move, undecided, with the reason', () => {
    const d = decide([o('a', null), o('b', null), o('c', null)], seq(0.7));
    expect(d.kind).toBe('undecided');
    expect(d.chosen).toBe('c');
    expect(d.reason).toMatch(/no option has a price/);
  });
  it('a non-finite price counts as no price', () => {
    expect(decide([o('a', Number.NaN), o('b', 3)], seq(0)).chosen).toBe('b');
  });
});

describe('the decision window follows the clock', () => {
  it('is increment plus (clock - 120 s) / 30, clamped to 15..50 seconds', () => {
    expect(windowSeconds({ clockMs: 1_800_000, incrementMs: 20_000, firstMove: false })).toBe(50);
    expect(windowSeconds({ clockMs: 600_000, incrementMs: 20_000, firstMove: false })).toBe(36);
    expect(windowSeconds({ clockMs: 300_000, incrementMs: 0, firstMove: false })).toBe(15);
    expect(windowSeconds({ clockMs: 90_000, incrementMs: 20_000, firstMove: false })).toBe(19);
  });
  it('the first move gets 20 seconds, whatever the clock, because Lichess aborts after 35', () => {
    expect(windowSeconds({ clockMs: 1_800_000, incrementMs: 20_000, firstMove: true })).toBe(20);
  });
  it('under 30 seconds on the clock there is no window: the clock guard plays at once', () => {
    expect(windowSeconds({ clockMs: 29_999, incrementMs: 180_000, firstMove: false })).toBeNull();
    expect(windowSeconds({ clockMs: 30_000, incrementMs: 0, firstMove: false })).toBe(15);
  });
});

describe('names and numbers', () => {
  it('the title is Game G, move N, N counting the player\'s own moves from 1', () => {
    expect(proposalTitle(3, 12)).toBe('Game 3, move 12');
    expect(moveNumber(0)).toBe(1);
    expect(moveNumber(1)).toBe(1);
    expect(moveNumber(2)).toBe(2);
    expect(moveNumber(23)).toBe(12);
  });
  it('the game\'s book is the one-minute cell 24 hours after its start', () => {
    expect(horizonCell(new Date('2026-09-13T14:05:42Z'))).toBe('2026-09-14T14:05');
  });
});

describe('a finished game settles at 100, 50 or 0', () => {
  it('a win is 100 and a loss 0 from our own side', () => {
    expect(scoreOf({ status: 'mate', winner: 'white' }, 'white')).toBe(100);
    expect(scoreOf({ status: 'resign', winner: 'white' }, 'black')).toBe(0);
    expect(scoreOf({ status: 'outoftime', winner: 'black' }, 'black')).toBe(100);
    expect(scoreOf({ status: 'timeout', winner: 'black' }, 'white')).toBe(0);
  });
  it('a draw or stalemate is 50', () => {
    expect(scoreOf({ status: 'draw' }, 'white')).toBe(50);
    expect(scoreOf({ status: 'stalemate' }, 'black')).toBe(50);
    expect(scoreOf({ status: 'outoftime' }, 'black')).toBe(50);
  });
  it('an aborted game, or one that never started, has no result', () => {
    expect(scoreOf({ status: 'aborted' }, 'white')).toBeNull();
    expect(scoreOf({ status: 'noStart', winner: 'black' }, 'white')).toBeNull();
    expect(scoreOf({ status: 'started' }, 'white')).toBeNull();
  });
});

describe('which challenges are accepted', () => {
  const ch = (over: Record<string, unknown> = {}) => ({
    id: 'c1', variant: { key: 'standard' }, rated: true,
    timeControl: { type: 'clock', limit: 1800, increment: 20 },
    challenger: { id: 'somebot', name: 'SomeBot', rating: 1900 },
    ...over,
  });
  it('standard real-time, base 10 to 180 minutes, increment 0 to 180 s, rated or casual, is accepted when idle', () => {
    expect(challengeVerdict(ch(), { busy: false })).toEqual({ accept: true });
    expect(challengeVerdict(ch({ rated: false, timeControl: { type: 'clock', limit: 600, increment: 0 } }), { busy: false })).toEqual({ accept: true });
    expect(challengeVerdict(ch({ timeControl: { type: 'clock', limit: 10800, increment: 180 } }), { busy: false })).toEqual({ accept: true });
  });
  it('a player that is busy or settling declines with later', () => {
    expect(challengeVerdict(ch(), { busy: true })).toEqual({ accept: false, reason: 'later' });
  });
  it('another variant declines with variant', () => {
    expect(challengeVerdict(ch({ variant: { key: 'chess960' } }), { busy: false })).toEqual({ accept: false, reason: 'variant' });
  });
  it('correspondence, unlimited, or a base under 10 minutes declines with timeControl', () => {
    const tc = (timeControl: unknown) => challengeVerdict(ch({ timeControl }), { busy: false });
    expect(tc({ type: 'correspondence', daysPerTurn: 1 })).toEqual({ accept: false, reason: 'timeControl' });
    expect(tc({ type: 'unlimited' })).toEqual({ accept: false, reason: 'timeControl' });
    expect(tc({ type: 'clock', limit: 540, increment: 60 })).toEqual({ accept: false, reason: 'timeControl' });
    expect(tc({ type: 'clock', limit: 1800, increment: 181 })).toEqual({ accept: false, reason: 'timeControl' });
  });
});

describe('which bot is challenged', () => {
  const bot = (username: string, rating: number, prov = false, games = 100) => ({ id: username.toLowerCase(), username, perfs: { classical: { rating, games, prov } } });
  const bots = [bot('Near', 1600), bot('Far', 2100), bot('Prov', 1550, true), bot('Recent', 1650), bot('TelarchyBot', 1500), { id: 'noclassical', username: 'NoClassical', perfs: {} }];
  it('an established classical rating within 200 of ours, not recent, not ourselves', () => {
    expect(pickOpponent(bots, { username: 'TelarchyBot', rating: 1500, provisional: false }, ['recent'], seq(0))).toBe('near');
  });
  it('any established rating while ours is provisional', () => {
    const pool = new Set<string | null>();
    for (const r of [0, 0.4, 0.99]) pool.add(pickOpponent(bots, { username: 'TelarchyBot', rating: 1500, provisional: true }, ['recent'], seq(r)));
    expect([...pool].sort()).toEqual(['far', 'near']);
  });
  it('nobody suitable is null', () => {
    expect(pickOpponent([bot('Far', 2100)], { username: 'TelarchyBot', rating: 1500, provisional: false }, [], seq(0))).toBeNull();
  });
});

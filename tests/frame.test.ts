// The stream frame (docs/chess.md, "The stream"): written before the frame.
import { describe, it, expect } from 'vitest';
import {
  WIDTH, HEIGHT, COLUMN, LINK_TEXT, QUESTION,
  isDrawableState, piecesOf, squareRect, topArrows, rankedMoves, movePairs,
  clocksAt, clockText, nextCell, recordLine, renderFrame, drawnTexts, drawnItems,
} from '../src/frame.js';

const NOW = Date.parse('2026-09-13T21:20:00.000Z');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const at = (secsAgo: number) => new Date(NOW - secsAgo * 1000).toISOString();

function opt(id: string, san: string, price: number | null) {
  return { id, san, price, lead: price === null ? null : 0, marketId: `m-${id}` };
}

function state(over: Record<string, unknown> = {}): any {
  return {
    schema: 1,
    phase: 'our-move',
    player: { username: 'TelarchyBot', url: 'https://lichess.org/@/TelarchyBot', rating: 1415, provisional: true, games: { played: 10, won: 0, lost: 10, drawn: 0 } },
    game: {
      number: 11, id: 'hj6dhTwL', url: 'https://lichess.org/hj6dhTwL', color: 'white',
      opponent: { name: 'BretemaBot', title: 'BOT', rating: 2692 }, rated: true,
      clock: { initial: 1_800_000, increment: 20_000 },
      fen: START, moves: [], turn: 'white', clocks: { white: 600_000, black: 900_000 },
      status: 'started', result: null, startedAt: at(600), endedAt: null,
    },
    open: {
      move: 1, proposal: { id: 'p', number: 50, url: 'https://telarchy.com/chess/p/50' },
      openedAt: at(10), decideAt: new Date(NOW + 31_000).toISOString(), deadline: new Date(NOW + 33_000).toISOString(),
      tradeable: true, quotesAt: at(2),
      options: [opt('e2e4', 'e4', 62), opt('d2d4', 'd4', 55), opt('g1f3', 'Nf3', 40), opt('a2a3', 'a3', 30), opt('h2h3', 'h3', null)],
    },
    cell: '2026-09-14T21:16', cellEndsAt: '2026-09-14T21:17:00.000Z',
    recentDecisions: [],
    ...over,
  };
}

/** RGB at (x, y) of a rendered frame. */
function px(buf: Buffer, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * WIDTH + Math.round(x)) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}
const hex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const near = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('the stream never dies of one bad read', () => {
  it('holds the last frame on a payload that is not a feed state', () => {
    expect(isDrawableState(null)).toBe(false);
    expect(isDrawableState(undefined)).toBe(false);
    expect(isDrawableState('oops')).toBe(false);
    expect(isDrawableState({ error: 'not found' })).toBe(false);
    expect(isDrawableState({ schema: 1, phase: 7 })).toBe(false);
  });
  it('draws a state with no game yet, because that is a real state', () => {
    expect(isDrawableState({ schema: 1, phase: 'seeking', game: null, open: null })).toBe(true);
    expect(isDrawableState(state())).toBe(true);
  });
  it('a malformed game never throws out of the frame', () => {
    const bad = state({ game: { fen: 'garbage', moves: ['zz', 3], color: 'purple', clocks: null }, open: { options: [{ id: null }, 5] } });
    expect(() => renderFrame(bad, NOW)).not.toThrow();
    expect(renderFrame(bad, NOW).length).toBe(WIDTH * HEIGHT * 3);
    expect(() => renderFrame({ schema: 1, phase: 'seeking', game: null }, NOW)).not.toThrow();
  });
});

describe('the board', () => {
  it('reads the position from the FEN', () => {
    const p = piecesOf(START);
    expect(p.get('e1')).toBe('K');
    expect(p.get('d8')).toBe('q');
    expect(p.get('a2')).toBe('P');
    expect(p.get('e4')).toBeUndefined();
    expect(p.size).toBe(32);
    expect(piecesOf('garbage').size).toBe(0);
    expect(piecesOf(null).size).toBe(0);
  });
  it('is seen from TelarchyBot\'s side: white at the bottom when it plays white', () => {
    expect(squareRect('a1', 'white')).toEqual({ x: 24, y: 24 + 7 * 84, w: 84, h: 84 });
    expect(squareRect('h8', 'white')).toEqual({ x: 24 + 7 * 84, y: 24, w: 84, h: 84 });
  });
  it('is seen from TelarchyBot\'s side: black at the bottom when it plays black', () => {
    expect(squareRect('a1', 'black')).toEqual({ x: 24 + 7 * 84, y: 24, w: 84, h: 84 });
    expect(squareRect('h8', 'black')).toEqual({ x: 24, y: 24 + 7 * 84, w: 84, h: 84 });
  });
  it('a1 is a dark square and h1 a light one', () => {
    const buf = renderFrame(state({ phase: 'their-move', open: null, game: { ...state().game, fen: '8/8/8/8/8/8/8/8 w - - 0 1' } }), NOW);
    const a1 = squareRect('a1', 'white');
    const h1 = squareRect('h1', 'white');
    expect(near(px(buf, a1.x + a1.w - 8, a1.y + 8), hex('#d6ccb2'))).toBe(true);
    expect(near(px(buf, h1.x + h1.w - 8, h1.y + 8), hex('#efe8d6'))).toBe(true);
  });
  it('tints the two squares of the last move', () => {
    const s = state({ phase: 'their-move', open: null });
    s.game.moves = ['g1f3'];
    s.game.fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';
    const buf = renderFrame(s, NOW);
    const g1 = squareRect('g1', 'white');
    const f3 = squareRect('f3', 'white');
    expect(near(px(buf, g1.x + g1.w - 8, g1.y + 8), hex('#d2bb6a'))).toBe(true); // g1 dark
    expect(near(px(buf, f3.x + f3.w - 8, f3.y + 8), hex('#e6d28a'))).toBe(true); // f3 light
  });
  it('draws the pieces of the position and nothing on an empty square', () => {
    const buf = renderFrame(state({ phase: 'their-move', open: null }), NOW);
    const count = (sq: string) => {
      const r = squareRect(sq, 'white');
      const ground = (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 1 ? hex('#d6ccb2') : hex('#efe8d6');
      let n = 0;
      for (let y = r.y + 21; y < r.y + 63; y += 2) for (let x = r.x + 21; x < r.x + 63; x += 2) if (!near(px(buf, x, y), ground, 20)) n++;
      return n;
    };
    expect(count('e1')).toBeGreaterThan(40);
    expect(count('d8')).toBeGreaterThan(40);
    expect(count('e4')).toBe(0);
  });
});

describe('the top three moves are arrows', () => {
  it('takes the three highest prices, shaded 0.9 to 0.3', () => {
    const a = topArrows(state());
    expect(a.map(x => x.uci)).toEqual(['e2e4', 'd2d4', 'g1f3']);
    expect(a.map(x => x.opacity)).toEqual([0.9, expect.closeTo(0.9 - 0.6 * (7 / 22), 5), 0.3]);
    expect(a.map(x => x.price)).toEqual([62, 55, 40]);
  });
  it('the leader is the strictly highest price only', () => {
    expect(topArrows(state()).map(x => x.leader)).toEqual([true, false, false]);
    const tied = state();
    tied.open.options = [opt('a2a3', 'a3', 50), opt('b2b3', 'b3', 50), opt('c2c3', 'c3', 50)];
    const t = topArrows(tied);
    expect(t.map(x => x.leader)).toEqual([false, false, false]);
    expect(t.map(x => x.opacity)).toEqual([0.55, 0.55, 0.55]);
    expect(t.map(x => x.uci)).toEqual(['a2a3', 'b2b3', 'c2c3']);
  });
  it('an unpriced option draws no arrow', () => {
    const s = state();
    s.open.options = [opt('e2e4', 'e4', 50), opt('d2d4', 'd4', null)];
    const a = topArrows(s);
    expect(a.map(x => x.uci)).toEqual(['e2e4']);
    expect(a[0].opacity).toBe(0.55);
  });
  it('draws nothing while no move is open', () => {
    expect(topArrows(state({ phase: 'their-move', open: null }))).toEqual([]);
    expect(topArrows(state({ phase: 'seeking', open: null, game: null }))).toEqual([]);
  });
  it('the leader\'s arrow is on the board in the accent and its price tag is drawn', () => {
    const buf = renderFrame(state(), NOW);
    const e3 = squareRect('e3', 'white');
    const [r, , b] = px(buf, e3.x + e3.w / 2, e3.y + e3.h / 2);
    expect(r - b).toBeGreaterThan(80);
    expect(drawnTexts(state(), NOW)).toEqual(expect.arrayContaining(['62.0', '55.0', '40.0']));
  });
  it('no arrow crosses the board while the opponent thinks', () => {
    const buf = renderFrame(state({ phase: 'their-move', open: null }), NOW);
    const e3 = squareRect('e3', 'white');
    expect(near(px(buf, e3.x + e3.w / 2, e3.y + e3.h / 2), hex('#d6ccb2'))).toBe(true); // e3 dark, empty
  });
});

describe('the clocks', () => {
  it('reads m:ss, h:mm:ss from an hour, never below 0:00', () => {
    expect(clockText(1_800_000)).toBe('30:00');
    expect(clockText(31_000)).toBe('0:31');
    expect(clockText(31_999)).toBe('0:31');
    expect(clockText(3_723_000)).toBe('1:02:03');
    expect(clockText(-5_000)).toBe('0:00');
    expect(clockText(Number.NaN)).toBe('0:00');
  });
  it('TelarchyBot\'s clock counts down from when its move opened', () => {
    const c = clocksAt(state(), NOW);
    expect(c).toEqual({ white: 590_000, black: 900_000, ticking: 'white' });
  });
  it('the opponent\'s clock counts down from our newest decision in this game', () => {
    const s = state({ phase: 'their-move', open: null, recentDecisions: [{ game: 11, move: 1, at: at(5), chosen: 'e2e4', san: 'e4', price: 50, tied: 0, kind: 'market', undecidedReason: null }] });
    s.game.moves = ['e2e4'];
    s.game.turn = 'black';
    expect(clocksAt(s, NOW)).toEqual({ white: 600_000, black: 895_000, ticking: 'black' });
  });
  it('a decision from an earlier game does not start the opponent\'s clock', () => {
    const s = state({ phase: 'their-move', open: null, recentDecisions: [{ game: 10, move: 30, at: at(5) }] });
    s.game.color = 'black';
    expect(clocksAt(s, NOW)).toEqual({ white: 600_000, black: 900_000, ticking: null });
  });
  it('a clock never counts below zero', () => {
    const s = state();
    s.game.clocks.white = 4_000;
    expect(clocksAt(s, NOW).white).toBe(0);
  });
  it('stands still once the game has ended', () => {
    const s = state({ phase: 'settling', open: null });
    s.game.status = 'mate'; s.game.result = 0; s.game.endedAt = at(3);
    expect(clocksAt(s, NOW).ticking).toBe(null);
  });
});

describe('the state of the move', () => {
  it('counts down to the decision while a move is open', () => {
    expect(nextCell(state(), NOW)).toEqual({ label: 'Next move', value: '0:31', tone: 'accent' });
  });
  it('says deciding once the count has run out', () => {
    const s = state();
    s.open.decideAt = at(1);
    expect(nextCell(s, NOW)).toEqual({ label: 'Next move', value: 'deciding', tone: 'accent' });
  });
  it('says thinking while the opponent moves', () => {
    expect(nextCell(state({ phase: 'their-move', open: null }), NOW)).toEqual({ label: 'Their move', value: 'thinking', tone: 'mute' });
  });
  it('shows the result once the game is over', () => {
    const over = (result: number) => { const s = state({ phase: 'settling', open: null }); s.game.result = result; s.game.status = 'mate'; return nextCell(s, NOW); };
    expect(over(100)).toEqual({ label: 'Game over', value: 'won', tone: 'green' });
    expect(over(0)).toEqual({ label: 'Game over', value: 'lost', tone: 'red' });
    expect(over(50)).toEqual({ label: 'Game over', value: 'drawn', tone: 'fg' });
    const sought = state({ phase: 'seeking', open: null });
    sought.game.result = 0;
    expect(nextCell(sought, NOW)).toEqual({ label: 'Game over', value: 'lost', tone: 'red' });
  });
  it('says seeking when there is no result to show', () => {
    expect(nextCell(state({ phase: 'seeking', open: null, game: null }), NOW)).toEqual({ label: 'Next game', value: 'seeking', tone: 'mute' });
  });
});

describe('the record and the panel', () => {
  it('writes the record in one line, ? while provisional', () => {
    expect(recordLine(state().player)).toBe('RATING 1415? · PLAYED 10 · WON 0 · LOST 10 · DRAWN 0');
    expect(recordLine({ ...state().player, provisional: false, rating: 1720 })).toBe('RATING 1720 · PLAYED 10 · WON 0 · LOST 10 · DRAWN 0');
    expect(recordLine(null)).toBe(null);
  });
  it('the record is drawn, and absent while player is null', () => {
    expect(drawnTexts(state(), NOW)).toContain('RATING 1415? · PLAYED 10 · WON 0 · LOST 10 · DRAWN 0');
    expect(drawnTexts(state({ player: null }), NOW).some(t => t.startsWith('RATING'))).toBe(false);
  });
  it('ranks the top moves by price, ties in proposal order, unpriced last', () => {
    const s = state();
    s.open.options = [opt('a', 'a3', 50), opt('b', 'b3', 62), opt('c', 'c3', null), opt('d', 'd3', 62), opt('e', 'e3', 40), opt('f', 'f3', 45), opt('g', 'g3', 30)];
    const r = rankedMoves(s);
    expect(r.rows.map(x => x.san)).toEqual(['b3', 'd3', 'a3', 'f3', 'e3']);
    expect(r.rows.map(x => x.leader)).toEqual([false, false, false, false, false]);
    expect(r.more).toBe(2);
    expect(r.legal).toBe(7);
    expect(rankedMoves(state()).rows.map(x => x.leader)).toEqual([true, false, false, false, false]);
    expect(rankedMoves(state()).more).toBe(0);
  });
  it('the top moves and "+N more" are drawn while a move is open', () => {
    const s = state();
    s.open.options = Array.from({ length: 20 }, (_, i) => opt(`m${i}`, `M${i}`, 50 - i));
    const texts = drawnTexts(s, NOW);
    expect(texts).toEqual(expect.arrayContaining(['TOP MOVES', '20 LEGAL', 'M0', 'M4', '+15 more']));
    expect(texts).not.toContain('M5');
  });
  it('writes the game\'s moves as numbered SAN pairs, newest first', () => {
    expect(movePairs(['e2e4', 'e7e5', 'g1f3'])).toEqual([{ n: 2, white: 'Nf3', black: null }, { n: 1, white: 'e4', black: 'e5' }]);
    expect(movePairs(['e2e4', 'zzzz', 'g1f3'])).toEqual([{ n: 1, white: 'e4', black: null }]);
    expect(movePairs([])).toEqual([]);
    expect(movePairs(Array(12).fill(0).flatMap(() => ['g1f3', 'g8f6', 'f3g1', 'f6g8']).slice(0, 14), 5).map(p => p.n)).toEqual([7, 6, 5, 4, 3]);
  });
  it('shows the game panel while no move is open', () => {
    const s = state({ phase: 'their-move', open: null });
    s.game.moves = ['e2e4', 'e7e5', 'g1f3'];
    const texts = drawnTexts(s, NOW);
    expect(texts).toEqual(expect.arrayContaining(['GAME 11', '2.', 'Nf3', '1.', 'e4', 'e5']));
    expect(texts).not.toContain('TOP MOVES');
  });
  it('says it is waiting for the first game when there is none', () => {
    const texts = drawnTexts({ schema: 1, phase: 'seeking', player: null, game: null, open: null, recentDecisions: [] }, NOW);
    expect(texts).toContain('Waiting for the first game');
    expect(texts).toContain(LINK_TEXT);
  });
});

describe('the column', () => {
  it('carries the name, the question and the one link', () => {
    const texts = drawnTexts(state(), NOW);
    expect(texts).toEqual(expect.arrayContaining(['Chess', QUESTION, LINK_TEXT, 'NEXT MOVE', '0:31', '9:50', '15:00']));
    expect(LINK_TEXT).toBe('telarchy.com/chess');
    expect(QUESTION).toBe('What will I score in this game?');
  });
  it('names both players with their ratings over their clocks', () => {
    const texts = drawnTexts(state(), NOW);
    expect(texts).toEqual(expect.arrayContaining(['TELARCHYBOT 1415?', 'BRETEMABOT 2692']));
  });
  it('no text runs past the frame, and nothing in the column leaves it', () => {
    const s = state();
    s.game.opponent = { name: 'AnExtraordinarilyLongLichessBotNameXYZ', title: 'BOT', rating: 2692 };
    s.open.options = [opt('e1g1', 'O-O', 99.9), opt('e7e8q', 'exd8=Q+', 12.5), opt('a2a3', 'a3', 0)];
    for (const it of drawnItems(s, NOW)) {
      expect(it.left, it.text).toBeGreaterThanOrEqual(0);
      expect(it.right, it.text).toBeLessThanOrEqual(WIDTH - 24 + 0.5);
      if (it.left >= COLUMN.x - 1) expect(it.right, it.text).toBeLessThanOrEqual(COLUMN.x + COLUMN.w + 0.5);
    }
    expect(drawnTexts(s, NOW).some(t => t.startsWith('ANEXTRA') && t.endsWith('…'))).toBe(true);
  });
  it('never sets a dash', () => {
    for (const t of drawnTexts(state(), NOW)) expect(t).not.toMatch(/[–—]/);
  });
});

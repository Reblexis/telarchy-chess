// The rules of docs/chess.md as pure functions: the options, the decision,
// the window, the score, which challenges are taken and which bot is asked.
import { Chess } from 'chess.js';

export type Color = 'white' | 'black';
export type Rng = () => number;

export interface MoveOption { id: string; label: string }

/** docs/chess.md "The move": one option per legal move, id in UCI, label in SAN, ordered by id. */
export function legalOptions(fen: string): MoveOption[] {
  const c = new Chess(fen);
  return c
    .moves({ verbose: true })
    .map(m => ({ id: `${m.from}${m.to}${m.promotion ?? ''}`, label: m.san }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function replay(uci: string[]): Chess {
  const c = new Chess();
  for (const m of uci) {
    // chess.js throws on an illegal move: a record we cannot replay is an error, never a guess.
    c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined });
  }
  return c;
}

/** The position after a game's UCI moves, from the standard start. */
export function fenAfter(uci: string[]): string {
  return replay(uci).fen();
}

/** The SAN of the move at `index` in a UCI move list. */
export function sanOf(uci: string[], index: number): string {
  return replay(uci.slice(0, index + 1)).history().at(-1) ?? '';
}

/** Prices within this of each other are a tie (docs/chess.md, "The move"). */
const TIE = 1e-9;

export interface Decision {
  chosen: string;
  kind: 'market' | 'undecided';
  /** How many options shared the top price (1 when there was a clear leader, 0 when undecided). */
  tied: number;
  reason: string | null;
}

const pick = <T>(xs: T[], rng: Rng): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

/** docs/chess.md "The move": the highest price is chosen, a tie is random among
 *  the tied, no price at all is a random legal move, undecided. */
export function decide(options: Array<{ id: string; price: number | null }>, rng: Rng): Decision {
  if (options.length === 0) throw new Error('a decision needs at least one option');
  const priced = options.filter(o => typeof o.price === 'number' && Number.isFinite(o.price));
  if (priced.length === 0) {
    return { chosen: pick(options, rng).id, kind: 'undecided', tied: 0, reason: 'no option has a price' };
  }
  const top = Math.max(...priced.map(o => o.price as number));
  const tied = priced.filter(o => top - (o.price as number) <= TIE);
  return { chosen: pick(tied, rng).id, kind: 'market', tied: tied.length, reason: null };
}

export const WINDOW = { min: 15, max: 50, firstMove: 20, reserveSeconds: 120, spread: 30, clockGuardSeconds: 30 } as const;

/** docs/chess.md "The decision window follows the clock", in whole seconds, or
 *  null under the clock guard (a random move is played at once). */
export function windowSeconds(a: { clockMs: number; incrementMs: number; firstMove: boolean }): number | null {
  const clock = a.clockMs / 1000;
  if (clock < WINDOW.clockGuardSeconds) return null;
  if (a.firstMove) return WINDOW.firstMove;
  const raw = a.incrementMs / 1000 + (clock - WINDOW.reserveSeconds) / WINDOW.spread;
  return Math.min(WINDOW.max, Math.max(WINDOW.min, Math.floor(raw)));
}

export function proposalTitle(game: number, move: number): string {
  return `Game ${game}, move ${move}`;
}

/** The player's own move number (from 1) when `plies` half-moves have been played. */
export function moveNumber(plies: number): number {
  return Math.floor(plies / 2) + 1;
}

/** docs/chess.md "The workspace": the one-minute cell 24 hours after the game's start. */
export function horizonCell(startedAt: Date): string {
  return new Date(startedAt.getTime() + 24 * 3600_000).toISOString().slice(0, 16);
}

/** Lichess statuses that end a game with a result. */
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd']);

/** docs/chess.md "The workspace": 100 a win, 50 a draw, 0 a loss, from our side; null when there is no result. */
export function scoreOf(game: { status: string; winner?: Color | null }, us: Color): 100 | 50 | 0 | null {
  if (!FINISHED.has(game.status)) return null;
  if (!game.winner) return 50;
  return game.winner === us ? 100 : 0;
}

export interface ChallengeLike {
  variant?: { key?: string };
  timeControl?: { type?: string; limit?: number; increment?: number };
}
export type Verdict = { accept: true } | { accept: false; reason: 'later' | 'variant' | 'timeControl' };

/** docs/chess.md "Clocks": which incoming challenges are taken. */
export function challengeVerdict(ch: ChallengeLike, state: { busy: boolean }): Verdict {
  if (state.busy) return { accept: false, reason: 'later' };
  if (ch.variant?.key !== 'standard') return { accept: false, reason: 'variant' };
  const tc = ch.timeControl;
  const ok =
    tc?.type === 'clock' &&
    typeof tc.limit === 'number' && tc.limit >= 600 && tc.limit <= 10800 &&
    typeof tc.increment === 'number' && tc.increment >= 0 && tc.increment <= 180;
  return ok ? { accept: true } : { accept: false, reason: 'timeControl' };
}

export interface OnlineBot {
  id: string;
  username: string;
  perfs?: { classical?: { rating?: number; games?: number; prov?: boolean } };
}

/** docs/chess.md "Opponents": a bot with an established classical rating within
 *  200 of ours (any while ours is provisional), not recent, not ourselves. */
export function pickOpponent(
  bots: OnlineBot[],
  me: { username: string; rating: number; provisional: boolean },
  recent: string[],
  rng: Rng,
): string | null {
  const recentIds = new Set(recent.map(r => r.toLowerCase()));
  const pool = bots.filter(b => {
    const c = b.perfs?.classical;
    if (b.username.toLowerCase() === me.username.toLowerCase()) return false;
    if (recentIds.has(b.id.toLowerCase())) return false;
    if (!c || typeof c.rating !== 'number' || c.prov || !c.games) return false;
    return me.provisional || Math.abs(c.rating - me.rating) <= 200;
  });
  return pool.length ? pick(pool, rng).id : null;
}

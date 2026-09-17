// The operator of docs/chess.md: games, the move, the settlement, seeking,
// and the feed. Driven by Lichess events (onGameFull, onGameState,
// onChallenge, onChallengeGone) and a clock (tick); every time is passed in.
import {
  challengeVerdict,
  decide,
  fenAfter,
  horizonCell,
  legalOptions,
  moveNumber,
  pickOpponent,
  proposalTitle,
  scoreOf,
  windowSeconds,
  SEEK_MAX_BAND,
  WINDOW,
  type ChallengeLike,
  type Color,
  type MoveOption,
  type OnlineBot,
  type Rng,
} from './rules.js';

export interface ProposalRef { id: string; number: number; url: string }
export type Prices = Record<string, { price: number | null; lead: number | null; marketId?: string }>;

/** The Telarchy calls the operator makes. Deliberately no trade method:
 *  docs/chess.md, "The operator account never trades." */
/** docs/chess.md "The feed", `call` and `recentTrades`, as the client reads them. */
export interface RawTrade { id: string; at: string; handle: string; side: 'buy' | 'sell'; direction: 'higher' | 'lower'; credits: number; marketId: string; price: number | null }
export interface CallRecord { marketId: string | null; value: number | null; history: Array<{ at: string; value: number }> }
export interface Activity { call: CallRecord | null; trades: RawTrade[] }
export interface TradeRecord { id: string; at: string; handle: string; side: 'buy' | 'sell'; direction: 'higher' | 'lower'; credits: number; book: 'game' | 'move'; san: string | null; move: number | null; price: number | null }

export interface TelarchyClient {
  /** Public reads only, for the feed; optional, and never on the decision's path. */
  readActivity?(): Promise<Activity>;
  setHorizon(cell: string): Promise<void>;
  refreshBooks(): Promise<void>;
  postProposal(title: string, description: string, decideBy: Date, options: MoveOption[]): Promise<ProposalRef>;
  readPrices(ref: ProposalRef, cell: string | null): Promise<Prices>;
  approveOption(ref: ProposalRef, option: string): Promise<void>;
  declineProposal(ref: ProposalRef): Promise<void>;
  postReading(value: number, at: Date): Promise<void>;
  settleMetric(value: number, at: Date, reason: string): Promise<void>;
}

/** The Lichess calls. Deliberately no draw, takeback or resign method. */
export interface LichessClient {
  move(gameId: string, uci: string): Promise<void>;
  acceptChallenge(id: string): Promise<void>;
  declineChallenge(id: string, reason: string): Promise<void>;
  challenge(username: string, tc: { limit: number; increment: number; rated: boolean }): Promise<{ id: string }>;
  cancelChallenge(id: string): Promise<void>;
  onlineBots(): Promise<OnlineBot[]>;
  account(): Promise<PlayerRecord>;
  /** docs/chess.md "The player": the win against an opponent who left, once Lichess allows it. */
  claimVictory(gameId: string): Promise<void>;
}

/** docs/chess.md "The feed", `player`: the account as Lichess last reported it. */
export interface PlayerRecord {
  username: string;
  url: string;
  rating: number;
  provisional: boolean;
  games: { played: number; won: number; lost: number; drawn: number };
}

export interface OperatorOptions {
  username: string;
  seek: boolean;
  workspaceId: string;
  /** The Telarchy API base a bot trades on, published in /state. */
  tradeBase?: string;
}

export type DecisionKind = 'market' | 'undecided' | 'forced' | 'clock';
export interface DecisionRecord {
  game: number; move: number; at: string; chosen: string; san: string;
  price: number | null; tied: number; kind: DecisionKind; undecidedReason: string | null;
}

interface Player { id?: string; name?: string; title?: string | null; rating?: number }
export interface GameFull {
  id: string; rated?: boolean;
  clock?: { initial: number; increment: number } | null;
  white: Player; black: Player;
  state: GameStateEvent;
}
export interface GameStateEvent {
  moves: string; wtime: number; btime: number; winc: number; binc: number; status: string; winner?: Color;
}

interface GameRecord {
  number: number; id: string; color: Color;
  opponent: { name: string; title: string | null; rating: number | null };
  rated: boolean; clock: { initial: number; increment: number } | null;
  moves: string[]; clocks: { white: number; black: number }; inc: { white: number; black: number };
  status: string; winner: Color | null; result: 100 | 50 | 0 | null;
  startedAt: string; endedAt: string | null; cell: string;
}

interface OpenMove {
  game: number; gameId: string; plies: number; move: number;
  proposal: ProposalRef; options: MoveOption[];
  openedAt: string; decideAt: string; deadline: string;
  quotes: Prices | null; quotesAt: string | null;
}

export interface Ply {
  ply: number; at: string; by: 'us' | 'them'; uci: string; san: string; fen: string;
  kind?: DecisionKind; price?: number | null; tied?: number;
}

interface Settlement { value: 100 | 50 | 0; reason: string; at: string; nextTryAt: number }

const RULE =
  'On my turn one proposal offers every legal move as an option, each priced by its own book on this game\'s score (100 a win, 50 a draw, 0 a loss). Two seconds before the deadline the option with the highest price is played; a tie is random among the tied, and no price at all plays a random legal move.';

const POLL_EVERY_MS = 5_000;
const ACTIVITY_EVERY_MS = 5_000;
const ACTIVITY_TIMEOUT_MS = 8_000;
const TRADES_KEPT = 20;
const CALL_POINTS = 300;
const POLL_TIMEOUT_MS = 10_000;
const DECIDE_READ_MS = 2_000;
const SETTLE_RETRY_MS = 60_000;
const SEEK_IDLE_MS = 120_000;
const CHALLENGE_WAIT_MS = 60_000;
const SEEK_GAP_MS = 30_000;
/** docs/chess.md "The search pauses": one probe a minute while paused. */
const PROBE_EVERY_MS = 60_000;
const SEEK_CLOCK = { limit: 1800, increment: 20, rated: true };
const RECENT_DECISIONS = 20;
const RECENT_OPPONENTS = 5;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer in ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Operator {
  game: GameRecord | null = null;
  open: OpenMove | null = null;
  recentDecisions: DecisionRecord[] = [];
  /** docs/chess.md "The feed": the game's main book and the trades on its books. */
  call: CallRecord | null = null;
  recentTrades: TradeRecord[] = [];
  /** The option books of this game by market id, kept after their move is decided. */
  private bookNames = new Map<string, { san: string; move: number }>();
  private activityAt = 0;
  private activityBusy = false;
  private activityError: string | null = null;
  games: Array<Omit<GameRecord, 'moves' | 'clocks' | 'inc'> & { plies: number }> = [];
  settlement: Settlement | null = null;
  pendingDeclines: Array<{ ref: ProposalRef; nextTryAt: number }> = [];
  /** Every game's plies by game number (docs/chess.md, "The feed", /history). */
  plies: Record<number, Ply[]> = {};
  private claimAt: number | null = null;
  player: PlayerRecord | null = null;
  /** When the record was last read; 0 asks for a read on the next tick. */
  private accountAt = 0;
  /** The ply at which a move was last sent, so a late report of the old position never reopens it. */
  private playedPly: { gameId: string; plies: number } | null = null;
  private lastPollAt = 0;
  private idleSince: number | null = null;
  private challengeOut: { id: string; username: string; sentAt: number } | null = null;
  private nextSeekAt = 0;
  private recentOpponents: string[] = [];
  private acceptedAt = 0;
  private busyTick = false;
  /** docs/chess.md "The search pauses while the platform cannot price a
   *  game": set by a move that went undecided for a platform reason, cleared
   *  by a priced move or a probe that succeeds. */
  paused: { since: string; reason: string } | null = null;
  private probeAt = 0;

  constructor(
    private telarchy: TelarchyClient,
    private lichess: LichessClient,
    private rng: Rng,
    private opts: OperatorOptions,
  ) {}

  private get me(): string { return this.opts.username.toLowerCase(); }
  private running(): boolean { return !!this.game && !this.game.endedAt; }

  // ---- challenges -------------------------------------------------------

  async onChallenge(ch: ChallengeLike & { id: string; challenger?: { id?: string } }, now: Date): Promise<void> {
    if (ch.challenger?.id?.toLowerCase() === this.me) return; // our own outgoing challenge, echoed
    const busy = this.pendingDeclines.length > 0 || this.running() || !!this.settlement || !!this.paused || !!this.challengeOut || now.getTime() - this.acceptedAt < 30_000;
    const v = challengeVerdict(ch, { busy });
    try {
      if (v.accept) {
        this.acceptedAt = now.getTime();
        await this.lichess.acceptChallenge(ch.id);
      } else {
        await this.lichess.declineChallenge(ch.id, v.reason);
      }
    } catch (e) {
      console.error(`challenge ${ch.id}: ${(e as Error).message}`);
    }
  }

  /** Our challenge was declined or cancelled: the next candidate 30 seconds later. */
  onChallengeGone(id: string, now: Date): void {
    if (this.challengeOut?.id !== id) return;
    this.challengeOut = null;
    this.nextSeekAt = now.getTime() + SEEK_GAP_MS;
  }

  // ---- games ------------------------------------------------------------

  async onGameFull(full: GameFull, now: Date): Promise<void> {
    if (this.game?.id !== full.id) {
      const color: Color = full.white.id?.toLowerCase() === this.me ? 'white' : 'black';
      const opp = color === 'white' ? full.black : full.white;
      const number = (this.games.at(-1)?.number ?? 0) + 1;
      const cell = horizonCell(now);
      this.game = {
        number, id: full.id, color,
        opponent: { name: opp.name ?? opp.id ?? '?', title: opp.title ?? null, rating: opp.rating ?? null },
        rated: !!full.rated, clock: full.clock ?? null,
        moves: [], clocks: { white: 0, black: 0 }, inc: { white: 0, black: 0 },
        status: 'started', winner: null, result: null,
        startedAt: now.toISOString(), endedAt: null, cell,
      };
      this.games.push(this.summary(this.game));
      this.call = null; this.recentTrades = []; this.bookNames = new Map(); this.activityAt = 0;
      this.challengeOut = null;
      this.idleSince = null;
      this.remember(opp.id ?? opp.name ?? '');
      // docs/chess.md "One book per game": a refusal is logged; the moves
      // still run on whatever book exists (the undecided path covers none).
      try { await this.telarchy.setHorizon(cell); } catch (e) { console.error(`set horizon ${cell}: ${(e as Error).message}`); }
      try { await this.telarchy.refreshBooks(); } catch (e) { console.error(`refresh books: ${(e as Error).message}`); }
    }
    await this.onGameState(full.state, now);
  }

  async onGameState(s: GameStateEvent, now: Date): Promise<void> {
    const g = this.game;
    if (!g || g.endedAt) return;
    g.moves = s.moves.split(' ').filter(Boolean);
    g.clocks = { white: s.wtime, black: s.btime };
    g.inc = { white: s.winc, black: s.binc };
    g.status = s.status;
    g.winner = s.winner ?? null;
    this.recordPlies(g, now);
    this.syncSummary();
    if (s.status !== 'started' && s.status !== 'created') return this.finish(now);
    const ourTurn = (g.moves.length % 2 === 0) === (g.color === 'white');
    if (!ourTurn) return;
    if (this.open && this.open.gameId === g.id && this.open.plies === g.moves.length) return;
    if (this.playedPly && this.playedPly.gameId === g.id && this.playedPly.plies === g.moves.length) return;
    await this.openMove(now);
  }

  private async openMove(now: Date): Promise<void> {
    const g = this.game!;
    const plies = g.moves.length;
    const options = legalOptions(fenAfter(g.moves));
    if (options.length === 0) return; // the end is on its way from Lichess
    const move = moveNumber(plies);
    if (options.length === 1) {
      return this.play(options[0], { kind: 'forced', price: null, tied: 0, reason: null }, move, now);
    }
    const w = windowSeconds({ clockMs: g.clocks[g.color], incrementMs: g.inc[g.color], firstMove: plies < 2 });
    if (w === null) {
      return this.play(this.randomOf(options), { kind: 'clock', price: null, tied: 0, reason: null }, move, now);
    }
    const deadline = new Date(now.getTime() + w * 1000);
    let proposal: ProposalRef;
    try {
      proposal = await this.telarchy.postProposal(proposalTitle(g.number, move), this.describe(g, move), deadline, options);
    } catch (e) {
      return this.play(this.randomOf(options), { kind: 'undecided', price: null, tied: 0, reason: `posting failed: ${(e as Error).message}` }, move, now);
    }
    this.open = {
      game: g.number, gameId: g.id, plies, move, proposal, options,
      openedAt: now.toISOString(),
      decideAt: new Date(deadline.getTime() - 2000).toISOString(),
      deadline: deadline.toISOString(),
      quotes: null, quotesAt: null,
    };
    // docs/chess.md "The move": read at once, so every option's market id is on /state within a tick.
    this.lastPollAt = 0;
  }

  private describe(g: GameRecord, move: number): string {
    const opp = `${g.opponent.title ? `${g.opponent.title} ` : ''}${g.opponent.name}${g.opponent.rating ? ` (${g.opponent.rating})` : ''}`;
    const last = g.moves.length ? legalSanOfLast(g.moves) : 'none yet';
    return (
      `I play ${g.color} against ${opp}, move ${move}. Their last move: ${last}. ` +
      `Clocks: white ${mmss(g.clocks.white)}, black ${mmss(g.clocks.black)}. Position: ${fenAfter(g.moves)}. ` +
      `Game: https://lichess.org/${g.id}. Each option is priced on my score in this game (100 a win, 50 a draw, 0 a loss); ` +
      `the option priced highest two seconds before the deadline is played, a tie is random, no price plays a random legal move.`
    );
  }

  private randomOf(options: MoveOption[]): MoveOption {
    return options[Math.min(options.length - 1, Math.floor(this.rng() * options.length))];
  }

  private async play(
    option: MoveOption,
    d: { kind: DecisionKind; price: number | null; tied: number; reason: string | null },
    move: number,
    now: Date,
  ): Promise<void> {
    const g = this.game!;
    this.playedPly = { gameId: g.id, plies: g.moves.length };
    this.open = null;
    this.recentDecisions.unshift({
      game: g.number, move, at: now.toISOString(), chosen: option.id, san: option.label,
      price: d.price, tied: d.tied, kind: d.kind, undecidedReason: d.reason,
    });
    this.recentDecisions.length = Math.min(this.recentDecisions.length, RECENT_DECISIONS);
    // The platform's word on itself (docs/chess.md, "The search pauses"):
    // a priced move clears the mark, an undecided one sets it. The clock
    // guard and a forced move say nothing about the platform.
    if (d.kind === 'market') this.paused = null;
    else if (d.kind === 'undecided' && !this.paused) { this.paused = { since: now.toISOString(), reason: d.reason ?? 'undecided' }; this.probeAt = now.getTime(); }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await within(this.lichess.move(g.id, option.id), 10_000);
        return;
      } catch (e) {
        console.error(`move ${option.id} in ${g.id} (attempt ${attempt + 1}): ${(e as Error).message}`);
      }
    }
  }

  private recordPlies(g: GameRecord, now: Date): void {
    const list = (this.plies[g.number] ??= []);
    for (let i = list.length; i < g.moves.length; i++) {
      const uci = g.moves[i];
      const before = g.moves.slice(0, i);
      const by: 'us' | 'them' = (i % 2 === 0) === (g.color === 'white') ? 'us' : 'them';
      const san = legalOptions(fenAfter(before)).find(o => o.id === uci)?.label ?? uci;
      const ply: Ply = { ply: i + 1, at: now.toISOString(), by, uci, san, fen: fenAfter(g.moves.slice(0, i + 1)) };
      if (by === 'us') {
        const d = this.recentDecisions.find(x => x.game === g.number && x.move === moveNumber(i) && x.chosen === uci);
        if (d) Object.assign(ply, { kind: d.kind, price: d.price, tied: d.tied });
      }
      list.push(ply);
    }
  }

  /** docs/chess.md "The player": claim the win when Lichess says it may be claimed. */
  async onOpponentGone(ev: { gone: boolean; claimWinInSeconds?: number }, now: Date): Promise<void> {
    if (!this.running() || !ev.gone) { this.claimAt = null; return; }
    this.claimAt = now.getTime() + Math.max(0, ev.claimWinInSeconds ?? 0) * 1000;
    if (now.getTime() >= this.claimAt) await this.claim();
  }

  private async claim(): Promise<void> {
    const g = this.game;
    this.claimAt = null;
    if (!g || g.endedAt) return;
    try { await this.lichess.claimVictory(g.id); } catch (e) { console.error(`claim victory ${g.id}: ${(e as Error).message}`); }
  }

  // ---- the clock --------------------------------------------------------

  async tick(now: Date): Promise<void> {
    if (this.busyTick) return;
    this.busyTick = true;
    try {
      const t = now.getTime();
      if (this.open) {
        if (t >= Date.parse(this.open.decideAt)) await this.close(now);
        else if (t - this.lastPollAt >= POLL_EVERY_MS) await this.poll(now);
      }
      const cleanup = this.pendingDeclines.find(x => t >= x.nextTryAt);
      if (cleanup) await this.decline(cleanup.ref, now);
      if (this.claimAt !== null && t >= this.claimAt) await this.claim();
      if (t - this.accountAt >= 60_000) await this.readAccount(now);
      if (this.settlement && t >= this.settlement.nextTryAt) await this.trySettle(now);
      if (this.paused && !this.running() && t - this.probeAt >= PROBE_EVERY_MS) await this.probe(now);
      await this.seek(now);
    } finally {
      this.busyTick = false;
    }
  }

  private async poll(now: Date): Promise<void> {
    const open = this.open!;
    // No poll may run into the decision (docs/chess.md, "The move").
    const room = Date.parse(open.decideAt) - now.getTime() - 1000;
    this.lastPollAt = now.getTime();
    if (room < 1000) return;
    try {
      const q = await within(this.telarchy.readPrices(open.proposal, this.game?.cell ?? null), Math.min(POLL_TIMEOUT_MS, room));
      if (this.open !== open) return;
      open.quotes = { ...(open.quotes ?? {}), ...q };
      this.nameBooks(open);
      open.quotesAt = now.toISOString();
    } catch {
      // keep the last prices: a failed read is not an empty book
    }
  }

  private nameBooks(open: OpenMove): void {
    for (const o of open.options) {
      const id = open.quotes?.[o.id]?.marketId;
      if (id) this.bookNames.set(id, { san: o.label, move: open.move });
    }
  }

  /** docs/chess.md "The feed", `call` and `recentTrades`: on its own timer,
   *  apart from the tick, so a slow read can never delay a decision. Reads
   *  only. A failure keeps the last values. */
  async pollActivity(now: Date): Promise<void> {
    const g = this.game;
    if (!this.telarchy.readActivity || !g || !this.running()) return;
    if (this.activityBusy || now.getTime() - this.activityAt < ACTIVITY_EVERY_MS) return;
    this.activityBusy = true;
    this.activityAt = now.getTime();
    try {
      const a = await within(this.telarchy.readActivity(), ACTIVITY_TIMEOUT_MS);
      if (this.game !== g) return;
      if (a.call) this.call = { marketId: a.call.marketId, value: a.call.value, history: a.call.history.filter(p => p.at >= g.startedAt).slice(-CALL_POINTS) };
      const main = a.call?.marketId ?? this.call?.marketId ?? null;
      const rows: TradeRecord[] = [];
      for (const t of a.trades) {
        if (t.at < g.startedAt) continue;
        const named = this.bookNames.get(t.marketId);
        if (!named && t.marketId !== main) continue;
        rows.push({
          id: t.id, at: t.at, handle: t.handle, side: t.side, direction: t.direction, credits: t.credits,
          book: named ? 'move' : 'game', san: named?.san ?? null, move: named?.move ?? null, price: t.price,
        });
      }
      const seen = new Set(rows.map(r => r.id));
      this.recentTrades = [...rows, ...this.recentTrades.filter(r => !seen.has(r.id))]
        .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, TRADES_KEPT);
      this.activityError = null;
    } catch (e) {
      // keep the last call and trades; say why once, not every five seconds
      const why = (e as Error)?.message ?? String(e);
      if (why !== this.activityError) console.error(`activity: ${why}`);
      this.activityError = why;
    } finally {
      this.activityBusy = false;
    }
  }

  private async close(now: Date): Promise<void> {
    const open = this.open!;
    let quotes: Prices = open.quotes ?? {};
    try {
      quotes = await within(this.telarchy.readPrices(open.proposal, this.game?.cell ?? null), DECIDE_READ_MS);
      open.quotes = quotes;
      this.nameBooks(open);
      open.quotesAt = now.toISOString();
    } catch {
      // the decision falls on the last polled prices
    }
    if (this.open !== open) return;
    const d = decide(open.options.map(o => ({ id: o.id, price: quotes[o.id]?.price ?? null })), this.rng);
    const byId = (id: string) => open.options.find(o => o.id === id)!;
    if (d.kind === 'market') {
      try {
        await this.telarchy.approveOption(open.proposal, d.chosen);
        return this.play(byId(d.chosen), { kind: 'market', price: quotes[d.chosen]?.price ?? null, tied: d.tied, reason: null }, open.move, now);
      } catch (e) {
        await this.decline(open.proposal, now);
        return this.play(this.randomOf(open.options), { kind: 'undecided', price: null, tied: 0, reason: `approve of ${d.chosen} failed: ${(e as Error).message}` }, open.move, now);
      }
    }
    await this.decline(open.proposal, now);
    return this.play(byId(d.chosen), { kind: 'undecided', price: null, tied: 0, reason: d.reason }, open.move, now);
  }

  private async decline(ref: ProposalRef, now: Date): Promise<void> {
    let queued = this.pendingDeclines.find(x => x.ref.id === ref.id);
    if (!queued) {
      queued = { ref, nextTryAt: now.getTime() };
      this.pendingDeclines.push(queued);
    }
    queued.nextTryAt = now.getTime() + 60_000;
    try {
      await this.telarchy.declineProposal(ref);
      this.pendingDeclines = this.pendingDeclines.filter(x => x.ref.id !== ref.id);
    } catch (e) {
      console.error(`decline ${ref.id}, retained for retry: ${(e as Error).message}`);
    }
  }

  // ---- the end ----------------------------------------------------------

  private async finish(now: Date): Promise<void> {
    const g = this.game!;
    g.endedAt = now.toISOString();
    this.accountAt = 0; // the record moves with the result: read it on the next tick
    g.result = scoreOf({ status: g.status, winner: g.winner }, g.color);
    this.syncSummary();
    if (this.open) {
      const ref = this.open.proposal;
      this.open = null;
      await this.decline(ref, now);
    }
    if (g.result === null) {
      this.idleSince = now.getTime();
      return;
    }
    const word = g.result === 100 ? 'win' : g.result === 50 ? 'draw' : 'loss';
    try { await this.telarchy.postReading(g.result, now); } catch (e) { console.error(`reading: ${(e as Error).message}`); }
    this.settlement = { value: g.result, reason: `Game ${g.number} vs ${g.opponent.name}: ${word}`, at: now.toISOString(), nextTryAt: now.getTime() };
    await this.trySettle(now);
  }

  /** docs/chess.md "The end settles it": retried every minute, and nothing new
   *  starts until it has gone through. */
  private async trySettle(now: Date): Promise<void> {
    if (this.pendingDeclines.length) return;
    const s = this.settlement!;
    try {
      await this.telarchy.settleMetric(s.value, new Date(s.at), s.reason);
      this.settlement = null;
      this.idleSince = now.getTime();
    } catch (e) {
      s.nextTryAt = now.getTime() + SETTLE_RETRY_MS;
      console.error(`settle (${s.reason}): ${(e as Error).message}`);
    }
  }

  // ---- seeking ----------------------------------------------------------

  private async seek(now: Date): Promise<void> {
    if (this.pendingDeclines.length || !this.opts.seek || this.running() || this.settlement || this.paused || this.open) return;
    const t = now.getTime();
    if (this.idleSince === null) this.idleSince = t;
    if (this.challengeOut) {
      if (t - this.challengeOut.sentAt >= CHALLENGE_WAIT_MS) {
        const id = this.challengeOut.id;
        this.challengeOut = null;
        this.nextSeekAt = t + SEEK_GAP_MS;
        try { await this.lichess.cancelChallenge(id); } catch (e) { console.error(`cancel ${id}: ${(e as Error).message}`); }
      }
      return;
    }
    if (t - this.idleSince < SEEK_IDLE_MS || t < this.nextSeekAt) return;
    try {
      this.player = await this.lichess.account();
      const target = pickOpponent(await this.lichess.onlineBots(), this.player, this.recentOpponents, this.rng);
      if (!target) {
        // docs/chess.md "Opponents": an empty search says why, so a player that finds no games is never silent.
        const me = this.player;
        console.error(`seek: nobody to challenge at rating ${me.rating}${me.provisional ? '?' : ''}, within ${SEEK_MAX_BAND} of it, the last opponent excluded`);
        this.nextSeekAt = t + CHALLENGE_WAIT_MS;
        return;
      }
      this.remember(target);
      const { id } = await this.lichess.challenge(target, SEEK_CLOCK);
      this.challengeOut = { id, username: target, sentAt: t };
    } catch (e) {
      this.nextSeekAt = t + CHALLENGE_WAIT_MS;
      console.error(`seek: ${(e as Error).message}`);
    }
  }

  /** docs/chess.md "The search pauses": once a minute while paused, the
   *  refresh call a move needs; success clears the mark, failure is logged. */
  private async probe(now: Date): Promise<void> {
    this.probeAt = now.getTime();
    try {
      await within(this.telarchy.refreshBooks(), 20_000);
      console.error(`probe: platform answers again, the search resumes (paused since ${this.paused?.since})`);
      this.paused = null;
    } catch (e) {
      console.error(`probe: platform still down since ${this.paused?.since}: ${(e as Error).message}`);
    }
  }

  /** docs/chess.md "The feed": once a minute and right after a game ends; a failed read keeps the last record. */
  private async readAccount(now: Date): Promise<void> {
    this.accountAt = now.getTime();
    try {
      this.player = await this.lichess.account();
    } catch (e) {
      console.error(`account: ${(e as Error).message}`);
    }
  }

  private remember(id: string): void {
    const key = id.toLowerCase();
    if (!key) return;
    this.recentOpponents = [key, ...this.recentOpponents.filter(x => x !== key)].slice(0, RECENT_OPPONENTS);
  }

  // ---- restart ----------------------------------------------------------

  /** docs/chess.md "Operation": a proposal left open by a restart is declined
   *  with refund; the event stream then replays the game and a fresh one is posted. */
  async resume(now: Date): Promise<void> {
    if (!this.open) return;
    const ref = this.open.proposal;
    this.open = null;
    await this.decline(ref, now);
  }

  toJSON() {
    return {
      game: this.game, open: this.open, recentDecisions: this.recentDecisions, games: this.games,
      settlement: this.settlement, playedPly: this.playedPly, recentOpponents: this.recentOpponents,
      plies: this.plies, pendingDeclines: this.pendingDeclines, paused: this.paused,
    };
  }

  static fromJSON(telarchy: TelarchyClient, lichess: LichessClient, rng: Rng, opts: OperatorOptions, raw: ReturnType<Operator['toJSON']>): Operator {
    const op = new Operator(telarchy, lichess, rng, opts);
    op.game = raw.game ?? null;
    op.open = raw.open ?? null;
    op.recentDecisions = raw.recentDecisions ?? [];
    op.games = raw.games ?? [];
    op.settlement = raw.settlement ?? null;
    op.playedPly = raw.playedPly ?? null;
    op.recentOpponents = raw.recentOpponents ?? [];
    op.plies = raw.plies ?? {};
    op.pendingDeclines = raw.pendingDeclines ?? [];
    op.paused = raw.paused ?? null;
    return op;
  }

  // ---- the feed ---------------------------------------------------------

  private summary(g: GameRecord) {
    const { moves, clocks: _c, inc: _i, ...rest } = g;
    return { ...rest, plies: moves.length };
  }
  private syncSummary(): void {
    const g = this.game;
    if (!g) return;
    const i = this.games.findIndex(x => x.id === g.id);
    if (i >= 0) this.games[i] = this.summary(g);
  }

  publicState(now: Date) {
    const g = this.game;
    const open = this.open;
    const phase = open ? 'our-move' : this.running() ? 'their-move' : this.settlement ? 'settling' : this.paused ? 'paused' : 'seeking';
    return {
      schema: 1,
      phase,
      // docs/chess.md "The search pauses": why no game is sought, or null.
      paused: this.paused,
      player: this.player,
      game: g && {
        number: g.number, id: g.id, url: `https://lichess.org/${g.id}`, color: g.color, opponent: g.opponent,
        rated: g.rated, clock: g.clock, fen: safeFen(g.moves), moves: g.moves,
        turn: g.moves.length % 2 === 0 ? 'white' : 'black', clocks: g.clocks,
        status: g.status, result: g.result, startedAt: g.startedAt, endedAt: g.endedAt,
      },
      open: open && {
        move: open.move, proposal: open.proposal, openedAt: open.openedAt, decideAt: open.decideAt, deadline: open.deadline,
        tradeable: now.getTime() < Date.parse(open.deadline),
        quotesAt: open.quotesAt,
        options: open.options.map(o => {
          if (!open.quotes) return { id: o.id, san: o.label, price: null, lead: null, marketId: null, reason: 'not polled yet' };
          const q = open.quotes[o.id];
          if (q && typeof q.price === 'number' && Number.isFinite(q.price)) {
            return { id: o.id, san: o.label, price: q.price, lead: q.lead ?? null, marketId: q.marketId ?? null };
          }
          return { id: o.id, san: o.label, price: null, lead: null, marketId: q?.marketId ?? null, reason: 'no price' };
        }),
      },
      cell: g?.cell ?? null,
      cellEndsAt: g && g.cell !== 'until-settled' ? new Date(Date.parse(`${g.cell}:00Z`) + 60_000).toISOString() : null,
      call: this.call,
      recentTrades: this.recentTrades,
      recentDecisions: this.recentDecisions,
      rules: {
        windowSeconds: { min: WINDOW.min, max: WINDOW.max, firstMove: WINDOW.firstMove },
        decideBeforeDeadlineSeconds: 2, tieBreak: 'random', noPrice: 'random legal move',
        clockGuardSeconds: WINDOW.clockGuardSeconds,
      },
      rule: RULE,
      trade: {
        base: this.opts.tradeBase ?? 'https://telarchy.com/api', endpoint: 'POST /api/predictions/trade',
        auth: 'X-Agent-Key', workspaceHeader: 'X-Workspace-Id', workspaceId: this.opts.workspaceId,
        rangeMin: 0, rangeMax: 100,
      },
    };
  }

  /** GET /history: one game's plies with our decisions laid on. */
  history(game: number | 'current') {
    const g = game === 'current' ? this.games.at(-1) : this.games.find(x => x.number === game);
    if (!g) return null;
    return { game: g, plies: this.plies[g.number] ?? [] };
  }
}

function legalSanOfLast(moves: string[]): string {
  const prev = moves.slice(0, -1);
  const last = moves.at(-1)!;
  return legalOptions(fenAfter(prev)).find(o => o.id === last)?.label ?? last;
}

function safeFen(moves: string[]): string | null {
  try { return fenAfter(moves); } catch { return null; }
}

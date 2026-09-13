// The stream frame, docs/chess.md "The stream": the snake stream's dark frame
// with the game's board in it, drawn in-process with @napi-rs/canvas, no
// browser. Every face (Inter, Fraunces, JetBrains Mono, and Noto Sans Symbols 2
// for the pieces) is bundled under fonts/ and the lockup under assets/; nothing
// is read from the system or the network.
import { type Canvas, createCanvas, GlobalFonts, Image, type SKRSContext2D } from '@napi-rs/canvas';
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WIDTH = 1280;
export const HEIGHT = 720;
/** Every face the frame sets, by role. */
export const FONTS = { sans: 'Inter', serif: 'Fraunces', mono: 'JetBrains Mono', pieces: 'Noto Sans Symbols 2' } as const;
type Face = keyof typeof FONTS;
for (const [file, family] of [
  ['Inter-Regular.ttf', FONTS.sans],
  ['Inter-SemiBold.ttf', FONTS.sans],
  ['Fraunces-Medium.ttf', FONTS.serif],
  ['Fraunces-Bold.ttf', FONTS.serif],
  ['JetBrainsMono-Medium.ttf', FONTS.mono],
  ['JetBrainsMono-SemiBold.ttf', FONTS.mono],
  ['NotoSansSymbols2-Regular.ttf', FONTS.pieces],
] as const) {
  GlobalFonts.registerFromPath(fileURLToPath(new URL(`../fonts/${file}`, import.meta.url)), family);
}

const logo = new Image();
logo.src = readFileSync(fileURLToPath(new URL('../assets/logo-lockup-dark.png', import.meta.url)));
const LOGO_NATURAL = { w: logo.naturalWidth || logo.width, h: logo.naturalHeight || logo.height };
const LOGO_H = 18;

/** The one call to action. */
export const LINK_TEXT = 'telarchy.com/chess';
export const QUESTION = 'What will I score in this game?';

const BG = '#101013';
const LINE = '#2a2a32';
const FG = '#f2ecdc';
const FG2 = '#b5b1a3';
const MUTE = '#97938c';
const GREEN = '#4ade80';
const RED = '#f87171';
const ACCENT = '#f59e0b';
const BONE = '#f2ecdc';
const SQ_LIGHT = '#efe8d6';
const SQ_DARK = '#d6ccb2';
const LAST_LIGHT = '#e6d28a';
const LAST_DARK = '#d2bb6a';
const COORD = '#6b6b7a';
const PIECE_WHITE = '#fbf9f4';
const PIECE_BLACK = '#17171c';

const MARGIN = 24;
const S = 84;
const BOARD_PX = 8 * S; // 672
/** The right column. */
export const COLUMN = { x: MARGIN + BOARD_PX + 40, w: WIDTH - (MARGIN + BOARD_PX + 40) - MARGIN } as const; // 736, 520
const X = COLUMN.x;
const W = COLUMN.w;
const RIGHT = X + W;
const LAYOUT = { statsTop: 164, statsBottom: 262, labelBaseline: 190, valueBaseline: 240, recordBaseline: 290, panelLabelBaseline: 330, rowsTop: 342, rowHeight: 44, moreBaseline: 590, linkTop: 612 } as const;

const FILES = 'abcdefgh';
type Color = 'white' | 'black';
const colorOf = (c: unknown): Color => (c === 'black' ? 'black' : 'white');
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Can this payload be drawn (docs/chess.md, "The stream")? A feed state is an
 * object with a string `phase`; anything else (a failed read's error object, a
 * proxy's HTML) holds the last good frame. `game: null` is a real state.
 */
export function isDrawableState(s: unknown): boolean {
  return !!s && typeof s === 'object' && !Array.isArray(s) && typeof (s as { phase?: unknown }).phase === 'string';
}

/** The pieces of a FEN by square ("e1" -> "K"); empty for anything that is not a board. */
export function piecesOf(fen: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof fen !== 'string') return out;
  const ranks = fen.split(' ')[0].split('/');
  if (ranks.length !== 8) return out;
  for (let i = 0; i < 8; i++) {
    let f = 0;
    for (const ch of ranks[i]) {
      if (/[1-8]/.test(ch)) f += Number(ch);
      else if (/[kqrbnp]/i.test(ch)) { if (f < 8) out.set(`${FILES[f]}${8 - i}`, ch); f += 1; }
      else return new Map();
    }
    if (f !== 8) return new Map();
  }
  return out;
}

/** Where a square is drawn, seen from `color`'s side. */
export function squareRect(square: string, color: string) {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  const white = colorOf(color) === 'white';
  return { x: MARGIN + (white ? f : 7 - f) * S, y: MARGIN + (white ? 8 - r : r - 1) * S, w: S, h: S };
}
const isDark = (square: string) => (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 1;

/** The floor's shading of a mark by its standing among the drawn ones. */
function leadOpacities(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0.55);
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return values.map(() => 0.55);
  return values.map(v => Math.round((0.3 + 0.6 * ((v - min) / (max - min))) * 1e6) / 1e6);
}

interface Opt { index: number; id: string; san: string; price: number | null }
function optionsOf(s: any): Opt[] {
  const list: unknown[] = Array.isArray(s?.open?.options) ? s.open.options : [];
  const out: Opt[] = [];
  list.forEach((o: any, index) => {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string') return;
    out.push({ index, id: o.id, san: typeof o.san === 'string' ? o.san : o.id, price: isNum(o.price) ? o.price : null });
  });
  return out;
}
/** Priced first, highest first, ties in proposal order; unpriced after, in proposal order. */
function ranked(opts: Opt[]): Opt[] {
  const priced = opts.filter(o => o.price !== null).sort((a, b) => (b.price! - a.price!) || (a.index - b.index));
  return [...priced, ...opts.filter(o => o.price === null)];
}
/** The leader is the strictly highest price; a tie at the top has none. */
function leaderId(opts: Opt[]): string | null {
  const r = ranked(opts).filter(o => o.price !== null);
  if (r.length === 0) return null;
  if (r.length > 1 && r[1].price === r[0].price) return null;
  return r[0].id;
}

/** The three highest-priced moves drawn as arrows while a move is open. */
export function topArrows(s: any): Array<{ uci: string; from: string; to: string; san: string; price: number; opacity: number; leader: boolean }> {
  if (s?.phase !== 'our-move' || !s?.open) return [];
  const opts = optionsOf(s);
  const lead = leaderId(opts);
  const top = ranked(opts).filter(o => o.price !== null && UCI.test(o.id)).slice(0, 3);
  const shades = leadOpacities(top.map(o => o.price!));
  return top.map((o, i) => ({ uci: o.id, from: o.id.slice(0, 2), to: o.id.slice(2, 4), san: o.san, price: o.price!, opacity: shades[i], leader: o.id === lead }));
}

/** The panel's Top moves: up to `n` rows, the leader marked, how many more, how many legal. */
export function rankedMoves(s: any, n = 5): { rows: Array<{ san: string; price: number | null; leader: boolean }>; more: number; legal: number } {
  const opts = optionsOf(s);
  const lead = leaderId(opts);
  const rows = ranked(opts).slice(0, n).map(o => ({ san: o.san, price: o.price, leader: o.id === lead }));
  return { rows, more: opts.length - rows.length, legal: opts.length };
}

/** The game's moves as numbered SAN pairs, newest first, stopping at the first move that does not play. */
export function movePairs(moves: unknown, n = Infinity): Array<{ n: number; white: string; black: string | null }> {
  const list: unknown[] = Array.isArray(moves) ? moves : [];
  const chess = new Chess();
  const sans: string[] = [];
  for (const m of list) {
    if (typeof m !== 'string' || !UCI.test(m)) break;
    try {
      sans.push(chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }).san);
    } catch { break; }
  }
  const pairs: Array<{ n: number; white: string; black: string | null }> = [];
  for (let i = 0; i < sans.length; i += 2) pairs.push({ n: i / 2 + 1, white: sans[i], black: sans[i + 1] ?? null });
  return pairs.reverse().slice(0, n);
}

/** A clock: m:ss, h:mm:ss from an hour, never below 0:00. */
export function clockText(ms: number): string {
  const secs = Math.floor((isNum(ms) && ms > 0 ? ms : 0) / 1000);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), ss = String(secs % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function ended(g: any): boolean {
  if (!g) return true;
  if (g.endedAt) return true;
  if (g.result === 0 || g.result === 50 || g.result === 100) return true;
  return typeof g.status === 'string' && g.status !== 'started' && g.status !== 'created';
}

/** Both clocks at `now`: the side to move counts down from when the feed's clocks were last true. */
export function clocksAt(s: any, now: number): { white: number | null; black: number | null; ticking: Color | null } {
  const g = s?.game;
  const white = isNum(g?.clocks?.white) ? g.clocks.white : null;
  const black = isNum(g?.clocks?.black) ? g.clocks.black : null;
  const out = { white, black, ticking: null as Color | null };
  if (!g || ended(g)) return out;
  const ours = colorOf(g.color);
  const theirs: Color = ours === 'white' ? 'black' : 'white';
  let side: Color | null = null;
  let since = NaN;
  if (s.phase === 'our-move' && s.open) {
    side = ours;
    since = Date.parse(s.open.openedAt);
  } else if (s.phase === 'their-move') {
    side = theirs;
    const mine = (Array.isArray(s.recentDecisions) ? s.recentDecisions : []).find((d: any) => d && d.game === g.number);
    since = mine ? Date.parse(mine.at) : NaN;
  }
  if (!side || !Number.isFinite(since) || out[side] === null) return out;
  out[side] = Math.max(0, out[side]! - Math.max(0, now - since));
  out.ticking = side;
  return out;
}

type Tone = 'accent' | 'green' | 'red' | 'fg' | 'mute';
/** The third cell: the state of the move. */
export function nextCell(s: any, now: number): { label: string; value: string; tone: Tone } {
  const g = s?.game;
  if (s?.phase === 'our-move' && s?.open) {
    const left = Date.parse(s.open.decideAt) - now;
    if (!Number.isFinite(left)) return { label: 'Next move', value: '-', tone: 'accent' };
    return { label: 'Next move', value: left <= 0 ? 'deciding' : clockText(Math.ceil(left / 1000) * 1000), tone: 'accent' };
  }
  if (s?.phase === 'their-move') return { label: 'Their move', value: 'thinking', tone: 'mute' };
  const r = g?.result;
  if (r === 100) return { label: 'Game over', value: 'won', tone: 'green' };
  if (r === 0) return { label: 'Game over', value: 'lost', tone: 'red' };
  if (r === 50) return { label: 'Game over', value: 'drawn', tone: 'fg' };
  if (s?.phase === 'settling') return { label: 'Game over', value: 'settling', tone: 'mute' };
  return { label: 'Next game', value: 'seeking', tone: 'mute' };
}

/** The player's record in one line, or null while the feed has no player. */
export function recordLine(p: any): string | null {
  if (!p || typeof p !== 'object') return null;
  const n = (v: unknown) => (isNum(v) ? String(v) : '-');
  const rating = isNum(p.rating) ? `${p.rating}${p.provisional ? '?' : ''}` : '-';
  const games = p.games ?? {};
  return `RATING ${rating} · PLAYED ${n(games.played)} · WON ${n(games.won)} · LOST ${n(games.lost)} · DRAWN ${n(games.drawn)}`;
}

const measurer = createCanvas(1, 1).getContext('2d');
const font = (size: number, weight: number, face: Face) => `${weight} ${size}px "${FONTS[face]}"`;
function measure(s: string, size: number, weight: number, face: Face, spacing = 0): number {
  if (!s) return 0;
  measurer.font = font(size, weight, face);
  return measurer.measureText(s).width + spacing * s.length;
}
/** Cut `s` with a trailing ellipsis so it fits `w` px. */
function clip(s: string, size: number, w: number, weight: number, face: Face, spacing = 0): string {
  if (measure(s, size, weight, face, spacing) <= w) return s;
  let t = s;
  while (t.length > 1 && measure(`${t}…`, size, weight, face, spacing) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export interface DrawnItem { text: string; x: number; y: number; size: number; left: number; right: number }
const TONE: Record<Tone, string> = { accent: ACCENT, green: GREEN, red: RED, fg: FG, mute: MUTE };

/** Draws the frame; every string it sets is pushed onto `items` in order. */
function draw(s: any, now: number, items: DrawnItem[]): Canvas {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const text = (str: string, x: number, y: number, size: number, colour: string, weight: number, face: Face, align: 'left' | 'right' | 'center' = 'left', spacing = 0) => {
    if (!str) return;
    const w = measure(str, size, weight, face, spacing);
    const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    items.push({ text: str, x, y, size, left, right: left + w });
    ctx.font = font(size, weight, face);
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(str, x, y);
    ctx.letterSpacing = '0px';
  };
  const hairline = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = LINE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0 + 0.5); ctx.lineTo(x1 + 0.5, y1 + 0.5); ctx.stroke();
  };
  const label = (str: string, x: number, y: number, maxW: number, align: 'left' | 'right' = 'left') =>
    text(clip(str.toUpperCase(), 13, maxW, 500, 'mono', 1), x, y, 13, MUTE, 500, 'mono', align, 1);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // the link, first, so it is there whatever else fails to draw
  ctx.fillStyle = BONE;
  ctx.beginPath(); ctx.roundRect(X, LAYOUT.linkTop, W, 84, 42); ctx.fill();
  text(LINK_TEXT, X + W / 2, 668, 40, BG, 600, 'sans', 'center');

  if (!isDrawableState(s)) {
    text('Waiting for the feed', X, 120, 34, MUTE, 600, 'sans');
    return canvas;
  }
  const g = s.game && typeof s.game === 'object' ? s.game : null;
  const color = colorOf(g?.color);

  drawBoard(ctx, s, g, color, text);

  // 1. the lockup, small and at its own aspect ratio
  if (LOGO_NATURAL.w > 0) ctx.drawImage(logo, X, 28, (LOGO_H * LOGO_NATURAL.w) / LOGO_NATURAL.h, LOGO_H);

  // 2. the name and the question
  text('Chess', X, 108, 44, FG, 700, 'serif');
  text(QUESTION, X, 140, 22, FG2, 500, 'serif');

  // 3. three cells: our clock, their clock, the state of the move
  const third = W / 3;
  const cellX = (i: number) => X + i * third + (i === 0 ? 0 : 16);
  const cellW = (i: number) => third - (i === 0 ? 16 : 32);
  hairline(X, LAYOUT.statsTop, RIGHT, LAYOUT.statsTop);
  hairline(X, LAYOUT.statsBottom, RIGHT, LAYOUT.statsBottom);
  hairline(X + third, LAYOUT.statsTop, X + third, LAYOUT.statsBottom);
  hairline(X + 2 * third, LAYOUT.statsTop, X + 2 * third, LAYOUT.statsBottom);
  const p = s.player && typeof s.player === 'object' ? s.player : null;
  const ours = `${typeof p?.username === 'string' ? p.username : 'TelarchyBot'}${isNum(p?.rating) ? ` ${p.rating}${p.provisional ? '?' : ''}` : ''}`;
  const opp = g?.opponent && typeof g.opponent === 'object' ? g.opponent : null;
  const theirs = opp ? `${typeof opp.name === 'string' ? opp.name : '?'}${isNum(opp.rating) ? ` ${opp.rating}` : ''}` : 'Opponent';
  const clocks = clocksAt(s, now);
  const theirColor: Color = color === 'white' ? 'black' : 'white';
  const clockValue = (i: number, side: Color) => {
    const v = clocks[side];
    text(v === null ? '-' : clockText(v), cellX(i), LAYOUT.valueBaseline, 36, clocks.ticking === side ? FG : FG2, 600, 'mono');
  };
  label(ours, cellX(0), LAYOUT.labelBaseline, cellW(0));
  clockValue(0, color);
  label(theirs, cellX(1), LAYOUT.labelBaseline, cellW(1));
  clockValue(1, theirColor);
  const cell = nextCell(s, now);
  label(cell.label, cellX(2), LAYOUT.labelBaseline, cellW(2));
  const big = /^[\d:-]+$/.test(cell.value);
  text(cell.value, cellX(2), big ? LAYOUT.valueBaseline : LAYOUT.valueBaseline - 4, big ? 36 : 26, TONE[cell.tone], 600, 'mono');

  // 4. the record
  const record = recordLine(p);
  if (record) text(clip(record, 13, W, 500, 'mono', 1), X, LAYOUT.recordBaseline, 13, MUTE, 500, 'mono', 'left', 1);

  // 5. the panel
  const rowTop = (i: number) => LAYOUT.rowsTop + i * LAYOUT.rowHeight;
  const rowBase = (i: number) => rowTop(i) + 30;
  if (!g) {
    text('Waiting for the first game', X, rowBase(0), 20, FG2, 400, 'sans');
  } else if (s.phase === 'our-move' && s.open) {
    const r = rankedMoves(s);
    label('Top moves', X, LAYOUT.panelLabelBaseline, W / 2);
    label(`${r.legal} legal`, RIGHT, LAYOUT.panelLabelBaseline, W / 2, 'right');
    r.rows.forEach((row, i) => {
      hairline(X, rowTop(i), RIGHT, rowTop(i));
      const tone = row.leader ? GREEN : FG;
      text(String(i + 1), X, rowBase(i), 15, MUTE, 500, 'mono');
      const price = row.price === null ? '-' : row.price.toFixed(1);
      const priceW = measure(price, 22, 600, 'mono');
      text(price, RIGHT, rowBase(i), 22, row.leader ? GREEN : FG2, 600, 'mono', 'right');
      text(clip(row.san, 22, RIGHT - priceW - 16 - (X + 36), 600, 'sans'), X + 36, rowBase(i), 22, tone, 600, 'sans');
    });
    if (r.more > 0) text(`+${r.more} more`, X + 36, LAYOUT.moreBaseline, 15, MUTE, 400, 'sans');
  } else {
    label(`Game ${isNum(g.number) ? g.number : ''}`.trim(), X, LAYOUT.panelLabelBaseline, W);
    movePairs(g.moves, 5).forEach((pair, i) => {
      hairline(X, rowTop(i), RIGHT, rowTop(i));
      text(`${pair.n}.`, X, rowBase(i), 15, MUTE, 500, 'mono');
      text(clip(pair.white, 22, 150, 600, 'sans'), X + 64, rowBase(i), 22, FG, 600, 'sans');
      if (pair.black) text(clip(pair.black, 22, 150, 600, 'sans'), X + 240, rowBase(i), 22, FG, 600, 'sans');
    });
  }
  return canvas;
}

type TextFn = (str: string, x: number, y: number, size: number, colour: string, weight: number, face: Face, align?: 'left' | 'right' | 'center', spacing?: number) => void;

function drawBoard(ctx: SKRSContext2D, s: any, g: any, color: Color, text: TextFn) {
  const last = Array.isArray(g?.moves) ? g.moves.at(-1) : null;
  const tinted = typeof last === 'string' && UCI.test(last) ? [last.slice(0, 2), last.slice(2, 4)] : [];
  for (const f of FILES) for (let r = 1; r <= 8; r++) {
    const sq = `${f}${r}`;
    const rect = squareRect(sq, color);
    const dark = isDark(sq);
    ctx.fillStyle = tinted.includes(sq) ? (dark ? LAST_DARK : LAST_LIGHT) : (dark ? SQ_DARK : SQ_LIGHT);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // coordinates: file letters in the bottom row's corners, rank numbers in the left column's
  for (let i = 0; i < 8; i++) {
    const file = color === 'white' ? FILES[i] : FILES[7 - i];
    text(file, MARGIN + i * S + S - 5, MARGIN + BOARD_PX - 5, 14, COORD, 500, 'mono', 'right');
    const rank = String(color === 'white' ? 8 - i : i + 1);
    text(rank, MARGIN + 5, MARGIN + i * S + 17, 14, COORD, 500, 'mono', 'left');
  }
  const fen = g ? g.fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  ctx.font = `${Math.round(S * 0.74)}px "${FONTS.pieces}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const [sq, piece] of piecesOf(fen)) {
    const rect = squareRect(sq, color);
    const cx = rect.x + S / 2, cy = rect.y + S / 2 + S * 0.25;
    const glyph = GLYPH[piece.toLowerCase()];
    if (piece === piece.toUpperCase()) {
      ctx.strokeStyle = PIECE_BLACK; ctx.lineWidth = 2.6;
      ctx.strokeText(glyph, cx, cy);
      ctx.fillStyle = PIECE_WHITE;
    } else {
      ctx.fillStyle = PIECE_BLACK;
    }
    ctx.fillText(glyph, cx, cy);
  }
  // the top three moves: arrows in the accent, then their price tags
  const arrows = topArrows(s);
  const centre = (sq: string) => { const r = squareRect(sq, color); return [r.x + S / 2, r.y + S / 2] as const; };
  for (const a of arrows) {
    const [x1, y1] = centre(a.from), [x2, y2] = centre(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) continue;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const head = S * 0.32, halfHead = S * 0.2, tipX = x2 - ux * S * 0.06, tipY = y2 - uy * S * 0.06;
    const baseX = tipX - ux * head, baseY = tipY - uy * head;
    ctx.save();
    ctx.globalAlpha = a.opacity;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    const half = S * 0.06;
    const sx = x1 + ux * S * 0.18, sy = y1 + uy * S * 0.18;
    ctx.moveTo(sx - uy * half, sy + ux * half);
    ctx.lineTo(baseX - uy * half, baseY + ux * half);
    ctx.lineTo(baseX - uy * halfHead, baseY + ux * halfHead);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + uy * halfHead, baseY - ux * halfHead);
    ctx.lineTo(baseX + uy * half, baseY - ux * half);
    ctx.lineTo(sx + uy * half, sy - ux * half);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (const a of arrows) {
    const [cx, cy] = centre(a.to);
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = PIECE_BLACK;
    ctx.beginPath(); ctx.roundRect(cx - S * 0.42, cy + S * 0.12, S * 0.84, S * 0.3, S * 0.06); ctx.fill();
    ctx.restore();
    text(a.price.toFixed(1), cx, cy + S * 0.35, 18, a.leader ? GREEN : FG, 600, 'mono', 'center');
  }
}

/** The RGB bytes ffmpeg takes, out of the canvas. */
function toRgb(canvas: Canvas): Buffer {
  const rgba = canvas.data();
  const out = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; }
  return out;
}

/** The frame at `now`, as the raw RGB bytes the stream pipes to ffmpeg. */
export function renderFrame(s: any, now: number = Date.now()): Buffer {
  return toRgb(draw(s, now, []));
}

/** The frame at `now` as a PNG, for previews. */
export function renderPng(s: any, now: number = Date.now()): Buffer {
  return draw(s, now, []).toBuffer('image/png');
}

/** Every string the frame at `now` sets, in order (for the tests' scans). */
export function drawnTexts(s: any, now: number = Date.now()): string[] {
  return drawnItems(s, now).map(i => i.text);
}

/** Every string the frame sets with where it lands. */
export function drawnItems(s: any, now: number = Date.now()): DrawnItem[] {
  const items: DrawnItem[] = [];
  draw(s, now, items);
  return items;
}

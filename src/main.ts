// The process (docs/chess.md, "Operation"): the Lichess event stream, one game
// stream at a time, the operator's clock, the feed, and the state file.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Operator } from './operator.js';
import { HttpTelarchyClient } from './telarchy.js';
import { HttpLichessClient } from './lichess.js';
import { createServer } from './server.js';

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const BASE = env('TELARCHY_BASE_URL', 'https://telarchy.com/api');
const KEY = env('TELARCHY_API_KEY', '');
const SESSION_EMAIL = process.env.TELARCHY_SESSION_EMAIL;
if (!KEY && !SESSION_EMAIL) throw new Error('set TELARCHY_API_KEY or TELARCHY_SESSION_EMAIL/PASSWORD');
const STATE = env('STATE_FILE', 'state/chess.json');
const PORT = Number(env('PORT', '8803'));
const LICHESS_TOKEN = env('LICHESS_TOKEN');
const USERNAME = env('LICHESS_USERNAME', 'TelarchyBot');
const SEEK = env('SEEK', 'on') !== 'off';
const WS = env('TELARCHY_WORKSPACE_ID');

const telarchy = new HttpTelarchyClient({
  baseUrl: BASE,
  apiKey: KEY,
  workspaceId: WS,
  metricId: env('TELARCHY_METRIC_ID'),
  workspaceUrl: env('WORKSPACE_URL', 'https://telarchy.com/chess'),
  branch: process.env.TELARCHY_BRANCH || undefined,
  session: SESSION_EMAIL
    ? { email: SESSION_EMAIL, password: env('TELARCHY_SESSION_PASSWORD', ''), authUrl: env('TELARCHY_AUTH_URL', 'https://telarchy.com/api') }
    : undefined,
});
const lichess = new HttpLichessClient(LICHESS_TOKEN);
const opts = { username: USERNAME, seek: SEEK, workspaceId: WS, tradeBase: BASE };

function load(): Operator {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    console.log('resuming from state file');
    return Operator.fromJSON(telarchy, lichess, Math.random, opts, raw);
  } catch {
    console.log('fresh start');
    return new Operator(telarchy, lichess, Math.random, opts);
  }
}
function save(op: Operator): void {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  const tmp = `${STATE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(op.toJSON()));
  fs.renameSync(tmp, STATE);
}

const op = load();

/** Every call into the operator runs one at a time, events and clock alike,
 *  so a game's end can never land in the middle of a decision. */
let chain: Promise<void> = Promise.resolve();
let queued = 0;
function serial(fn: () => Promise<void>): Promise<void> {
  queued++;
  chain = chain
    .then(fn)
    .catch(e => console.error(`operator: ${(e as Error).stack ?? e}`))
    .finally(() => { queued--; save(op); });
  return chain;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const streaming = new Set<string>();
async function followGame(gameId: string): Promise<void> {
  if (streaming.has(gameId)) return;
  streaming.add(gameId);
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        for await (const ev of await lichess.gameStream(gameId)) {
          const now = new Date();
          if (ev.type === 'gameFull') await serial(() => op.onGameFull(ev, now));
          else if (ev.type === 'gameState') await serial(() => op.onGameState(ev, now));
          else if (ev.type === 'opponentGone') await serial(() => op.onOpponentGone(ev, now));
        }
      } catch (e) {
        console.error(`game stream ${gameId}: ${(e as Error).message}`);
      }
      // The stream ends when the game does; stop once the operator has recorded the end.
      if (!op.game || op.game.id !== gameId || op.game.endedAt) return;
      await sleep(3000);
    }
  } finally {
    streaming.delete(gameId);
  }
}

async function followEvents(): Promise<never> {
  for (;;) {
    try {
      for await (const ev of await lichess.events()) {
        const now = new Date();
        if (ev.type === 'challenge') void serial(() => op.onChallenge(ev.challenge, now));
        else if (ev.type === 'challengeDeclined' || ev.type === 'challengeCanceled') op.onChallengeGone(ev.challenge?.id, now);
        else if (ev.type === 'gameStart' && ev.game?.id) void followGame(ev.game.id);
      }
    } catch (e) {
      console.error(`event stream: ${(e as Error).message}`);
    }
    await sleep(5000);
  }
}

createServer(op).listen(PORT, '127.0.0.1', () => console.log(`feed on 127.0.0.1:${PORT}`));

await serial(() => op.resume(new Date()));
void followEvents();
setInterval(() => { if (queued === 0) void serial(() => op.tick(new Date())); }, 500);

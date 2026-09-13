#!/usr/bin/env node
// The Telarchy half of docs/chess.md on a real store, no Lichess: set the game's
// cell, post one move with every legal move of the start position as options,
// read the prices, choose one, and settle a game result. Run after `npm run build`
// with the service's env (the beta store takes the admin session and branch cookie).
//
//   set -a; . keyring/telarchy/chess-beta.env; . keyring/telarchy/admin.env; set +a
//   TELARCHY_SESSION_EMAIL=$ADMIN_EMAIL TELARCHY_SESSION_PASSWORD=$ADMIN_PASSWORD node scripts/smoke-beta.mjs
import { HttpTelarchyClient } from '../dist/telarchy.js';
import { legalOptions, fenAfter, horizonCell, proposalTitle } from '../dist/rules.js';

const env = k => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const c = new HttpTelarchyClient({
  baseUrl: env('TELARCHY_BASE_URL'),
  apiKey: process.env.TELARCHY_API_KEY ?? '',
  workspaceId: env('TELARCHY_WORKSPACE_ID'),
  metricId: env('TELARCHY_METRIC_ID'),
  workspaceUrl: env('WORKSPACE_URL'),
  branch: process.env.TELARCHY_BRANCH || undefined,
  session: process.env.TELARCHY_SESSION_EMAIL
    ? { email: env('TELARCHY_SESSION_EMAIL'), password: env('TELARCHY_SESSION_PASSWORD'), authUrl: process.env.TELARCHY_AUTH_URL ?? 'https://telarchy.com/api' }
    : undefined,
});

const step = async (name, fn) => {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`ok   ${name} (${Date.now() - t} ms)${r === undefined ? '' : `: ${typeof r === 'string' ? r : JSON.stringify(r)}`}`);
    return r;
  } catch (e) {
    console.log(`FAIL ${name} (${Date.now() - t} ms): ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
};

const cell = horizonCell(new Date());
await step(`set horizon ${cell}`, () => c.setHorizon(cell));
await step('refresh books', () => c.refreshBooks());
const options = legalOptions(fenAfter([]));
const ref = await step(`post a proposal with ${options.length} options`, () =>
  c.postProposal(proposalTitle(0, 1), 'Smoke test of the chess operator on the beta store (scripts/smoke-beta.mjs). Not a real game.', new Date(Date.now() + 50_000), options));
const prices = await step('read prices', async () => {
  const p = await c.readPrices(ref, cell);
  const priced = Object.values(p).filter(x => typeof x.price === 'number').length;
  const withMarket = Object.values(p).filter(x => x.marketId).length;
  return `${Object.keys(p).length} options read, ${priced} priced, ${withMarket} with a market id`;
});
await step('approve e2e4', () => c.approveOption(ref, 'e2e4'));
await step('post the result reading', () => c.postReading(50, new Date()));
await step('settle the metric at 50', () => c.settleMetric(50, new Date(), 'Smoke test: draw'));
console.log(`proposal ${ref.url}`);
void prices;

#!/usr/bin/env node
// Provision the Chess workspace and its Game score metric on one Telarchy store
// (docs/chess.md, "The workspace"), signed in as a browser account because the
// beta store is admin-gated and refuses agent keys. Prints the env lines the
// service needs. Stops if a workspace named Chess already exists for the account.
//
//   BASE=https://telarchy.com/beta/api AUTH_URL=https://telarchy.com/api \
//   EMAIL=... PASSWORD=... BRANCH=br-many-option-proposals node scripts/provision.mjs

const { BASE, AUTH_URL = 'https://telarchy.com/api', EMAIL, PASSWORD, BRANCH } = process.env;
if (!BASE || !EMAIL || !PASSWORD) throw new Error('set BASE, EMAIL and PASSWORD');

const signIn = await fetch(`${AUTH_URL}/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: new URL(AUTH_URL).origin },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!signIn.ok) throw new Error(`sign-in -> ${signIn.status}`);
const cookies = signIn.headers.getSetCookie().map(c => c.split(';')[0]);
if (BRANCH) cookies.push(`telarchy_beta_branch=${BRANCH}`);
const cookie = cookies.join('; ');

async function call(method, path, body, workspaceId) {
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

console.error('# creating workspace Chess');
const ws = await call('POST', '/workspaces', { name: 'Chess', visibility: 'public' });
const wsId = ws.id;
const slug = ws.slug;

// A placeholder cell a day out; the operator replaces it with each game's own cell.
const cell = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16);
console.error('# creating metric Game score');
const metric = await call('POST', '/metrics', {
  name: 'Game score',
  description:
    'TelarchyBot\'s result in its current Lichess game, from its own side: 100 for a win, 50 for a draw, 0 for a loss. Every move of the game is a proposal with one option per legal move; the option priced highest is played. The game\'s books settle the moment the game ends.',
  value: 50,
  marketRangeMin: 0,
  marketRangeMax: 100,
  timePreference: { enabled: false, customHorizons: [cell], horizonCredits: { [cell]: { book: 3000, proposal: 100 } } },
}, wsId);

console.error('# settings: one-minute decision window, public, muted, closed to outside proposals');
await call('PUT', `/workspaces/${wsId}/settings`, {
  decisionMinutes: 1,
  visibility: 'public',
  notificationsMuted: true,
  externalProposalsDisabled: true,
  description: 'A Lichess player whose every move is chosen by this market: on its turn every legal move is an option, and the one priced highest is played.',
}, wsId);

console.log(`TELARCHY_BASE_URL=${BASE}
TELARCHY_AUTH_URL=${AUTH_URL}
TELARCHY_BRANCH=${BRANCH ?? ''}
TELARCHY_WORKSPACE_ID=${wsId}
TELARCHY_METRIC_ID=${metric.id}
WORKSPACE_URL=${BASE.replace(/\/api$/, '')}/${slug}`);

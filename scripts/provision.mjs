#!/usr/bin/env node
// Provision the Chess workspace and its Game score metric on one Telarchy store
// (docs/chess.md, "The workspace") as the operator, `chess-operator`, whose key
// is who acts and so who owns the floor. On the admin-gated beta an admin
// session rides along only to open the gate. Prints the env lines the service
// needs.
//
//   BASE=https://telarchy.com/beta/api KEY=<chess-operator key> \
//   EMAIL=<admin> PASSWORD=... BRANCH=br-chess-live-feed \
//   FEED_URL=https://chess.167-233-147-90.nip.io node scripts/provision.mjs

const { BASE, AUTH_URL = 'https://telarchy.com/api', KEY, EMAIL, PASSWORD, BRANCH, FEED_URL } = process.env;
if (!BASE || !KEY) throw new Error('set BASE and KEY (the operator key)');

const cookies = [];
if (EMAIL) {
  const signIn = await fetch(`${AUTH_URL}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(AUTH_URL).origin },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!signIn.ok) throw new Error(`sign-in -> ${signIn.status}`);
  cookies.push(...signIn.headers.getSetCookie().map(c => c.split(';')[0]));
}
if (BRANCH) cookies.push(`telarchy_beta_branch=${BRANCH}`);
const cookie = cookies.join('; ');

async function call(method, path, body, workspaceId) {
  const headers = { 'Content-Type': 'application/json', 'X-Agent-Key': KEY };
  if (cookie) headers.Cookie = cookie;
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
  timePreference: { enabled: false, customHorizons: [cell], horizonCredits: { [cell]: { book: 3000, proposal: 1000 } } },
}, wsId);

// The floor's question, in the owner's words (docs/chess.md, "The workspace").
console.error('# metric question');
await call('PUT', `/metrics/${metric.id}`, { marketTitle: 'What score will I reach this game?' }, wsId);

// The bot's name on Telarchy: the operator is the proposer of every move (docs/chess.md, "The workspace").
// The workspace header is required: without it the store answers 401 for this key.
console.error('# operator nickname Rookie');
await call('POST', '/auth/profile', { nickname: 'Rookie' }, wsId);

console.error('# settings: one-minute decision window, public, muted, closed to outside proposals');
await call('PUT', `/workspaces/${wsId}/settings`, {
  decisionMinutes: 1,
  visibility: 'public',
  notificationsMuted: true,
  externalProposalsDisabled: true,
  description: 'A Lichess player whose every move is chosen by this market: on its turn every legal move is an option, and the one priced highest is played.',
  ...(FEED_URL ? { liveFeed: { kind: 'chess', url: FEED_URL } } : {}),
}, wsId);

console.log(`TELARCHY_BASE_URL=${BASE}
TELARCHY_AUTH_URL=${AUTH_URL}
TELARCHY_BRANCH=${BRANCH ?? ''}
TELARCHY_WORKSPACE_ID=${wsId}
TELARCHY_METRIC_ID=${metric.id}
WORKSPACE_URL=${BASE.replace(/\/api$/, '')}/${slug}`);

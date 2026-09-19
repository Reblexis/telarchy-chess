#!/usr/bin/env node
// Provision the Chess workspace and its Game score metric on one Telarchy store
// (docs/chess.md, "The workspace") as the operator, `chess-operator`, whose key
// is who acts and so who owns the floor. On the admin-gated beta an admin
// session rides along only to open the gate. Prints the env lines the service
// needs.
//
//   Production: BASE=https://telarchy.com/api KEY=<chess-operator key> FEED_URL=... (no EMAIL, no BRANCH)
//   Beta:
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

// docs/chess.md "The workspace": the floor carries move proposals and nothing else.
if (ws.starterProposalId) {
  console.error('# removing the starter proposal');
  await call('DELETE', `/proposals/${ws.starterProposalId}`, undefined, wsId);
}

// The rating the metric starts from (docs/chess.md, "The workspace"): the player's classical rating now.
const RATING = Number(process.env.RATING ?? '1500');
if (!Number.isFinite(RATING)) { console.error('RATING must be a number'); process.exit(1); }

// A placeholder mark; the operator writes the real target on its first tick (docs/chess.md, "Books on the half hour").
const HALF = 30 * 60_000;
const cell = new Date(Math.ceil((Date.now() + HALF) / HALF) * HALF).toISOString().slice(0, 16);
console.error('# creating metric Lichess rating');
const metric = await call('POST', '/metrics', {
  name: 'Lichess rating',
  description:
    'TelarchyRookie\'s classical rating on Lichess, as Lichess publishes it. Every move is a proposal with one option per legal move, each priced on this rating at a half-hour mark between 30 and 60 minutes on; the option priced highest is played. A mark settles on the rating at its first instant.',
  value: RATING,
  marketRangeMin: 1200,
  marketRangeMax: 2000,
  timePreference: { enabled: false, customHorizons: [cell], horizonTitles: { [cell]: `at ${cell.slice(11)} UTC` }, horizonCredits: { [cell]: { book: 6000, proposal: 2000 } } },
}, wsId);

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
  // The move question and the about text (docs/chess.md, "The workspace"): set here so a re-made floor never
  // falls back to the platform's "With {option}, ..." wording.
  optionQuestionTemplate: 'If the move {option} is made, what will my {metric} be {date}?',
  subjectAbout:
    'TelarchyRookie plays real games on Lichess (lichess.org/@/TelarchyRookie). On each of its turns one proposal appears with every legal move as an option. Each option is priced on TelarchyRookie\'s Lichess classical rating at a half-hour mark between 30 and 60 minutes on, named in the option\'s question. Two seconds before the deadline the highest priced move is played and the others void with a refund; a tie is random. Every book settles on the rating at its mark.\n\n[How to trade with a bot](https://github.com/Reblexis/telarchy-chess/blob/main/docs/trading.md)',
  ...(FEED_URL ? { liveFeed: { kind: 'chess', url: FEED_URL } } : {}),
}, wsId);

console.log(`TELARCHY_BASE_URL=${BASE}
TELARCHY_AUTH_URL=${AUTH_URL}
TELARCHY_BRANCH=${BRANCH ?? ''}
TELARCHY_WORKSPACE_ID=${wsId}
TELARCHY_METRIC_ID=${metric.id}
WORKSPACE_URL=${BASE.replace(/\/api$/, '')}/${slug}`);

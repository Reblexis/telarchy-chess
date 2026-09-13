// The feed's HTTP surface (docs/chess.md, "The feed"): /state, /games, /history.
import http from 'node:http';

export interface FeedSource {
  publicState(now: Date): unknown;
  games: unknown[];
  history(game: number | 'current'): unknown | null;
}

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
const ALLOW = 'GET, HEAD, OPTIONS';
const PREFLIGHT = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': ALLOW,
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};
/** Reads per reader per minute, counted as the snake counts them. */
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;

const isLoopback = (a: string) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

/** The reader behind the proxy: the first forwarded address, believed only from
 *  loopback; a loopback read with no forwarded header is this host and not counted. */
function readerKey(remote: string, forwarded: string | string[] | undefined): string | null {
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = (raw ?? '').split(',')[0].trim();
  if (isLoopback(remote)) return first || null;
  return remote;
}

export function createServer(src: FeedSource): http.Server {
  const hits = new Map<string, number[]>();
  const overRate = (key: string, now: number): number | null => {
    const seen = (hits.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
    seen.push(now);
    hits.set(key, seen);
    if (hits.size > 1000) for (const [k, v] of hits) if (v.every(t => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    if (seen.length <= RATE_LIMIT) return null;
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - seen[0])) / 1000));
  };

  return http.createServer((req, res) => {
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(status, { ...JSON_HEADERS, ...extra });
      res.end(JSON.stringify(body));
    };
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      if (method === 'OPTIONS') { res.writeHead(204, PREFLIGHT); res.end(); return; }
      if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'method not allowed' }, { allow: ALLOW });
      const key = readerKey(req.socket.remoteAddress ?? 'unknown', req.headers['x-forwarded-for']);
      const retry = key === null ? null : overRate(key, Date.now());
      if (retry !== null) return json(429, { error: 'too many requests' }, { 'retry-after': String(retry) });
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/state') return json(200, src.publicState(new Date()));
      if (url.pathname === '/games') return json(200, { games: src.games });
      if (url.pathname === '/history') {
        const g = url.searchParams.get('game');
        const game = g === null || g === 'current' ? 'current' : Number(g);
        const h = game === 'current' || Number.isInteger(game) ? src.history(game) : null;
        return h ? json(200, h) : json(404, { error: 'no such game' });
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      console.error(`request: ${(e as Error).message}`);
      if (!res.headersSent) json(500, { error: 'internal' });
    }
  });
}

// The Lichess Bot API client (docs/chess.md, "The player"). Deliberately has
// no draw, takeback, abort or resign method: the player never does any of those.
import type { LichessClient, PlayerRecord } from './operator.js';
import type { OnlineBot } from './rules.js';

const BASE = 'https://lichess.org';

/** Newline-delimited JSON from a byte stream: blank keep-alive lines and lines
 *  that do not parse are skipped, a line split across chunks is joined. */
export async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = (line: string) => {
    const t = line.trim();
    if (!t) return undefined;
    try { return JSON.parse(t); } catch { return undefined; }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const v = parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (v !== undefined) yield v;
    }
  }
  const last = parse(buf);
  if (last !== undefined) yield last;
}

export class HttpLichessClient implements LichessClient {
  constructor(private token: string, private fetchImpl: typeof fetch = fetch) {}

  private async req(method: string, path: string, form?: Record<string, string>, accept = 'application/json'): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: accept };
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await this.fetchImpl(`${BASE}${path}`, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    }
    return res;
  }

  async move(gameId: string, uci: string): Promise<void> {
    await this.req('POST', `/api/bot/game/${encodeURIComponent(gameId)}/move/${encodeURIComponent(uci)}`);
  }

  async claimVictory(gameId: string): Promise<void> {
    await this.req('POST', `/api/bot/game/${encodeURIComponent(gameId)}/claim-victory`);
  }

  async acceptChallenge(id: string): Promise<void> {
    await this.req('POST', `/api/challenge/${encodeURIComponent(id)}/accept`);
  }

  async declineChallenge(id: string, reason: string): Promise<void> {
    await this.req('POST', `/api/challenge/${encodeURIComponent(id)}/decline`, { reason });
  }

  async cancelChallenge(id: string): Promise<void> {
    await this.req('POST', `/api/challenge/${encodeURIComponent(id)}/cancel`);
  }

  async challenge(username: string, tc: { limit: number; increment: number; rated: boolean }): Promise<{ id: string }> {
    const res = await this.req('POST', `/api/challenge/${encodeURIComponent(username)}`, {
      'clock.limit': String(tc.limit), 'clock.increment': String(tc.increment), rated: String(tc.rated),
      color: 'random', variant: 'standard',
    });
    const j = await res.json();
    return { id: String(j?.id ?? j?.challenge?.id) };
  }

  async onlineBots(): Promise<OnlineBot[]> {
    const res = await this.req('GET', '/api/bot/online?nb=300', undefined, 'application/x-ndjson');
    const out: OnlineBot[] = [];
    if (res.body) for await (const b of ndjsonLines(res.body)) out.push(b);
    return out;
  }

  /** docs/chess.md "The feed", `player`: the classical rating and Lichess's own game counts. */
  async account(): Promise<PlayerRecord> {
    const j = await (await this.req('GET', '/api/account')).json();
    const c = j?.perfs?.classical;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const username = String(j?.username ?? '');
    return {
      username,
      url: typeof j?.url === 'string' ? j.url : `${BASE}/@/${username}`,
      rating: typeof c?.rating === 'number' ? c.rating : 1500,
      provisional: typeof c?.rating === 'number' ? !!c.prov : true,
      games: { played: n(j?.count?.all), won: n(j?.count?.win), lost: n(j?.count?.loss), drawn: n(j?.count?.draw) },
    };
  }

  /** The account's event stream: challenges, game starts and finishes. */
  async events(signal?: AbortSignal): Promise<AsyncGenerator<any>> {
    const res = await this.fetchImpl(`${BASE}/api/stream/event`, { headers: { Authorization: `Bearer ${this.token}` }, signal });
    if (!res.ok || !res.body) throw new Error(`GET /api/stream/event -> ${res.status}`);
    return ndjsonLines(res.body);
  }

  /** One game's stream: gameFull first, then gameState lines. */
  async gameStream(gameId: string, signal?: AbortSignal): Promise<AsyncGenerator<any>> {
    const res = await this.fetchImpl(`${BASE}/api/bot/game/stream/${encodeURIComponent(gameId)}`, { headers: { Authorization: `Bearer ${this.token}` }, signal });
    if (!res.ok || !res.body) throw new Error(`GET /api/bot/game/stream/${gameId} -> ${res.status}`);
    return ndjsonLines(res.body);
  }
}

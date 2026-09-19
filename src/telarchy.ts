// The Telarchy client the chess operator uses (docs/chess.md, "The workspace"
// and "The move"). Deliberately has no trade method: the operator never trades.
import type { Activity, Prices, ProposalRef, RawTrade, TelarchyClient } from './operator.js';
import { markTitle, type MoveOption } from './rules.js';

export interface SessionAuth {
  /** A platform-admin browser account: the beta store is admin-gated and refuses agent keys.
   *  Sign-in lives on the published auth, so its URL is separate from the store's base URL. */
  email: string;
  password: string;
  authUrl: string;
}

export interface TelarchyOptions {
  baseUrl: string;
  apiKey: string;
  workspaceId: string;
  metricId: string;
  workspaceUrl: string;
  session?: SessionAuth;
  /** A branch preview on the beta (`br-<name>`), sent as the telarchy_beta_branch cookie. */
  branch?: string;
  timeouts?: { read?: number; write?: number };
}

/** docs/chess.md "Liquidity": the main book and each option book. */
export const MAIN_BOOK_CREDITS = 6000;
export const OPTION_BOOK_CREDITS = 2000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class HttpTelarchyClient implements TelarchyClient {
  private cookie: string | null = null;

  constructor(private o: TelarchyOptions, private fetchImpl: typeof fetch = fetch) {}

  private async request(url: string, init: RequestInit, kind: 'read' | 'write'): Promise<Response> {
    const ms = this.o.timeouts?.[kind] ?? (kind === 'read' ? 10_000 : 20_000);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctl.signal });
    } catch (e) {
      if (ctl.signal.aborted) throw new Error(`${init.method ?? 'GET'} ${new URL(url).pathname} -> no answer in ${ms}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async signIn(): Promise<void> {
    const s = this.o.session!;
    const res = await this.fetchImpl(`${s.authUrl}/auth/sign-in/email`, {
      method: 'POST',
      // better-auth refuses a POST whose Origin is null, which Node's fetch sends by default.
      headers: { 'Content-Type': 'application/json', Origin: new URL(s.authUrl).origin },
      body: JSON.stringify({ email: s.email, password: s.password }),
    });
    if (!res.ok) throw new Error(`sign-in -> ${res.status}`);
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const raw = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [h.get('set-cookie') ?? ''];
    const pairs = raw.filter(Boolean).map(c => c.split(';')[0].trim());
    if (pairs.length === 0) throw new Error('sign-in returned no session cookie');
    this.cookie = pairs.join('; ');
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'X-Workspace-Id': this.o.workspaceId, 'Content-Type': 'application/json' };
    const cookies: string[] = [];
    // The operator's key is who acts; on the admin-gated beta a session rides
    // along only to open the gate (docs/chess.md, "Operation").
    if (this.o.apiKey) h['X-Agent-Key'] = this.o.apiKey;
    if (this.o.session) {
      if (!this.cookie) await this.signIn();
      cookies.push(this.cookie!);
    }
    if (this.o.branch) cookies.push(`telarchy_beta_branch=${this.o.branch}`);
    if (cookies.length) h['Cookie'] = cookies.join('; ');
    return h;
  }

  private async call(method: string, path: string, body?: unknown, retried = false): Promise<any> {
    const res = await this.request(`${this.o.baseUrl}${path}`, {
      method,
      headers: await this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }, method === 'GET' ? 'read' : 'write');
    // The beta gate answers a stale session with a bare 404, a route with 401.
    if (this.o.session && !retried && (res.status === 401 || res.status === 404)) {
      this.cookie = null;
      return this.call(method, path, body, true);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    // A retry may meet a proposal the deadline sweep or an earlier request
    // already closed. Only an explicit terminal status proves cleanup done.
    if (method === 'POST' && path.endsWith('/decline') && res.status === 409 &&
        json?.code === 'not_pending' &&
        ['approved', 'declined', 'declined_spam', 'withdrawn', 'lapsed'].includes(json?.status)) return json;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error ?? text.slice(0, 200)}`);
    return json;
  }

  async postProposal(title: string, description: string, decideBy: Date, options: MoveOption[]): Promise<ProposalRef> {
    const r = await this.call('POST', '/proposals', { title, description, decideBy: decideBy.toISOString(), options });
    return { id: String(r.id), number: Number(r.number), url: `${this.o.workspaceUrl}/p/${r.number}` };
  }

  /** Each option's price, lead and market from the proposal's row on the game's
   *  cell, found by target date or, failing that, by its settlement instant. */
  async readPrices(ref: ProposalRef, cell: string | null): Promise<Prices> {
    const r = await this.call('GET', `/proposals/${encodeURIComponent(ref.id)}`);
    const rows: any[] = Array.isArray(r?.markets) ? r.markets : [];
    const withOptions = rows.filter(x => Array.isArray(x?.options));
    let row: any;
    if (cell) {
      const end = Date.parse(`${cell}:00Z`) + 60_000;
      row = withOptions.find(x => x.targetDate === cell) ??
        withOptions.find(x => !x.targetDate && typeof x.resolvesOn === 'string' && Date.parse(x.resolvesOn) === end);
    } else {
      row = withOptions[0];
    }
    const out: Prices = {};
    for (const o of row?.options ?? []) {
      if (typeof o?.id !== 'string') continue;
      out[o.id] = { price: num(o.consensus), lead: num(o.delta), marketId: typeof o.marketId === 'string' ? o.marketId : undefined };
    }
    return out;
  }

  /** A public read: no key, no session, GET only. */
  private async publicGet(path: string): Promise<any> {
    const res = await this.request(`${this.o.baseUrl}${path}`, { method: 'GET', headers: { Accept: 'application/json' } }, 'read');
    if (!res.ok) throw new Error(`GET ${path.split('?')[0]} -> ${res.status}`);
    return res.json();
  }

  /** docs/chess.md "The feed", `call` and `recentTrades`: the floor's payload
   *  names the metric's main book, its history is the call, and the public
   *  actions log carries every trade on the floor's books. Reads only. */
  async readActivity(): Promise<Activity> {
    const ws = encodeURIComponent(this.o.workspaceId);
    const [floor, log] = await Promise.all([
      this.publicGet(`/marketplace/${ws}`),
      this.publicGet(`/data-room/actions?workspace=${ws}&kinds=trade&limit=50`),
    ]);
    const book = (Array.isArray(floor?.markets) ? floor.markets : []).find((m: any) => m?.metricId === this.o.metricId && typeof m?.marketId === 'string');
    let call: Activity['call'] = null;
    if (book) {
      const h = await this.publicGet(`/marketplace/${ws}/markets/${encodeURIComponent(book.marketId)}/history`);
      const history = (Array.isArray(h?.history) ? h.history : [])
        .filter((p: any) => typeof p?.at === 'string' && Number.isFinite(Date.parse(p.at)) && num(p?.consensus) !== null)
        .map((p: any) => ({ at: p.at as string, value: p.consensus as number }));
      call = { marketId: book.marketId, value: num(book.consensus), history };
    }
    const trades: RawTrade[] = [];
    for (const r of Array.isArray(log?.rows) ? log.rows : []) {
      const d = r?.detail;
      if (r?.kind !== 'trade' || typeof r?.id !== 'string' || typeof r?.at !== 'string' || typeof d?.marketId !== 'string') continue;
      trades.push({
        id: r.id, at: r.at, handle: String(r.actor?.handle ?? r.actor?.id ?? '?'),
        side: d.side === 'sell' ? 'sell' : 'buy', direction: d.direction === 'lower' ? 'lower' : 'higher',
        credits: num(d.cost) ?? 0, marketId: d.marketId, price: num(d.callAfter),
      });
    }
    return { call, trades };
  }

  async approveOption(ref: ProposalRef, option: string): Promise<void> {
    await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/approve`, { option });
  }

  async declineProposal(ref: ProposalRef): Promise<void> {
    await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/decline`, { refund: true });
  }

  /** docs/chess.md "Books on the half hour": the mark becomes the metric's
   *  only horizon, titled with its clock time, with its book depths. */
  async setHorizon(cell: string): Promise<void> {
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, {
      timePreference: {
        enabled: false,
        customHorizons: [cell],
        horizonTitles: { [cell]: markTitle(cell) },
        horizonCredits: { [cell]: { book: MAIN_BOOK_CREDITS, proposal: OPTION_BOOK_CREDITS } },
      },
    });
  }

  async refreshBooks(): Promise<void> {
    await this.call('POST', '/predictions/markets/refresh', { force: true });
  }

  /** docs/chess.md "A mark settles when it arrives": `asOf` places the reading inside the mark's minute. */
  async postReading(value: number, at: Date): Promise<void> {
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, { value, asOf: at.toISOString(), updateNote: 'rating at the mark' });
  }

  /** Settles every book whose reading has arrived. There is no early
   *  settlement here on purpose: it would close the books of every mark at once. */
  async resolveBooks(): Promise<void> {
    await this.call('POST', '/predictions/resolve', {});
  }
}

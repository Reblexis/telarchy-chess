// The Telarchy client the chess operator uses (docs/chess.md, "The workspace"
// and "The move"). Deliberately has no trade method: the operator never trades.
import type { PlayNowWorlds, Prices, ProposalRef, TelarchyClient } from './operator.js';
import type { MoveOption } from './rules.js';

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
export const MAIN_BOOK_CREDITS = 3000;
export const OPTION_BOOK_CREDITS = 1000;
/** docs/chess.md "Play now?": each of a play-now proposal's two books. The
 *  operator names it as the proposal's own subsidy, so the date's 1,000 (the
 *  owner's fallback when nobody pays) never applies to it. */
export const PLAY_NOW_BOOK_CREDITS = 100;

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
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error ?? text.slice(0, 200)}`);
    return json;
  }

  async postProposal(title: string, description: string, decideBy: Date, options: MoveOption[]): Promise<ProposalRef> {
    const r = await this.call('POST', '/proposals', { title, description, decideBy: decideBy.toISOString(), options });
    return { id: String(r.id), number: Number(r.number), url: `${this.o.workspaceUrl}/p/${r.number}` };
  }

  /** docs/chess.md "Play now?": a plain two-world proposal, both books funded by the operator. */
  async postPlayNow(title: string, description: string, decideBy: Date): Promise<ProposalRef> {
    const r = await this.call('POST', '/proposals', { title, description, decideBy: decideBy.toISOString(), liquiditySubsidy: PLAY_NOW_BOOK_CREDITS });
    return { id: String(r.id), number: Number(r.number), url: `${this.o.workspaceUrl}/p/${r.number}` };
  }

  /** The approved and declined worlds of a play-now proposal on the game's cell. */
  async readPlayNow(ref: ProposalRef, cell: string | null): Promise<PlayNowWorlds> {
    const r = await this.call('GET', `/proposals/${encodeURIComponent(ref.id)}`);
    const row = pickRow((Array.isArray(r?.markets) ? r.markets : []).filter((x: any) => x && !Array.isArray(x.options)), cell);
    const world = (w: any) => ({ price: num(w?.consensus), marketId: typeof w?.marketId === 'string' ? w.marketId : null });
    return { approved: world(row?.approved), declined: world(row?.declined), status: typeof r?.status === 'string' ? r.status : null };
  }

  async approveProposal(ref: ProposalRef): Promise<void> {
    await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/approve`, {});
  }

  /** Each option's price, lead and market from the proposal's row on the game's
   *  cell, found by target date or, failing that, by its settlement instant. */
  async readPrices(ref: ProposalRef, cell: string | null): Promise<Prices> {
    const r = await this.call('GET', `/proposals/${encodeURIComponent(ref.id)}`);
    const rows: any[] = Array.isArray(r?.markets) ? r.markets : [];
    const row = pickRow(rows.filter(x => Array.isArray(x?.options)), cell);
    const out: Prices = {};
    for (const o of row?.options ?? []) {
      if (typeof o?.id !== 'string') continue;
      out[o.id] = { price: num(o.consensus), lead: num(o.delta), marketId: typeof o.marketId === 'string' ? o.marketId : undefined };
    }
    return out;
  }

  async approveOption(ref: ProposalRef, option: string): Promise<void> {
    await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/approve`, { option });
  }

  async declineProposal(ref: ProposalRef): Promise<void> {
    await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/decline`, { refund: true });
  }

  /** The game's cell becomes the metric's only horizon, with its book depths. */
  async setHorizon(cell: string): Promise<void> {
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, {
      timePreference: {
        enabled: false,
        customHorizons: [cell],
        horizonCredits: { [cell]: { book: MAIN_BOOK_CREDITS, proposal: OPTION_BOOK_CREDITS } },
      },
    });
  }

  async refreshBooks(): Promise<void> {
    await this.call('POST', '/predictions/markets/refresh', { force: true });
  }

  async postReading(value: number, at: Date): Promise<void> {
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, { value, asOf: at.toISOString(), updateNote: 'game result' });
  }

  async settleMetric(value: number, at: Date, reason: string): Promise<void> {
    await this.call('POST', `/metrics/${encodeURIComponent(this.o.metricId)}/settle`, { value, asOf: at.toISOString(), reason });
  }
}

/** The proposal's row on the game's cell, found by target date or, failing
 *  that, by its settlement instant; the first row when no cell is known. */
function pickRow(rows: any[], cell: string | null): any {
  if (!cell) return rows[0];
  const end = Date.parse(`${cell}:00Z`) + 60_000;
  return rows.find(x => x.targetDate === cell) ??
    rows.find(x => !x.targetDate && typeof x.resolvesOn === 'string' && Date.parse(x.resolvesOn) === end);
}

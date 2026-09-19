// scripts/provision.mjs against a fake store: a floor made again reads the same (docs/chess.md, "The workspace").
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function provision(extra: Record<string, string> = {}) {
  const record = join(mkdtempSync(join(tmpdir(), 'chess-provision-')), 'calls.jsonl');
  const out = execFileSync('node', ['--import', './tests/helpers/fake-telarchy-fetch.mjs', 'scripts/provision.mjs'], {
    env: { PATH: process.env.PATH ?? '', BASE: 'https://store.test/api', KEY: 'op-key', RECORD: record, ...extra },
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  const calls = readFileSync(record, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  return { out, calls, settings: calls.find(c => c.url.endsWith('/settings'))?.body };
}

describe('provisioning the Chess floor', () => {
  it('the move question is "If the move {option} is made", never the platform default "With {option}"', () => {
    const { settings } = provision();
    expect(settings.optionQuestionTemplate).toBe('If the move {option} is made, what will my {metric} be {date}?');
    expect(settings.optionQuestionTemplate).not.toMatch(/^With /);
  });

  it('the about text names the Lichess account, the rating and when it is read, the rule, and links the trading guide', () => {
    const { settings } = provision();
    expect(settings.subjectAbout).toContain('lichess.org/@/TelarchyRookie');
    expect(settings.subjectAbout).toContain('Lichess classical rating');
    expect(settings.subjectAbout).toContain('between 30 and 60 minutes');
    expect(settings.subjectAbout).not.toMatch(/Game score|100 if/);
    expect(settings.subjectAbout).toContain('the highest priced move is played');
    expect(settings.subjectAbout).toContain('docs/trading.md');
    expect(settings.subjectAbout).not.toContain('TelarchyBot');
  });

  it('the floor is public, muted, closed to outside proposals, with a one-minute window', () => {
    const { settings } = provision();
    expect(settings).toMatchObject({ visibility: 'public', notificationsMuted: true, externalProposalsDisabled: true, decisionMinutes: 1 });
  });

  it('the live feed is set only when a feed url is given', () => {
    expect(provision().settings.liveFeed).toBeUndefined();
    expect(provision({ FEED_URL: 'https://feed.test' }).settings.liveFeed).toEqual({ kind: 'chess', url: 'https://feed.test' });
  });

  it('the one metric is Lichess rating, 1200 to 2000, opening at the rating given, with no question of its own and no opening value', () => {
    const { calls } = provision({ RATING: '1562' });
    const made = calls.filter(c => c.method === 'POST' && c.url.endsWith('/metrics'));
    expect(made).toHaveLength(1);
    expect(made[0].body).toMatchObject({ name: 'Lichess rating', value: 1562, marketRangeMin: 1200, marketRangeMax: 2000 });
    expect(made[0].body.marketTitle).toBeUndefined();
    expect(made[0].body.opensAt).toBeUndefined();
    expect(calls.some(c => c.method === 'PUT' && c.url.includes('/metrics/'))).toBe(false);
  });
  it('the placeholder horizon is a half-hour mark at the documented depth', () => {
    const tp = provision().calls.find(c => c.method === 'POST' && c.url.endsWith('/metrics'))!.body.timePreference;
    expect(tp.customHorizons).toHaveLength(1);
    expect(tp.customHorizons[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:(00|30)$/);
    expect(tp.horizonCredits[tp.customHorizons[0]]).toEqual({ book: 6000, proposal: 2000 });
  });
  it('a rating that is not a number refuses to provision', () => {
    expect(() => provision({ RATING: 'abc' })).toThrow();
  });
  it('the operator is named Rookie', () => {
    expect(provision().calls.find(c => c.url.endsWith('/auth/profile'))?.body).toEqual({ nickname: 'Rookie' });
  });

  it('the platform\'s starter proposal is removed: the floor carries move proposals and nothing else', () => {
    const { calls } = provision();
    const del = calls.filter(c => c.method === 'DELETE');
    expect(del.map(c => c.url)).toEqual(['https://store.test/api/proposals/starter-1']);
    // After the workspace exists, since the removal is addressed to it.
    expect(calls.indexOf(del[0])).toBeGreaterThan(calls.findIndex(c => c.url.endsWith('/workspaces')));
  });

  it('a workspace created with no starter proposal has nothing removed', () => {
    expect(provision({ NO_STARTER: '1' }).calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  it('production needs no session: with no EMAIL no sign-in is attempted', () => {
    expect(provision().calls.some(c => c.url.includes('/auth/sign-in'))).toBe(false);
  });

  it('prints the env lines the service needs', () => {
    const { out } = provision();
    expect(out).toContain('TELARCHY_BASE_URL=https://store.test/api');
    expect(out).toContain('TELARCHY_WORKSPACE_ID=id-1');
  });
});

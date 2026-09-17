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
    expect(settings.optionQuestionTemplate).toBe("If the move {option} is made, what will {workspace}'s final {metric} be?");
    expect(settings.optionQuestionTemplate).not.toMatch(/^With /);
  });

  it('the about text names the Lichess account, the score, the rule, and links the trading guide', () => {
    const { settings } = provision();
    expect(settings.subjectAbout).toContain('lichess.org/@/TelarchyRookie');
    expect(settings.subjectAbout).toContain('100 if TelarchyRookie wins this game, 50 for a draw, 0 for a loss');
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

  it('the metric asks the owner\'s question and the operator is named Rookie', () => {
    const { calls } = provision();
    expect(calls.find(c => c.method === 'PUT' && c.url.includes('/metrics/'))?.body).toEqual({ marketTitle: 'What score will I reach this game?' });
    expect(calls.find(c => c.url.endsWith('/auth/profile'))?.body).toEqual({ nickname: 'Rookie' });
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

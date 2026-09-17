// Preloaded by tests/provision.test.ts: answers every Telarchy call and records it to the file named in RECORD.
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.RECORD, JSON.stringify({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null }) + '\n');
  return new Response(JSON.stringify({ id: 'id-1', slug: 'chess', ok: true, ...(process.env.NO_STARTER ? {} : { starterProposalId: 'starter-1' }) }), { status: 200 });
};

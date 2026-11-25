import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './collect.mjs';

test('Jobs.cz pagination sends only its assigned frontend cookie to the search origin', async () => {
  const { jobsCzSession } = await import('./czech-search.mjs');
  const sent = [];
  const session = jobsCzSession({ fetchResponse: async (_url, options) => {
    sent.push(options.headers.cookie);
    const headers = new Headers();
    headers.append('Set-Cookie', 'beta_bucket=A; Path=/');
    headers.append('Set-Cookie', 'JOBSSID=unused; Path=/');
    return new Response('ok', { headers });
  } });
  await session.fetchText('https://www.jobs.cz/prace/', {});
  await session.fetchText('https://www.jobs.cz/prace/?page=2', {});
  await assert.rejects(session.fetchText('https://example.org/', {}), /origin/);
  assert.deepEqual(sent, [undefined, 'beta_bucket=A']);
});

const board = { name: 'Himalayas', provider: 'himalayas' };
const python = { company: 'Example', title: 'Python Backend Engineer', url: 'https://example.com/jobs/41' };
test('a city requirement in the employer text overrides a Czech or EU board label', () => {
  const item = { ...python, location: 'Austria, Czechia, Germany', description: 'Successful applicants are required to be based in Berlin, Munich, Stuttgart, London, or Porto.' };
  assert.equal(classify(board, item), null);
  assert.equal(classify(board, { ...item, description: 'Candidates must be based in Prague or Berlin.' }).group, 'remote-cz');
});
test('remote abroad, a bare remote label and an expired posting stay out of the shortlist', () => {
  for (const location of ['Remote', 'Remote - US', 'Remote - Germany', 'Remote - CET']) {
    assert.equal(classify(board, { ...python, location }), null, location);
  }
  assert.equal(classify(board, { ...python, location: 'Worldwide', expiresAt: Date.now() - 1 }), null);
});
test('an EMEA home-based offer, a Prague office, and a mention of Python are distinct', () => {
  const employer = { name: 'Canonical', provider: 'greenhouse' };
  assert.equal(classify(employer, { ...python, location: 'Home based - EMEA' }).group, 'remote-region');
  const office = classify(employer, { ...python, title: 'Backend Engineer', location: 'Prague, Czech Republic', description: 'We use Python.' });
  assert.deepEqual([office.group, office.python], ['prague', 'description']);
  assert.equal(classify(employer, { ...python, title: 'Java Backend Engineer', location: 'Home based - EMEA', description: 'Some Python.' }), null);
});

test('the national board keeps potential home-office leads outside Prague for review', () => {
  const national = { name: 'Jobs.cz celá ČR', provider: 'jobscz' };
  const row = { ...python, title: 'Backend Developer', location: 'Brno', searchKeywords: 'FastAPI' };
  assert.equal(classify(national, row), null);
  const lead = classify(national, { ...row, possibleRemote: true });
  assert.deepEqual([lead.group, lead.python], ['review', 'search']);
});

test('StartupJobs trusts the full offer for remote work and retains required languages', async () => {
  const { startupJobsCz } = await import('./startupjobs-cz.mjs');
  const summary = { id: 32, name: { cs: 'Python vývojář' }, company: { name: 'Test' }, locationPreferences: ['remote'] };
  const detail = { ...summary, state: 'published', slug: { cs: 'python' }, description: { en: 'Python APIs' },
    locations: [{ name: { en: 'Brno, Czechia' } }], requiredSkills: [],
    requiredLanguages: [{ language: { name: { en: 'English' } } }], publishedAt: '2026-10-01' };
  const ctx = { fetchResponse: async (_, options) => {
    const { method, params, id } = JSON.parse(options.body);
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result = { protocolVersion: '2025-03-26' };
    if (params.name === 'search_offers') result = { structuredContent: { totalItems: 2, member: [summary, { ...summary, id: 33 }] } };
    if (params.name === 'get_offer') result = { structuredContent: { ...detail, id: params.arguments.id,
      locationPreferences: [{ id: params.arguments.id === 33 ? 'onsite' : 'remote' }] } };
    return Response.json({ id, result });
  } };
  const out = await startupJobsCz({ queries: [{ query: 'Python' }], max_pages: 1 }, ctx, [], () => true);
  assert.equal(out.read, 2);
  assert.deepEqual(out.rows.map(row => [row.url, row.location, row.languageNote]), [['https://www.startupjobs.cz/nabidka/32/python','Brno, Czechia','English']]);
});

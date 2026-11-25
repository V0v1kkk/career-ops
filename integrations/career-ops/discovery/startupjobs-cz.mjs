// Public jobseeker operations on StartupJobs.cz's documented MCP service.
import { htmlToText } from '/opt/career-ops/providers/_html-to-text.mjs';

const endpoint = 'https://back.startupjobs.cz/api/mcp';
const label = value => value?.en || value?.cs || '';
async function connect(ctx) {
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  let sequence = 0;
  async function request(method, params, notification = false) {
    const id = notification ? undefined : ++sequence;
    const response = await ctx.fetchResponse(endpoint, { method: 'POST', headers, redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }) });
    const session = response.headers.get('mcp-session-id');
    if (session) headers['mcp-session-id'] = session;
    if (notification) return;
    const body = await response.text();
    const frames = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('\n')).filter(Boolean)
      : [body];
    for (const frame of frames) {
      const message = JSON.parse(frame);
      if (message.id !== id) continue;
      if (message.error || !message.result) throw new Error('StartupJobs.cz rejected ' + method);
      return message.result;
    }
    throw new Error('Missing MCP response for ' + method);
  }
  const init = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'career-ops-job-search', version: '1' } });
  headers['mcp-protocol-version'] = init.protocolVersion;
  await request('notifications/initialized', {}, true);
  return async (name, args) => {
    const r = await request('tools/call', { name, arguments: args });
    if (r.isError) throw new Error('StartupJobs.cz tool failed: ' + name);
    return r.structuredContent ?? JSON.parse(r.content.find(c => c.type === 'text').text);
  };
}

export async function startupJobsCz(entry, ctx, notes, relevantTitle) {
  const call = await connect(ctx);
  const shortlist = new Map();
  const seen = new Set();
  for (const query of entry.queries) {
    for (let page = 1; page <= entry.max_pages; page++) {
      const results = await call('search_offers', { ...query, locationPreferences: ['remote'], page, itemsPerPage: 100 });
      if (!Array.isArray(results.member)) throw new Error('Missing StartupJobs.cz results');
      for (const item of results.member) {
        seen.add(item.id);
        if (Number.isSafeInteger(item.id) && item.locationPreferences?.includes('remote') && relevantTitle(label(item.name))) shortlist.set(item.id, item);
      }
      if (page * 100 >= results.totalItems || results.member.length < 100) break;
      if (page === entry.max_pages) notes.push('search page limit reached');
    }
  }
  const rows = [];
  let failures = 0;
  for (const item of shortlist.values()) {
    try {
      const d = await call('get_offer', { id: item.id });
      if (d.id !== item.id || d.state !== 'published' || !d.locationPreferences?.some(p => p.id === 'remote')) continue;
      const location = d.locations.map(l => label(l.name)).filter(Boolean).join(', ');
      const skills = d.requiredSkills.map(v => label(v.skill.name));
      const langs = d.requiredLanguages.map(v => label(v.language.name));
      const desc = htmlToText(label(d.description));
      const slug = d.slug.cs || d.slug.en;
      if (!slug) continue;
      rows.push({ title: label(d.name), company: item.company.name, location, confirmedPublished: true, workplaceType: 'Remote', isRemote: true,
        description: [skills.join(', '), desc].join('\n'), languageNote: langs.join(', '),
        postedAt: Date.parse(d.publishedAt), url: 'https://www.startupjobs.cz/nabidka/' + d.id + '/' + encodeURIComponent(slug) });
    } catch { failures++; }
  }
  if (failures && failures === shortlist.size) throw new Error('All StartupJobs.cz detail reads failed');
  if (failures) notes.push(failures + ' detail reads failed');
  return { rows, read: seen.size };
}

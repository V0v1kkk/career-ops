// Executed in a disposable container with no candidate data or credentials mounted.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { makeHttpCtx } from '/opt/career-ops/providers/_http.mjs';
import { buildWorkplacePolicy } from '/opt/career-ops/providers/_country.mjs';
import { boardTruncation } from '/opt/career-ops/lib/board-truncation.mjs';
import { parseHimalayasResponse } from '/opt/career-ops/providers/himalayas.mjs';
import { htmlToText } from '/opt/career-ops/providers/_html-to-text.mjs';

import { startupJobsCz } from './startupjobs-cz.mjs';
import { nationalJobsCz, jobsCzSession } from './czech-search.mjs';
import { hnHiring } from './hn-hiring.mjs';

const yaml = createRequire('/opt/career-ops/package.json')('js-yaml');
export const config = yaml.load(fs.readFileSync(new URL('./portals.yml', import.meta.url), 'utf8'));
export const boards = [...config.job_boards, ...config.tracked_companies];
const geography = buildWorkplacePolicy(config.location_filter.workplace_policy);
const remoteBoards = new Set(['remotive', 'workingnomads', 'weworkremotely', 'remoteok', 'jobicy', 'himalayas']);
const python = /\b(?:python(?:[23](?:\.\d+)?)?|django|fastapi|flask)\b/i;
const developer = /engineer|developer|programmer|backend|back[ -]end|full[ -]?stack|programátor|programator|vývoj|entwickler/i;
const otherRole = /\b(?:sales|support|solutions|customer success|account|advocate|quality assurance|qa|test automation|designer|manager|analyst)\b/i;
const primaryOtherStack = /\b(?:golang|java|rust|ruby|php|typescript|javascript|scala|kotlin|front[ -]?end)\b|c\+\+|\.net\b/i;
const czech = /\b(?:czech(?:ia| republic)?|cz|prague|praha)\b|česká republika|česko/i;
const localEmployerBoards = new Set(config.tracked_companies.map(entry => entry.name));
const day = 86400000;
const homeRegion = /\b(?:europe|european union|eu|eea|emea|worldwide|globally|anywhere)\b/i;

// Some feeds label a whole continent eligible even when the JD imposes a city list.
function conflictingLocation(text) {
  const clause = /\b(?:required to (?:be (?:currently )?(?:based|located)|reside|live)|must (?:currently )?(?:be (?:based|located)|reside|live)) (?:in|within) ([^.!?;\n]{1,240})/gi;
  return [...text.matchAll(clause)].some(([, places]) => !czech.test(places) && !homeRegion.test(places));
}

const relevantTitle = title => developer.test(title) && !otherRole.test(title);
export function classify(entry, item, now = Date.now()) {
  if (!item.title || !/^https:\/\/[^\s]+$/i.test(item.url || '')) return null;
  const detail = item.description || '';
  const titleMatch = python.test(item.title);
  const searchHit = python.test(item.searchKeywords || '');
  if (!relevantTitle(item.title) ||
      (!titleMatch && (primaryOtherStack.test(item.title) || (!python.test(detail) && !searchHit)))) return null;
  // An employer listing an evergreen opening is stronger evidence than an old aggregator copy.
  if ((item.expiresAt && item.expiresAt <= now) || conflictingLocation(detail)) return null;
  if (!item.confirmedPublished && !localEmployerBoards.has(entry.name) && item.postedAt && now - item.postedAt > 45 * day) return null;
  const location = item.location || '';
  const normalized = location.replace(/Czech Republic|Česká republika|Česko/gi, 'Czechia');
  const remoteOnlyBoard = remoteBoards.has(entry.provider) || /\bhome[ -]based\b/i.test(location);
  const offer = remoteOnlyBoard ? { ...item, isRemote: true } : item;
  const decision = geography(normalized, item.title, offer);
  if (!decision.eligible && !item.possibleRemote) return null;
  let group = 'prague';
  if (decision.reason === 'remote_region_allowed') {
    group = czech.test(location) ? 'remote-cz' : 'remote-region';
  }
  if (item.possibleRemote) group = 'review';

  return { group, company: item.company || entry.name, title: item.title, url: item.url,
    location, language: item.languageNote || undefined, python: titleMatch ? 'title' : python.test(detail) ? 'description' : 'search', source: entry.name,
    posted: item.postedAt ? new Date(item.postedAt).toISOString().slice(0, 10) : null };
}

// The upstream browse adapter walks unrelated jobs. Use the board's documented
// search endpoint for the Czech location and timezone filter and its normal parser.
async function searchHimalayas(ctx, entry, notes) {
  const rows = new Map();
  for (let page = 1; page <= entry.max_pages; page++) {
    let feed;
    try {
      feed = await ctx.fetchJson('https://himalayas.app/jobs/api/search?q=python&country=CZ&sort=recent&page=' + page, { redirect: 'error' });
      if (!Array.isArray(feed?.jobs)) throw new Error('Missing jobs array');
    } catch (error) {
      if (!rows.size) throw error;
      notes.push('page ' + page + ' failed: ' + error.message);
      break;
    }
    for (const raw of feed.jobs) {
      const [item] = parseHimalayasResponse({ jobs: [raw] });
      if (!item) continue;
      // The detail page identifies the source. applicationLink can lead to an application form.
      if (/^https:\/\/himalayas\.app\/companies\/[^/]+\/jobs\/[^/?#]+\/?$/.test(raw.guid)) item.url = raw.guid;
      item.description = htmlToText(String(raw.description || ''));
      const expiry = Number(raw.expiryDate);
      if (expiry > 0) item.expiresAt = expiry < 1e12 ? expiry * 1000 : expiry;
      rows.set(item.url, item);
    }
    if (feed.jobs.length < 20) break;
    if (page === entry.max_pages) notes.push('page limit ' + page + ' reached');
  }
  return [...rows.values()];
}

// One board per process so warnings emitted by upstream adapters stay attributable.
export async function collect(entry) {
  const statuses = [];
  const notes = [];
  const ctx = makeHttpCtx({ onResponse: status => statuses.push(status) });
  try {
    let rows, read;
    if (entry.provider === 'startupjobscz') ({ rows, read } = await startupJobsCz(entry, ctx, notes, relevantTitle));
    else if (entry.provider === 'hackernews') rows = await hnHiring(entry, ctx, notes, classify);
    else if (entry.national_remote) rows = await nationalJobsCz(entry, jobsCzSession(ctx));
    else if (entry.provider === 'himalayas') rows = await searchHimalayas(ctx, entry, notes);
    else {
      const adapter = (await import('/opt/career-ops/providers/' + entry.provider + '.mjs')).default;
      rows = await adapter.fetch(entry, entry.provider === 'jobscz' ? jobsCzSession(ctx) : ctx);
    }
    if (!Array.isArray(rows)) throw new Error('Adapter returned an unexpected result');
    const truncation = boardTruncation(rows);
    if (truncation) notes.push(truncation.reason);
    if (entry.page_size && rows.length >= entry.max_pages * entry.page_size) notes.push('configured page limit reached');
    if (entry.provider === 'arbeitnow' && rows.length === entry.max_pages * 100) notes.push('configured page limit reached');
    if (!rows.length && !statuses.some(status => status >= 200 && status < 300)) throw new Error('No confirmed HTTP response');
    return { name: entry.name, provider: entry.provider, status: notes.length ? 'partial' : 'ok',
      read: read ?? rows.length, statuses, notes, jobs: rows.map(item => classify(entry, item)).filter(Boolean) };
  } catch (error) {
    return { name: entry.name, provider: entry.provider, status: 'error', read: null, statuses,
      notes: [[error.message, error.cause?.message].filter(Boolean).join(' / ')], jobs: [] };
  }
}

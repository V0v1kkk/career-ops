import jobsCz from '/opt/career-ops/providers/jobscz.mjs';
import { htmlToText } from '/opt/career-ops/providers/_html-to-text.mjs';

// Preserve the upstream paging, retries and deduplication. Its mapper drops the
// remote badges. Record them from the exact same result card before mapping.
// Jobs.cz assigns the search frontend with a first-party rollout cookie.
// Keep its own assignment stable while paging the public results.
export function jobsCzSession(ctx) {
  let bucket;
  return { ...ctx, fetchText: async (url, opts) => {
    if (new URL(url).origin !== 'https://www.jobs.cz') throw new Error('Unexpected search origin');
    const response = await ctx.fetchResponse(url, { ...opts, headers: bucket ? { cookie: bucket } : {},
      redirect: 'error' });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = /^beta_bucket=[a-zA-Z0-9_.%-]+(?=;|$)/.exec(cookie);
      if (pair) bucket = pair[0];
    }
    return response.text();
  } };
}

export async function nationalJobsCz(entry, ctx) {
  const signals = new Map();
  const capture = { ...ctx, fetchText: async (url, opts) => {
    const html = await ctx.fetchText(url, opts);
    const query = new URL(url).searchParams.get('q[]');
    for (const match of html.matchAll(/<article\b[^>]*class="SearchResultCard[^"]*"[^>]*>[\s\S]*?<\/article>/g)) {
      const card = match[0];
      const id = /data-jobad-id="(\d+)"/.exec(card)?.[1];
      if (!id) continue;
      const signal = signals.get(id) ?? { keywords: new Set() };
      signal.keywords.add(query);
      const text = htmlToText(card);
      signal.remote = /práce převážně z domova|práce (?:plně|zcela) z domova/i.test(text);
      signals.set(id, signal);
    }
    return html;
  } };
  const rows = await jobsCz.fetch(entry, capture);
  return rows.map(row => {
    const signal = signals.get(/\/rpd\/(\d+)/.exec(row.url)?.[1]);
    return { ...row, searchKeywords: [...(signal?.keywords || [])].join(', '),
      possibleRemote: Boolean(signal?.remote || /\bremote\b|100\s*%\s*home\s*office/i.test(row.title)) };
  });
}

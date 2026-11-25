// Keep the original comment for stack matching. Upstream's HN adapter only
// returns the first line, so a backend title can lose Python in the body.
import { parseHnComment, resolveLatestThreadId } from '/opt/career-ops/providers/hackernews.mjs';
import { htmlToText } from '/opt/career-ops/providers/_html-to-text.mjs';
import ashby from '/opt/career-ops/providers/ashby.mjs';

export async function hnHiring(entry, ctx, notes, classify) {
  const latest = await ctx.fetchJson('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5');
  const id = resolveLatestThreadId(latest);
  if (!id) throw new Error('Monthly hiring thread not found');
  const thread = await ctx.fetchJson('https://hn.algolia.com/api/v1/items/' + id);
  if (!Array.isArray(thread.children)) throw new Error('Missing hiring thread comments');
  const rows = [];
  const employers = new Map();
  for (const comment of thread.children) {
    if (!comment.text || comment.deleted || comment.dead) continue;
    const row = parseHnComment(comment.text, 'https://news.ycombinator.com/item?id=' + encodeURIComponent(comment.id));
    if (!row) continue;
    row.description = htmlToText(comment.text);
    row.postedAt = Date.parse(comment.created_at);
    row.company ||= entry.name;
    rows.push(row);
    if (!classify(entry, row)) continue;
    const listing = /^https:\/\/jobs\.ashbyhq\.com\/([\w-]+)\/([\da-f-]{36})(?:[/?#]|$)/i.exec(row.url);
    if (!listing) continue;
    const [, board, postingId] = listing;
    try {
      if (!employers.has(board)) {
        employers.set(board, await ashby.fetch({ name: row.company, careers_url: 'https://jobs.ashbyhq.com/' + board }, ctx));
      }
      const live = employers.get(board).find(job => new URL(job.url).pathname.split('/').pop() === postingId);
      if (live) Object.assign(row, live);
      else row.expiresAt = 1;
    } catch {
      row.possibleRemote = true;
      notes.push('Employer location unavailable: ' + row.company);
    }
  }
  return rows;
}

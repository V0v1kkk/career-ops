import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { boards, collect } from './collect.mjs';
import { normalizeUrl } from '/opt/career-ops/url-key.mjs';
import { render } from './view.mjs';

const run = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const [mode, name] = process.argv.slice(2);
if (mode === 'board') {
  const entry = boards.find(board => board.name === name);
  if (!entry) throw new Error('Unknown board');
  console.log(JSON.stringify(await collect(entry)));
} else {
  if (mode && mode !== '--audit') throw new Error('Usage: search.mjs [--audit]');
  const selected = boards.filter(board => mode === '--audit' || board.enabled !== false);
  const reports = [];
  let next = 0;
  async function worker() {
    while (next < selected.length) {
      const entry = selected[next++];
      let report;
      try {
        const { stdout, stderr } = await run(process.execPath, [script, 'board', entry.name], { timeout: entry.provider === 'startupjobscz' ? 300000 : 105000, maxBuffer: 4 * 1024 * 1024 });
        report = JSON.parse(stdout);
        const warnings = stderr.trim().split('\n').filter(Boolean);
        report.notes.push(...warnings);
        if (warnings.length && report.status === 'ok') report.status = 'partial';
      } catch (error) {
        report = { name: entry.name, provider: entry.provider, status: 'error', read: null,
          statuses: [], notes: [error.killed ? 'board timed out' : String(error.message).slice(0, 220)], jobs: [] };
      }
      reports.push(report);
      console.log([entry.name, report.status, report.read ?? '—', report.jobs.length].join(' | '));
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  reports.sort((a, b) => a.name.localeCompare(b.name));
  const jobs = new Map();
  for (const report of reports) {
    for (const posting of report.jobs) {
      const key = normalizeUrl(posting.url);
      if (!jobs.has(key)) jobs.set(key, posting);
    }
  }
  const created = new Date().toISOString();
  const snapshot = { created, sources: reports.map(({jobs, ...source}) => ({...source, matched: jobs.length})), jobs: [...jobs.values()] };
  const dir = fs.mkdtempSync('/results/run-' + created.replace(/:/g, '-') + '-');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
  if (reports.every(source => source.status === 'error')) {
    console.error('All sources failed. Kept the previous dated shortlist. Evidence: ' + dir);
    process.exitCode = 1;
  } else {
    const publicDir = '/results/public';
    fs.mkdirSync(publicDir, { recursive: true, mode: 0o700 });
    const stage = path.join(dir, 'shortlist.html');
    fs.writeFileSync(stage, render(snapshot, fs.readdirSync(publicDir).filter(file => /^python-prague-\d{4}-\d{2}-\d{2}\.html$/.test(file)).sort().reverse()), { mode: 0o600 });
    fs.copyFileSync(stage, path.join(dir, 'publish.tmp'));
    fs.renameSync(path.join(dir, 'publish.tmp'), path.join(publicDir, 'index.html'));
    console.log('Shortlist: ' + jobs.size + '. Evidence: ' + dir);
  }
}

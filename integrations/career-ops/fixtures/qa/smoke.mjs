#!/usr/bin/env node
// Run explicitly inside the pilot container; never submits an application.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const usage = `Inside Docker only:
  node smoke.mjs discover
  node smoke.mjs web-scan
  node smoke.mjs evaluate --file /data/jds/01-matched-python-backend.md --cli codex
  node smoke.mjs pdf --report 001 --cli codex
  node smoke.mjs cover --report 001 --cli codex
Options: --root /data --code /opt/career-ops --api http://127.0.0.1:3000
Each invocation creates its own evidence directory under /data/.pilot-qa/.`;
const [action, ...args] = process.argv.slice(2);
if (!action || action === '--help') { console.log(usage); process.exit(0); }
const opts = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--root', '--code', '--api', '--cli', '--file', '--report'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error(`Invalid option. ${usage}`);
  }
  opts[args[i].slice(2)] = args[i + 1];
}
if (!['discover', 'web-scan', 'evaluate', 'pdf', 'cover'].includes(action)) throw new Error(usage);
if (!fs.existsSync('/.dockerenv')) throw new Error('This harness must run inside the pilot Docker container.');
const root = path.resolve(opts.root ?? process.env.CAREER_OPS_ROOT ?? '/data');
const code = path.resolve(opts.code ?? process.env.CAREER_OPS_CODE_ROOT ?? '/opt/career-ops');
const receipt = JSON.parse(fs.readFileSync(path.join(root, '.synthetic-fixture-initialized.json'), 'utf8'));
if (receipt.fixture !== 'synthetic-python-prague-v1') throw new Error('A freshly initialized synthetic fixture is required.');
if (!fs.readFileSync(path.join(root, 'cv.md'), 'utf8').includes('SYNTHETIC TEST PROFILE')) throw new Error('Synthetic master CV marker missing.');
const evidenceRoot = path.join(root, '.pilot-qa');
fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
const evidence = fs.mkdtempSync(path.join(evidenceRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${action}-`));
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Evidence: ${evidence}`);

try {
  if (action === 'discover') {
    // /api/explore is the reverse-ATS sweep, not portals.yml Jobs.cz discovery.
    // Use the deterministic scanner directly, in the same container/data root.
    const command = [path.join(code, 'scan.mjs'), '--dry-run', '--json'];
    save('request.json', { executable: 'node', args: command, dataRoot: root, network: 'public job listing reads', llm: false });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, command, {
        cwd: root,
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: code, CAREER_OPS_PORTALS: path.join(root, 'portals.yml') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', timedOut = false, hardKill;
      const timer = setTimeout(() => {
        timedOut = true; child.kill('SIGTERM');
        hardKill = setTimeout(() => child.kill('SIGKILL'), 5000);
      }, 240_000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => { clearTimeout(timer); clearTimeout(hardKill); reject(error); });
      child.on('close', (exitCode, signal) => { clearTimeout(timer); clearTimeout(hardKill); resolve({ stdout, stderr, exitCode, signal, timedOut }); });
    });
    save('stdout.json', result.stdout); save('stderr.log', result.stderr);
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch { /* reported as failure below */ }
    const warnings = result.stderr.split('\n').filter((line) => /(?:⚠|failed|timed out)/i.test(line));
    save('result.json', { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, validJson: parsed !== null, warnings, receipt: parsed });
    if (result.exitCode !== 0 || result.timedOut || parsed === null) throw new Error('Discovery failed or was incomplete; inspect saved stdout/stderr and receipt, including per-source errors.');
    if (warnings.length) throw new Error('Discovery returned partial/degraded output or warnings; JSON exit status alone is not sufficient. Inspect stderr and saved warnings.');
    console.log('Discovery returned JSON. Inspect offers and source outcomes; zero results alone do not establish successful coverage.');
  } else {
    const base = new URL(opts.api ?? 'http://127.0.0.1:3000');
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
      throw new Error('API smoke calls are restricted to HTTP loopback inside the app container. Test authenticated LAN HTTPS separately.');
    }
    if (action !== 'web-scan' && !opts.cli) throw new Error('Pass --cli explicitly (the runtime must already be configured).');
    let input;
    if (action === 'web-scan') {
      input = null;
    } else if (action === 'evaluate') {
      if (!opts.file) throw new Error('Pass --file with a controlled JD under the synthetic data root.');
      const jdPath = fs.realpathSync(path.resolve(opts.file));
      const relative = path.relative(root, jdPath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith(`jds${path.sep}`)) throw new Error('Controlled JD must be under the synthetic data root jds/ directory.');
      input = fs.readFileSync(jdPath, 'utf8');
      if (!input.trim() || /^\s*https?:\/\//.test(input)) throw new Error('Pilot evaluation requires pasted JD text, not a URL.');
    } else {
      if (!/^\d+$/.test(opts.report ?? '')) throw new Error('Pass the actual report number with --report.');
      input = opts.report;
    }
    const payload = action === 'web-scan'
      ? { ats: ['ashby'], positive: ['python', 'backend', 'back-end'], negative: ['word:staff', 'word:principal', 'director'], allow: ['Prague', 'Praha'], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, limitPerAts: 50 }
      : { kind: action, input, cliId: opts.cli };
    if (action === 'evaluate') payload.evaluationSections = ['summary', 'customization', 'keywords'];
    if (action === 'cover') payload.brief = {
      why: 'SYNTHETIC TEST PROFILE: this fictional candidate is interested in practical Python API work with clear testing expectations. Do not invent personal knowledge of the company.',
      problem: 'Understand the API reliability and data-processing needs described in the evaluated posting. Do not assume unmentioned company problems.',
      approach: 'Use the documented FastAPI, PostgreSQL and pytest experience, with the Demo Apricot Systems examples where relevant. Keep unsupported requirements as gaps.',
      tone: 'direct',
    };
    save('request.json', payload);
    const response = await fetch(new URL(action === 'web-scan' ? '/api/explore' : '/api/run', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(action === 'web-scan' ? 240_000 : 840_000),
    });
    const streamPath = path.join(evidence, 'events.ndjson');
    const streamFd = fs.openSync(streamPath, 'wx', 0o600);
    const decoder = new TextDecoder();
    let pending = '', parseErrors = 0, done = null, summary = null, errors = [], transcript = '';
    const parseLine = (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { parseErrors++; return; }
      const type = event.type ?? event.kind;
      if (type === 'text') transcript += event.text ?? '';
      if (type === 'error' || event.error) errors.push(event.msg ?? event.message ?? event.error ?? event);
      if (type === 'done') done = event;
      if (type === 'summary') summary = event;
      if (type === 'status') console.log(event.label);
    };
    try {
      if (!response.body) throw new Error('API returned no body.');
      for await (const chunk of response.body) {
        fs.writeSync(streamFd, chunk);
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) parseLine(line);
      }
      pending += decoder.decode(); parseLine(pending);
    } finally { fs.closeSync(streamFd); }
    save('transcript.md', transcript);
    save('result.json', { httpStatus: response.status, done, summary, errors, parseErrors, reportNumber: done?.reportN ?? (action !== 'evaluate' ? input : null), evidence });
    if (!response.ok || errors.length || parseErrors || !done) throw new Error('API did not report a clean completion; inspect saved events/result.');
    if (action === 'evaluate' && !done.reportN) throw new Error('Evaluation completed without a persisted report number.');
    if (action === 'web-scan') {
      if (summary?.incomplete?.length) throw new Error('Web scan reported incomplete sources.');
      console.log(`Web scan completed: ${done.count} offers. This is a capped sample of at most 50 Ashby companies, not complete coverage.`);
    } else console.log(action === 'evaluate' ? `Persisted report: ${done.reportN}` : `API completed ${action} for report ${input}.`);
    console.log('Transport completion is not factual/style/layout approval. Inspect generated documents against qa/expected-facts.json.');
  }
} catch (error) {
  save('failure.txt', `${error instanceof Error ? error.message : String(error)}\n`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

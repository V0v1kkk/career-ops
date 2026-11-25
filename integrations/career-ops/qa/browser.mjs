#!/usr/bin/env node
// Run only inside the disposable QA container. Credentials are never logged.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, request } from '/opt/career-ops/node_modules/playwright/index.mjs';

const baseURL = process.env.CAREER_OPS_QA_URL;
if (!baseURL) throw new Error('Set CAREER_OPS_QA_URL to the pilot HTTPS origin');
const output = '/qa-output';
const auth = JSON.parse(fs.readFileSync('/qa-access.json', 'utf8'));
const results = [];
const browserErrors = [];
const attemptedAiCalls = [];
const started = new Date().toISOString();
let browser;
let authenticated;
let anonymous;

function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ name, ok, expected, actual });
  if (!ok) throw new Error(`QA check failed: ${name}`);
}

try {
  fs.mkdirSync(output, { recursive: true });
  // This disposable browser skips certificate validation only. The main QA
  // separately verifies the installed local CA, hostname and TLS with curl.
  anonymous = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  check('unauthenticated dashboard', (await anonymous.get('/')).status(), 401);
  check('unauthenticated CV API', (await anonymous.get('/api/cv')).status(), 401);

  authenticated = await request.newContext({
    baseURL, ignoreHTTPSErrors: true,
    httpCredentials: { username: auth.username, password: auth.password, send: 'always' },
  });
  const blocked = [
    ['/api/apply/session', {}], ['/api/apply/fill', {}], ['/api/apply/drive', {}],
    ['/api/apply/prefill', {}], ['/api/apply/close', {}],
    ['/api/explore/ai', { query: 'QA boundary only', cliId: '' }],
    ['/api/scheduler', {}], ['/api/scheduled-jobs', {}],
    // Empty cliId is deliberate: even an accidentally unpatched run handler
    // cannot start a model call while we test the earlier pilot gate.
    ['/api/run', { kind: 'evaluate', input: 'https://example.com/qa-job', cliId: '' }],
    ['/api/run', { kind: 'research', input: 'QA boundary only', cliId: '' }],
    ['/api/run', { kind: 'fix-portal', input: 'QA boundary only', cliId: '' }],
  ];
  for (const [endpoint, data] of blocked) {
    const response = await authenticated.post(endpoint, { data });
    check(`blocked ${endpoint}${data.kind ? ` (${data.kind})` : ''}`, response.status(), 403);
    const body = await response.json();
    check(`pilot refusal ${endpoint}${data.kind ? ` (${data.kind})` : ''}`, body.code, 'PILOT_DISABLED');
  }
  const crossOrigin = await authenticated.post('/api/run', {
    data: { kind: 'pdf', input: '001', cliId: '' },
    headers: { Origin: 'https://untrusted.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  check('cross-site request rejected', crossOrigin.status(), 403);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL, viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
    httpCredentials: { username: auth.username, password: auth.password },
  });
  // Fail closed on any unexpected AI/background operation triggered by a page.
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET' && req.method() !== 'HEAD' &&
        /^\/api\/(?:run|assistant$|explore|scheduler|scheduled-jobs|apply)/.test(url.pathname)) {
      attemptedAiCalls.push({ path: url.pathname, method: req.method() });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message.slice(0, 350)));
  const pages = [
    ['/', '01-dashboard.png'],
    ['/cv', '02-synthetic-cv.png'],
    ['/config', '03-config-privacy.png'],
    ['/explore', '04-manual-scan.png'],
    ['/apply', '05-apply-disabled.png'],
    ['/scheduled-scans', '06-schedules-disabled.png'],
  ];
  for (const [url, screenshot] of pages) {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    check(`page ${url}`, response.status(), 200);
    await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
    if (url === '/cv') {
      const text = await page.locator('body').innerText();
      const inputs = await page.locator('textarea').evaluateAll((nodes) => nodes.map((n) => n.value).join('\n'));
      check('synthetic candidate visible', /Demo Candidate Python-01|SYNTHETIC TEST PROFILE/.test(text + inputs), true);
    }
    if (url === '/') {
      check('pasted JD form visible', await page.getByLabel('Evaluate a pasted job description').count(), 1);
      check('no background scan promise', /keep scanning the market in the background/.test(await page.locator('body').innerText()), false);
      // Client validation only: a URL must not start any worker request.
      await page.getByLabel('Evaluate a pasted job description').fill('https://example.com/qa-job');
      await page.getByRole('button', { name: 'Evaluate pasted text' }).click();
      check('URL-only paste gets explanation', await page.getByRole('status').filter({ hasText: 'complete pasted job description' }).count(), 1);
      await page.getByLabel('Evaluate a pasted job description').fill('');
    }
    if (url === '/config') {
      check('honest provider privacy notice', /sent through LiteLLM to the configured AI provider/.test(await page.locator('body').innerText()), true);
    }
    if (url === '/explore') {
      check('AI search tab disabled', await page.getByRole('button', { name: /AI search/ }).isDisabled(), true);
      check('manual Scan available', await page.getByRole('button', { name: /^Scan/ }).first().isEnabled(), true);
      check('Schedule button disabled', await page.getByRole('button', { name: 'Schedule disabled' }).isDisabled(), true);
    }
    if (url === '/apply') {
      check('apply page disabled', await page.getByRole('heading', { name: 'Applications disabled' }).count(), 1);
      check('no application forms', await page.locator('form').count(), 0);
    }
    if (url === '/scheduled-scans') {
      check('scheduling page disabled', await page.getByRole('heading', { name: 'Schedules disabled' }).count(), 1);
    }
  }
  check('no page-triggered AI or scan requests', attemptedAiCalls.length, 0);
  check('no browser page errors', browserErrors.length, 0);
} catch (error) {
  results.push({ name: 'QA completion', ok: false, reason: error.message });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await authenticated?.dispose();
  await anonymous?.dispose();
  const report = {
    started, finished: new Date().toISOString(), baseURL,
    browserCertificateValidation: 'skipped in disposable QA browser; verify local CA independently',
    modelCalls: 0, results, browserErrors, blockedUnexpectedRequests: attemptedAiCalls,
  };
  fs.writeFileSync(path.join(output, 'browser-checks.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ checks: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, screenshots: fs.readdirSync(output).filter((f) => /^0\d-.*\.png$/.test(f)).length }));
}

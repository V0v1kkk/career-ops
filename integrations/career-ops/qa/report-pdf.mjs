#!/usr/bin/env node
// Targeted, read-only browser check. Never clicks generation/apply actions.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, request } from '/opt/career-ops/node_modules/playwright/index.mjs';

const baseURL = process.env.CAREER_OPS_QA_URL;
if (!baseURL) throw new Error('Set CAREER_OPS_QA_URL to the pilot HTTPS origin');
const reportNumber = process.env.CAREER_OPS_QA_REPORT || '1';
if (!/^\d+$/.test(reportNumber)) throw new Error('Invalid report number');
const auth = JSON.parse(fs.readFileSync('/qa-access.json', 'utf8'));
const output = '/qa-output';
const generated = '/qa-generated';
const padded = reportNumber.replace(/^0+(?=\d)/, '').padStart(3, '0');
const matching = fs.readdirSync(generated).filter((file) => file.endsWith('.pdf') && file.includes(`-${padded}-`));
if (matching.length !== 1) throw new Error(`Expected one generated PDF for report ${reportNumber}; found ${matching.length}`);
const expected = fs.readFileSync(path.join(generated, matching[0]));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const unexpected = [];
let browser;
let api;
const check = (name, actual, expectedValue) => {
  const ok = actual === expectedValue;
  checks.push({ name, ok, actual, expected: expectedValue });
  if (!ok) throw new Error(`QA failed: ${name}`);
};

try {
  api = await request.newContext({ baseURL, ignoreHTTPSErrors: true,
    httpCredentials: { username: auth.username, password: auth.password, send: 'always' } });
  const response = await api.get(`/api/cv-pdf?n=${reportNumber}`);
  check('authenticated PDF download', response.status(), 200);
  check('PDF content type', response.headers()['content-type'], 'application/pdf');
  const bytes = await response.body();
  check('PDF signature', bytes.subarray(0, 5).toString(), '%PDF-');
  check('download byte count matches generated PDF', bytes.length, expected.length);
  check('download SHA256 matches generated PDF', digest(bytes), digest(expected));
  fs.writeFileSync(path.join(output, 'downloaded-report-001.pdf'), bytes, { mode: 0o600 });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1200 },
    ignoreHTTPSErrors: true, httpCredentials: { username: auth.username, password: auth.password } });
  await context.route('**/*', (route) => {
    const req = route.request();
    if (!['GET', 'HEAD'].includes(req.method())) {
      unexpected.push({ method: req.method(), path: new URL(req.url()).pathname });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const report = await page.goto(`/pipeline/${reportNumber}`, { waitUntil: 'networkidle', timeout: 45_000 });
  check('report page', report.status(), 200);
  check('report company visible', /Demo Maple API Lab/.test(await page.locator('body').innerText()), true);
  check('fictional blocker prevents recommendation', await page.getByText('Review blockers first', { exact: true }).count(), 1);
  check('explicit Consider decision shown', await page.getByText('Consider', { exact: true }).count(), 1);
  check('no misleading Recommended badge', await page.getByText('Recommended', { exact: true }).count(), 0);
  check('apply still disabled', await page.getByRole('button', { name: 'Apply disabled in pilot' }).isDisabled(), true);
  const link = page.locator('a[href*="/api/cv-pdf"]').first();
  check('tailored CV download link visible', await link.isVisible(), true);
  const href = await link.getAttribute('href');
  const linked = await api.get(href);
  check('report link PDF', linked.status(), 200);
  check('report link SHA256', digest(await linked.body()), digest(expected));
  await page.screenshot({ path: path.join(output, '07-generated-report.png'), fullPage: false });
  await page.screenshot({ path: path.join(output, '08-generated-report-full.png'), fullPage: true });
  check('no mutation or model requests', unexpected.length, 0);
} catch (error) {
  checks.push({ name: 'QA completion', ok: false, reason: error.message });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await api?.dispose();
  fs.writeFileSync(path.join(output, 'report-pdf-checks.json'), JSON.stringify({
    finished: new Date().toISOString(), reportNumber, generatedFile: matching[0],
    generatedBytes: expected.length, generatedSha256: digest(expected),
    browserCertificateValidation: 'skipped in disposable QA browser; verify local CA independently',
    checks, unexpected,
  }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ checks: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length }));
}

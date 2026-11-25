#!/usr/bin/env node
// Optional offline-only report seed. Run inside Docker with the web app stopped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (!fs.existsSync('/.dockerenv')) throw new Error('Run inside the pilot Docker container, with the web app stopped.');
const root = path.resolve(process.env.CAREER_OPS_ROOT ?? '/data');
const code = path.resolve(process.env.CAREER_OPS_CODE_ROOT ?? '/opt/career-ops');
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../synthetic-python-prague');
const receipt = JSON.parse(fs.readFileSync(path.join(root, '.synthetic-fixture-initialized.json'), 'utf8'));
if (receipt.fixture !== 'synthetic-python-prague-v1') throw new Error('Synthetic initialization receipt required.');
const tracker = path.join(root, 'data/applications.md');
if (fs.readFileSync(tracker, 'utf8') !== fs.readFileSync(path.join(fixture, 'data/applications.md'), 'utf8')) throw new Error('Tracker is not the pristine empty synthetic fixture. Refusing to modify it.');
const reports = path.join(root, 'reports');
fs.mkdirSync(reports, { recursive: true });
if (fs.readdirSync(reports).length) throw new Error('Reports directory must be empty.');
const additions = path.join(root, 'batch/tracker-additions');
fs.mkdirSync(additions, { recursive: true });
if (fs.readdirSync(additions).length) throw new Error('Tracker additions directory must be empty.');
const definitions = [
  { num: '001', slug: 'demo-maple-api-lab', company: 'Demo Maple API Lab', role: 'Python Backend Developer', score: '4.2', jd: '01-matched-python-backend.md', assessment: 'Matched fixture: use Python, FastAPI/DRF, PostgreSQL, pytest integration tests, Docker and GitHub Actions only as supported by cv.md. Highlight the Apricot latency/import examples. Keep English B2 and Czech A2; Prague hybrid two days is compatible. There is one personal project only; never invent additional projects to fill a template.' },
  { num: '002', slug: 'demo-granite-platform-lab', company: 'Demo Granite Platform Lab', role: 'Senior Python Platform Engineer', score: '1.0', jd: '02-deliberate-gaps.md', assessment: 'Gap fixture: mandatory seven years, professional Kubernetes/AWS/Kafka/Terraform/Go, management of four engineers, production on-call and Czech C1 are unsupported. Five office days conflicts with the two-day preference. Shared Python/FastAPI/PostgreSQL/Docker/pytest does not close those gaps. Preserve real fictional career dates and level; no skills may be invented. No application should be recommended as a clear match.' },
];
for (const item of definitions) {
  const reportName = `${item.num}-${item.slug}-2026-11-04.md`;
  const markdown = `# Evaluation: ${item.company} — ${item.role}\n\n**SYNTHETIC TEST PROFILE — HANDWRITTEN QA REPORT, NOT AN AI EVALUATION**\n\nCandidate: Demo Candidate Python-01. This file bypasses evaluation for a controlled document-generation test. The score is an arbitrary fixture value, not a quality oracle. No company research or posting verification was performed. The employer and JD are fictional; do not fetch their example.com record URLs.\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: "${item.company}"\nrole: "${item.role}"\nscore: ${item.score}\nvia: null\n\`\`\`\n\n## Evidence and constraints\n\n${item.assessment}\n\nRead cv.md, modes/_profile.md, modes/_custom.md and qa/expected-facts.json. Keep SYNTHETIC TEST PROFILE visible in all drafts.\n\n## Full Job Description Archive\n\n${fs.readFileSync(path.join(root, 'jds', item.jd), 'utf8')}\n`;
  fs.writeFileSync(path.join(reports, reportName), markdown, { flag: 'wx', mode: 0o600 });
  const row = ['num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes', `${item.num}\t2026-11-04\t${item.company}\t${item.role}\tEvaluated\t${item.score}/5\t❌\t[${item.num}](reports/${reportName})\tSYNTHETIC HANDWRITTEN QA SEED — no AI evaluation, no application`].join('\n') + '\n';
  fs.writeFileSync(path.join(additions, `synthetic-${item.num}.tsv`), row, { flag: 'wx', mode: 0o600 });
}
const merged = spawnSync(process.execPath, [path.join(code, 'merge-tracker.mjs')], { cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_ADDITIONS: additions }, stdio: 'inherit' });
if (merged.status !== 0) throw new Error('Canonical tracker merge failed. Partial synthetic seed remains; inspect it, do not rerun against a populated workspace.');
console.log('Seeded handwritten controlled reports 001 and 002. Extraction/scoring was NOT tested.');

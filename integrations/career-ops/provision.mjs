#!/usr/bin/env node
// Host-side stdlib-only provisioning. Never prints credentials or server bodies.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = path.join(root, 'runtime/career-ops');
const ip = process.argv[2];
if (!ip || !/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) throw new Error('Pass the local private LAN IPv4 address.');
for (const dir of ['secrets', 'data', 'state', 'caddy-data', 'caddy-config', 'access', 'qa']) {
  fs.mkdirSync(path.join(runtime, dir), { recursive: true, mode: 0o700 });
}
function writePrivate(name, value) {
  fs.writeFileSync(path.join(runtime, name), value, { mode: 0o600, flag: 'wx' });
}
const keyPath = path.join(runtime, 'secrets/litellm_key');
if (!fs.existsSync(keyPath)) {
  const line = fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n').find(l => /^LITELLM_MASTER_KEY=/.test(l));
  const master = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!master) throw new Error('LITELLM_MASTER_KEY is missing.');
  const response = await fetch('http://127.0.0.1:1265/key/generate', {
    method: 'POST', headers: { Authorization: `Bearer ${master}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key_alias: 'career-ops-pilot', models: ['chatgpt/gpt-6.1-sol'],
      rpm_limit: 20, tpm_limit: 1000000,
      metadata: { purpose: 'isolated synthetic Career-Ops pilot; subscription model only' } }),
  });
  if (!response.ok) throw new Error(`LiteLLM key creation failed (HTTP ${response.status}).`);
  const result = await response.json();
  if (!result.key) throw new Error('LiteLLM returned no key.');
  writePrivate('secrets/litellm_key', `${result.key}\n`);
  console.log('Created a model-restricted LiteLLM virtual key.');
}
const check = await fetch('http://127.0.0.1:1265/v1/models', {
  headers: { Authorization: `Bearer ${fs.readFileSync(keyPath, 'utf8').trim()}` },
});
if (!check.ok) throw new Error(`Virtual key check failed (HTTP ${check.status}).`);
const models = (await check.json()).data.map(m => m.id);
if (models.length !== 1 || models[0] !== 'chatgpt/gpt-6.1-sol') throw new Error('Virtual key model restrictions differ from the pilot.');
const authPath = path.join(runtime, 'secrets/access.json');
let auth;
if (fs.existsSync(authPath)) auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
else {
  const password = randomBytes(24).toString('base64url');
  const hash = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none',
    'caddy:2-alpine@sha256:70b3180738b46cd88e49b300d790ae448a0aca3f58edef0f000bb57d619a9ab3',
    'caddy', 'hash-password'], { input: password + '\n', encoding: 'utf8' });
  if (hash.status !== 0 || !hash.stdout.trim().startsWith('$2')) throw new Error('Caddy password hashing failed.');
  auth = { username: 'career', password, hash: hash.stdout.trim() };
  writePrivate('secrets/access.json', JSON.stringify(auth, null, 2) + '\n');
}
fs.writeFileSync(path.join(runtime, 'Caddyfile'), `{
  admin off
  auto_https disable_redirects
  skip_install_trust
  default_sni ${ip}
}
https://${ip}:8443 {
  tls internal
  basic_auth {
    ${auth.username} ${auth.hash}
  }
  reverse_proxy career-ops-web:3000
}
`, { mode: 0o600 });
fs.writeFileSync(path.join(runtime, 'compose.env'), `CAREER_OPS_LAN_IP=${ip}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(runtime, 'secrets/access.txt'), `URL: https://${ip}:8443\nUsername: ${auth.username}\nPassword: ${auth.password}\n`, { mode: 0o600 });
console.log(`Provisioned https://${ip}:8443; credentials saved in runtime/career-ops/secrets/access.txt (not printed).`);

#!/usr/bin/env node
// Explicit, one-time fixture import. Never merge into an existing candidate workspace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'synthetic-python-prague');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node initialize.mjs --target /data\nTarget must be an empty, real directory. There is no overwrite option.');
  process.exit(0);
}
if (args.length !== 2 || args[0] !== '--target' || !path.isAbsolute(args[1]) || path.resolve(args[1]) === '/') {
  console.error('Require an explicit absolute target: node initialize.mjs --target /data');
  process.exit(2);
}
const target = path.resolve(args[1]);
const claim = path.join(target, '.synthetic-fixture-initializing.json');
let claimed = false;

function copyTree(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { mode: 0o700 });
      copyTree(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, 0o600);
    } else {
      throw new Error(`Fixture contains an unsupported entry: ${entry.name}`);
    }
  }
}

try {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(target).isDirectory() || fs.realpathSync(target) !== target) {
    throw new Error('Target must be a real directory, without symlink path components.');
  }
  if (fs.readdirSync(target).length !== 0) {
    throw new Error('Target is not empty. Refusing to mix synthetic data with an existing profile.');
  }
  const receipt = JSON.stringify({
    fixture: 'synthetic-python-prague-v1',
    classification: 'SYNTHETIC TEST PROFILE — not a real candidate',
    upstreamCommit: 'd5873cc74d1b2c8c6d0b3df3b656873b995e4607',
    initializedAt: new Date().toISOString(),
  }, null, 2) + '\n';
  fs.writeFileSync(claim, receipt, { flag: 'wx', mode: 0o600 });
  claimed = true;
  copyTree(fixture, target);
  for (const directory of ['reports', 'output', 'batch/tracker-additions']) {
    fs.mkdirSync(path.join(target, directory), { recursive: true, mode: 0o700 });
  }
  fs.renameSync(claim, path.join(target, '.synthetic-fixture-initialized.json'));
  console.log(`Initialized ${target} with synthetic-python-prague-v1. No model or discovery was run.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (claimed) console.error('Import stopped. Partial fixture files were left in place; inspect them or choose a fresh empty test volume. No existing files were overwritten.');
  process.exitCode = 1;
}

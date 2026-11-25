import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { buildArgs, childEnvironment, launch, MODEL } from "./launcher.mjs";

const fence = ["--ask-for-approval", "never", "exec", "-c", "sandbox_mode=read-only"];
function config(args, key) {
  return args.filter((arg, i) => args[i - 1] === "-c" && arg.startsWith(`${key}=`)).at(-1)?.slice(key.length + 1);
}

test("real help/version probes pass through without requiring a credential", () => {
  for (const argv of [["--help"], ["--version"], ["exec", "--help"]]) {
    let seen;
    launch(argv, { secretFile: "/nonexistent", env: { CAREER_OPS_LITELLM_KEY: "old-fixture" }, exec: (...args) => { seen = args; } });
    assert.deepEqual(seen[1].slice(1), argv);
    assert.equal(seen[2].CAREER_OPS_LITELLM_KEY, undefined);
  }
});

test("ordinary and isolated runs keep output/sandbox flags while pinning the provider", () => {
  const prompt = "A literal prompt with $(), quotes, newlines\nand --yolo stays data";
  for (const extra of [["--json", "--color", "never"], ["--ignore-user-config", "--strict-config", "--ephemeral", "--output-last-message", "/tmp/reply.txt"]]) {
    const { args } = buildArgs([...fence, ...extra, prompt]);
    assert.equal(config(args, "model"), JSON.stringify(MODEL));
    assert.equal(config(args, "model_provider"), '"career_litellm"');
    assert.equal(config(args, "model_providers.career_litellm.wire_api"), '"responses"');
    assert.equal(config(args, "sandbox_mode"), "read-only");
    assert.equal(config(args, "approval_policy"), '"never"');
    assert.equal(config(args, "web_search"), '"disabled"');
    assert.equal(args.filter((arg) => arg === "--ignore-user-config").length, 1);
    assert.equal(args.filter((arg) => arg === "--skip-git-repo-check").length, 1);
    assert.deepEqual(args.slice(-2), ["--", prompt]);
    for (const arg of extra) assert.ok(args.includes(arg));
  }
});

test("a document comparison can disable both shell tools without enabling them", () => {
  for (const feature of ["features.shell_tool", "features.unified_exec"]) {
    assert.equal(config(buildArgs(["exec", "-c", feature + "=false", "-"]).args, feature), "false");
    assert.throws(() => buildArgs(["exec", "-c", feature + "=true", "-"]), /refused/);
  }
});

test("bare exec is hardened and an option-looking prompt is not a CLI flag", () => {
  const { args } = buildArgs(["exec", "--yolo"]);
  assert.equal(config(args, "sandbox_mode"), '"read-only"');
  assert.deepEqual(args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
  assert.deepEqual(args.slice(-2), ["--", "--yolo"]);
});

test("unsafe, model, network, profile, and unknown overrides fail before launch", () => {
  const dangerous = [
    ["--yolo"], ["--dangerously-bypass-approvals-and-sandbox"], ["--full-auto"],
    ["--search"], ["--oss"], ["--profile", "host"], ["--model", "azure/gpt-6.1-sol"],
    ["--sandbox", "workspace-write"], ["--ask-for-approval=on-request"],
    ["-c", "sandbox_mode = 'danger-full-access'"], ["-csandbox_mode=workspace-write"],
    ["--config=sandbox_workspace_write.network_access=true"],
    ["-c", 'model_providers.career_litellm.base_url="https://elsewhere"'],
    ["-c", "features.unknown_permission_switch=true"], ["--unknown"],
  ];
  for (const argv of dangerous) assert.throws(() => buildArgs(["exec", ...argv, "prompt"]), /refused/);
  assert.throws(() => buildArgs(["login"]), /refused/);
  assert.throws(() => buildArgs(["exec", "resume", "prior-thread", "prompt"]), /refused/);
});

test("isolated state and one credential replace inherited account configuration", () => {
  const env = childEnvironment({ PATH: "/bin", CODEX_HOME: "/host/.codex", CODEX_ACCESS_TOKEN: "host", OPENAI_API_KEY: "paid", AZURE_API_KEY: "paid", DB_PASSWORD: "other", CAREER_OPS_LITELLM_KEY: "old" }, "/state/codex", "fixture");
  assert.deepEqual(env, { PATH: "/bin", CODEX_HOME: "/state/codex", CODEX_SQLITE_HOME: "/state/codex", CAREER_OPS_LITELLM_KEY: "fixture" });
});

test("missing credentials fail explicitly before any exec", () => {
  let executed = false;
  assert.throws(() => launch([...fence, "prompt"], { secretFile: "/nonexistent", exec: () => { executed = true; } }), /secret file/);
  assert.equal(executed, false);
});

test("a fake executable receives exact argv and secret only in its environment", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "career-codex-launcher-"));
  try {
    const fixtureKey = "fixture-key-not-a-real-credential";
    const key = path.join(dir, "key");
    const capture = path.join(dir, "captured.json");
    const binary = path.join(dir, "fake-codex");
    const runner = path.join(dir, "run.mjs");
    writeFileSync(key, fixtureKey, { mode: 0o600 });
    writeFileSync(binary, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),hasExpectedKey:process.env.CAREER_OPS_LITELLM_KEY===${JSON.stringify(fixtureKey)},home:process.env.CODEX_HOME,hostKeyPresent:!!process.env.OPENAI_API_KEY}));\nprocess.exit(17);\n`, { mode: 0o700 });
    const moduleUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "launcher.mjs")).href;
    const prompt = "literal shell syntax $(touch should-not-exist)";
    writeFileSync(runner, `import { launch } from ${JSON.stringify(moduleUrl)};\nlaunch(${JSON.stringify([...fence, "--json", prompt])}, ${JSON.stringify({ binary, secretFile: key, home: path.join(dir, "state") })});\n`);
    const result = spawnSync(process.execPath, [runner], { encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "host-fixture" } });
    assert.equal(result.status, 17, result.stderr);
    assert.equal(result.stdout.includes(fixtureKey), false);
    assert.equal(result.stderr.includes(fixtureKey), false);
    const output = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(output.hasExpectedKey, true);
    assert.equal(output.hostKeyPresent, false);
    assert.equal(output.home, path.join(dir, "state"));
    assert.equal(output.args.some((arg) => arg.includes(fixtureKey)), false);
    assert.deepEqual(output.args.slice(-2), ["--", prompt]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

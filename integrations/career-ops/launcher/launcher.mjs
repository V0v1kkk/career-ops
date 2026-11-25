import { mkdirSync, readFileSync, statSync } from "node:fs";

export const CODEX_BINARY = "/opt/codex/bin/codex";
export const CODEX_STATE = "/state/codex";
export const KEY_FILE = "/run/secrets/litellm_key";
export const MODEL = "chatgpt/gpt-6.1-sol";
export const PROVIDER = "career_litellm";

const PROBES = new Set([
  JSON.stringify(["--help"]), JSON.stringify(["-h"]),
  JSON.stringify(["--version"]), JSON.stringify(["-V"]),
  JSON.stringify(["exec", "--help"]), JSON.stringify(["exec", "-h"]),
  JSON.stringify(["help"]), JSON.stringify(["help", "exec"]),
]);

const BOOLEAN_OPTIONS = new Set([
  "--json", "--experimental-json", "--strict-config", "--ignore-user-config",
  "--ephemeral", "--skip-git-repo-check",
]);
const VALUE_OPTIONS = new Set([
  "--color", "--output-last-message", "-o", "--output-schema", "--image", "-i", "--cd", "-C",
]);
const PERMISSION_OPTIONS = new Map([
  ["--ask-for-approval", "never"], ["-a", "never"],
  ["--sandbox", "read-only"], ["-s", "read-only"],
]);
const PERMISSION_CONFIG = new Map([
  ["sandbox_mode", "read-only"], ["approval_policy", "never"],
  ["sandbox_workspace_write.network_access", "false"],
  ["features.shell_tool", "false"],
  ["features.unified_exec", "false"],
]);

function reject() {
  // Do not echo argv: a malformed caller could have put a credential there.
  throw new Error("Only fresh, read-only Codex exec calls with the pilot's fixed provider are allowed; unsupported flags or permission overrides were refused.");
}

function checkConfig(payload) {
  const separator = payload.indexOf("=");
  if (separator < 1) reject();
  const key = payload.slice(0, separator).trim();
  const value = payload.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!PERMISSION_CONFIG.has(key) || PERMISSION_CONFIG.get(key) !== value) reject();
}

/** Career-Ops always supplies a fresh exec call with the prompt last. */
export function buildArgs(argv) {
  if (!Array.isArray(argv) || argv.some((part) => typeof part !== "string")) reject();
  if (PROBES.has(JSON.stringify(argv))) return { probe: true, args: [...argv] };
  if (argv.length < 2) reject();
  const prompt = argv.at(-1);
  const options = argv.slice(0, -1);
  let execIndex = -1;
  let hasApproval = false;
  let hasDelimiter = false;

  for (let i = 0; i < options.length; i++) {
    const arg = options[i];
    if (arg === "exec") {
      if (execIndex !== -1) reject();
      execIndex = i;
      continue;
    }
    if (arg === "--") {
      if (i !== options.length - 1 || execIndex === -1) reject();
      hasDelimiter = true;
      continue;
    }
    if (arg === "-c" || arg === "--config") {
      if (++i >= options.length) reject();
      checkConfig(options[i]);
      continue;
    }
    if (arg.startsWith("--config=") || (arg.startsWith("-c") && arg.length > 2)) {
      checkConfig(arg.startsWith("--config=") ? arg.slice(9) : arg.slice(2));
      continue;
    }
    const equals = arg.indexOf("=");
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    if (BOOLEAN_OPTIONS.has(flag)) {
      if (equals >= 0) reject();
      continue;
    }
    if (VALUE_OPTIONS.has(flag) || PERMISSION_OPTIONS.has(flag)) {
      const value = equals < 0 ? options[++i] : arg.slice(equals + 1);
      if (value === undefined || !value.length) reject();
      if (PERMISSION_OPTIONS.has(flag) && value !== PERMISSION_OPTIONS.get(flag)) reject();
      if (flag === "--ask-for-approval" || flag === "-a") hasApproval = true;
      continue;
    }
    reject();
  }
  if (execIndex < 0) reject();

  const fixedConfig = [
    `model=${JSON.stringify(MODEL)}`,
    `model_provider=${JSON.stringify(PROVIDER)}`,
    'model_reasoning_effort="medium"',
    'model_providers.career_litellm.name="LocalAI LiteLLM subscription"',
    'model_providers.career_litellm.base_url="http://litellm-proxy:4000/v1"',
    'model_providers.career_litellm.env_key="CAREER_OPS_LITELLM_KEY"',
    'model_providers.career_litellm.wire_api="responses"',
    "model_providers.career_litellm.requires_openai_auth=false",
    'sandbox_mode="read-only"',
    'approval_policy="never"',
    'web_search="disabled"',
    'shell_environment_policy.exclude=["CAREER_OPS_LITELLM_KEY"]',
  ].flatMap((value) => ["-c", value]);
  const extraFlags = ["--ignore-user-config", "--skip-git-repo-check", "--strict-config"]
    .filter((flag) => !options.includes(flag));
  return {
    probe: false,
    args: [
      ...options.slice(0, execIndex),
      ...(hasApproval ? [] : ["--ask-for-approval", "never"]),
      "exec", ...fixedConfig, ...extraFlags,
      ...options.slice(execIndex + 1, hasDelimiter ? -1 : undefined),
      "--", prompt,
    ],
  };
}

export function childEnvironment(env, home = CODEX_STATE, key) {
  const clean = { ...env };
  for (const name of Object.keys(clean)) {
    if (/^(?:CODEX_|OPENAI_|CHATGPT_|ANTHROPIC_|AZURE_)/.test(name) ||
        /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name)) delete clean[name];
  }
  clean.CODEX_HOME = home;
  clean.CODEX_SQLITE_HOME = home;
  if (key !== undefined) clean.CAREER_OPS_LITELLM_KEY = key;
  return clean;
}

function readKey(secretFile) {
  try {
    const stat = statSync(secretFile);
    if (!stat.isFile() || stat.size === 0 || stat.size > 8192) throw new Error();
    const key = readFileSync(secretFile, "utf8").trim();
    if (!key || /\s/.test(key)) throw new Error();
    return key;
  } catch {
    throw new Error("The Career-Ops LiteLLM secret file is missing, unreadable, or invalid. No agent was started.");
  }
}

/** Replace this process so upstream cancellation/signals still reach the real CLI. */
export function launch(argv, {
  binary = CODEX_BINARY, secretFile = KEY_FILE, home = CODEX_STATE,
  env = process.env, exec = process.execve,
} = {}) {
  const invocation = buildArgs(argv);
  if (typeof exec !== "function") throw new Error("This launcher requires Node.js with process.execve on Linux; refusing a fallback execution path.");
  const key = invocation.probe ? undefined : readKey(secretFile);
  if (!invocation.probe) mkdirSync(home, { recursive: true, mode: 0o700 });
  exec(binary, [binary, ...invocation.args], childEnvironment(env, home, key));
}

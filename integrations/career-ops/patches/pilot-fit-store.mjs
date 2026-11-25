import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fitKey, fitPrompt, fitSchema, postingPassages, resumePassages, scoreFit } from "./pilot-fit.mjs";

const pending = new Map();

function run(binary, args, input, cwd, timeout) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { cwd, timeout, maxBuffer: 2 << 20, windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error(binary === "pdftotext" ? "unreadable-pdf" : "worker-failed"));
      else resolve(stdout);
    });
    // The child may exit before it consumes stdin. Its exit status above is definitive.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function prepareFit(jd, pdfPath) {
  if (!jd.trim()) throw new Error("no-archive");
  if ((await fs.stat(pdfPath)).size > 12 << 20 || jd.length > 65000) throw new Error("input-too-large");
  const pdf = await fs.readFile(/* turbopackIgnore: true */ pdfPath);
  const text = await run("pdftotext", ["-layout", "-nopgbrk", "-", "-"], pdf, os.tmpdir(), 15000);
  if (text.length > 80000) throw new Error("input-too-large");
  const resume = resumePassages(text);
  const posting = postingPassages(jd);
  if (!resume.length) throw new Error("unreadable-pdf");
  if (!posting.length) throw new Error("no-archive");
  return { key: fitKey(jd, pdf, posting, resume), posting, resume };
}

async function askModel(posting, resume, feedback) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "career-fit-"));
  try {
    const schema = path.join(tmp, "schema.json");
    const output = path.join(tmp, "answer.json");
    await fs.writeFile(schema, JSON.stringify(fitSchema), { mode: 0o600 });
    await run("codex", ["exec", "--ephemeral", "--sandbox", "read-only", "-c", "features.shell_tool=false",
      "-c", "features.unified_exec=false", "--output-schema", schema, "--output-last-message", output, "-"],
      fitPrompt(posting, resume, feedback), tmp, 240000);
    const answer = (await fs.readFile(output, "utf8")).trim();
    return JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/gi, ""));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function writeComparison(file, inputs, classify) {
  const { posting, resume } = inputs;
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    let result;
    try {
      raw = await classify(posting, resume, feedback);
      result = scoreFit(raw, posting, resume);
    } catch (err) {
      if (err.code || err.message === "worker-failed") throw err;
      feedback = err instanceof SyntaxError ? "Expected one JSON object" : err.message;
      continue;
    }
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, randomUUID() + ".tmp");
    try {
      await fs.writeFile(tmp, JSON.stringify(raw), { mode: 0o600, flag: "wx" });
      await fs.rename(tmp, file);
    } finally {
      await fs.rm(tmp, { force: true });
    }
    return result;
  }
  throw new Error("invalid-comparison");
}

// GET only reads, POST deduplicates concurrent comparisons for identical input.
// Content-addressing also keeps a late completion from replacing a newer PDF's score.
export async function savedFit(inputs, generate, cacheDir, classify = askModel) {
  const file = path.join(cacheDir, inputs.key + ".json");
  try {
    const raw = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8"));
    return scoreFit(raw, inputs.posting, inputs.resume);
  } catch (err) {
    if (err.code && err.code !== "ENOENT") throw err;
  }
  if (!generate) return null;
  if (!pending.has(file)) {
    pending.set(file, writeComparison(file, inputs, classify).finally(() => pending.delete(file)));
  }
  return pending.get(file);
}

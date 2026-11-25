#!/usr/bin/env node
import { launch } from "./launcher.mjs";

try {
  launch(process.argv.slice(2));
} catch (error) {
  // Launch errors contain no argv or credential contents.
  const message = error?.code ? `Cannot execute the pinned Codex binary (${error.code}).` : error.message;
  process.stderr.write(`career-ops codex: ${message}\n`);
  process.exitCode = 1;
}

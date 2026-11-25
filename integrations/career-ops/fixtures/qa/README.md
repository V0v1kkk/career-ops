# Pilot smoke checks

Run these commands **inside the running app container**, as its application UID. The harness refuses host execution and requires the synthetic initialization receipt. It never submits an application. Requests and results are saved under `/data/.pilot-qa/` in a new directory per invocation. The code default is `/opt/career-ops`; use `--code` if the image uses another path.

The discovery step performs real public HTTP reads with the deterministic Jobs.cz provider, using `/data/portals.yml`; it calls no model and uses the scanner's `--dry-run` to avoid populating the candidate tracker/pipeline. The harness itself writes QA evidence. The web `POST /api/explore` is a different reverse-ATS sweep and does not exercise the configured Jobs.cz board.

```sh
node /opt/pilot-integration/fixtures/qa/smoke.mjs discover
```

To check the separate browser Scan backend once, `node /opt/pilot-integration/fixtures/qa/smoke.mjs web-scan` calls `/api/explore` with Ashby only, Python/backend titles, Prague/Praha locations, seven-day recency and a 50-company cap (the API's minimum). This is a random capped sample, may return zero, and cannot establish Prague-market coverage. It makes public requests but uses no model and adds no applications. Inspect its summary for `capHit`, stale/empty datasets and incomplete sources. Jobs.cz can warn about a failed later page while still returning JSON exit0; the harness also captures stderr warnings and reports that as degraded output.

Inspect `stdout.json` and `result.json`, including per-source failures and returned URLs. For the controlled model test, use the local synthetic JD and run **sequentially**, using the actual report number from evaluation and choosing the configured CLI explicitly:

```sh
node /opt/pilot-integration/fixtures/qa/smoke.mjs evaluate --file /data/jds/01-matched-python-backend.md --cli codex
node /opt/pilot-integration/fixtures/qa/smoke.mjs pdf --report 001 --cli codex
node /opt/pilot-integration/fixtures/qa/smoke.mjs cover --report 001 --cli codex
```

Evaluation emits the actual report number in its completion output and `result.json`; use that number for PDF and cover. Repeat with `/data/jds/02-deliberate-gaps.md` if the operator wants the gap test. The pilot's patched evaluation consumes supplied text only and cannot verify online status. A clean API completion is not proof of truthful content or a good PDF. The cover route returns a draft in `transcript.md`; it does not save/render a cover PDF. PDF generation calls the real tailoring worker plus renderer and marks the tracker's PDF cell on success; it must not change status to Applied.

Exact API shapes for the pilot patch on pinned commit `d5873cc74d1b2c8c6d0b3df3b656873b995e4607`. Upstream uses URL evaluation; the pilot patch explicitly replaces that with supplied text and rejects URL-leading input:

```json
{"kind":"evaluate","input":"Full pasted job description text...","cliId":"codex","evaluationSections":["summary","customization","keywords"]}
```

```json
{"kind":"pdf","input":"001","cliId":"codex"}
```

```json
{"kind":"cover","input":"001","cliId":"codex","brief":{"why":"Candidate's reason","problem":"Problem supported by the JD","approach":"Approach supported by the CV","tone":"direct"}}
```

All use `POST /api/run` with JSON. Response bodies are newline-delimited JSON events despite their `text/plain` header. Treat any `type:error`, missing `type:done`, non-2xx HTTP status or missing evaluation `done.reportN` as failure. The harness does this, preserving the full event log. It connects only to loopback HTTP inside the application container; verify LAN TLS and Basic Auth separately through the proxy.

The smoke evaluation selects summary, CV customization and keyword coverage. Mandatory fit/evidence checks still run; optional company research, interview preparation and application drafts are omitted to keep the pilot bounded.

For controlled local JD adaptation without fetching example.com, use `seed-controlled.mjs` below **only before any evaluation**, with the web app stopped. It requires the pristine synthetic tracker and no reports. It creates clearly labelled handwritten reports and uses the canonical tracker merger. Their scores are fixture values, not AI evaluations; this does not test extraction/scoring/persistence from `/api/run evaluate`.

```sh
node /opt/pilot-integration/fixtures/qa/seed-controlled.mjs
```

Then start the web app and use report `001` for the matched JD and `002` for deliberate gaps. Read all generated content against `/data/qa/expected-facts.json`, check marker/name and metric ownership, extract PDF text, and inspect rendered pages visually. Humanizer integration is owned by the deployment; confirm its actual invocation in the configured flow rather than assuming style instructions were loaded.

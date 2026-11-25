# Synthetic Python/Prague pilot fixture

This fixture contains no real person's data. It follows Career-Ops commit `d5873cc74d1b2c8c6d0b3df3b656873b995e4607`: `config/profile.example.yml`, `templates/portals.example.yml`, `examples/cv-example.md` and the Jobs.cz provider configuration. All generated documents must remain visibly marked **SYNTHETIC TEST PROFILE**.

`synthetic-python-prague/` is a candidate data-root seed: `cv.md`, `config/profile.yml`, empty tracker and pipeline, user instructions, fictional writing samples, two controlled JDs and a QA fact inventory. It deliberately contains no API credentials, no humanizer copy and no model choice. The deployment owns those separately. The disabled Python.org fallback is optional; Jobs.cz Prague/Python is the only enabled source, capped at two listing pages.

The profile's work authorization, salary, years of experience and languages are test inputs. They are not assumptions about a real candidate or claims about the Czech labour market. Replace the whole test workspace with a separate real candidate workspace when the pilot is accepted; do not convert these fictional records into a real CV.

## Initialize an empty data volume

Run the initializer **inside the pilot Docker image before starting its usual entrypoint**. The deployment exposes this directory read-only at `/opt/pilot-integration/fixtures`; mount a fresh, dedicated test data volume at `/data` and run with the same UID/GID as the application. The image needs only Node for this step. Do not mount an existing real profile.

Inside the container:

```sh
node /opt/pilot-integration/fixtures/initialize.mjs --target /data
```

The initializer requires an explicit absolute path and refuses a nonempty target or a symlink path. Each file copy is exclusive: it cannot overwrite another file. There is no force/merge option. A completed import writes `.synthetic-fixture-initialized.json`; a failed partial import retains `.synthetic-fixture-initializing.json` and its partial files for inspection. A second invocation refuses rather than resetting the workspace.

If the deployment already seeded `/data`, choose a new empty test volume. Do not delete or overwrite its files to make this command pass. Empty output/report/addition directories are created automatically. No discovery, model call or submission is performed by initialization.

## Check the fixture inside Docker

The examples assume the pinned source checkout is `/opt/career-ops` and the candidate data root is `/data`; change only the code path if the image uses a different one. These first checks are offline and do not invoke an AI CLI:

```sh
cd /data
export CAREER_OPS_ROOT=/data
node /opt/career-ops/validate-profile.mjs --profile /data/config/profile.yml --json
node /opt/career-ops/validate-portals.mjs --file /data/portals.yml
```

For the controlled document test, use the pasted-JD API commands in [qa/README.md](qa/README.md). The pilot patches the upstream URL-based `/api/run` evaluation to accept supplied job text with a read-only, network-disabled CLI. Pass the full synthetic JD, never its example.com record URL. This exercises evaluation and persistence before CV tailoring/rendering and cover-letter drafting. These stages require the separately configured runtime/model. An optional handwritten report seed remains available for isolating document tests; it explicitly bypasses scoring.

If testing the separate direct API path, use the configured pilot endpoint/key without copying credentials into commands or chat:

```sh
cd /data
export CAREER_OPS_ROOT=/data
node /opt/career-ops/openai-eval.mjs --file /data/jds/01-matched-python-backend.md
node /opt/career-ops/merge-tracker.mjs
```

Then pass the actual report path from that run to `openai-tailor.mjs --jd /data/jds/01-matched-python-backend.md --report <actual-report-path>` and execute the PDF-render command it prints. Direct API tailoring does not automatically load all user style files; use the deployment's explicitly integrated humanizer flow for a valid style test.

## Optional public discovery

Only when the operator authorizes the public-source test, run inside Docker:

```sh
cd /data
export CAREER_OPS_ROOT=/data
node /opt/career-ops/scan.mjs --dry-run --json
```

This fetches real public listings but does not write them to the tracker/pipeline. It uses Jobs.cz's Prague/Python query plus a strict Prague/Praha location filter. Empty or incomplete output is not proof that no jobs exist; the site's markup, availability and recorded location can affect results. The fallback is disabled so a failed primary request cannot silently broaden the search.

## QA

Use `qa/expected-facts.json` to compare the final, post-humanizer documents with the source. Preserve the synthetic marker, candidate identity and every retained employer/title/date/metric. Omission of an irrelevant skill is allowed; invention and metric reassignment are failures. Check text-layer extraction and visual PDF layout. A fit score is not a pass/fail oracle. Document actual observations, model/runtime and tested artifact paths; fixture initialization alone does not establish end-to-end success.

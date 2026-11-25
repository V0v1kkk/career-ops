# Career-Ops Docker pilot

Single candidate workspace, shared through authenticated LAN HTTPS. This is a
manual pilot, not part of the main LocalAI Compose or systemd boot profile.

Upstream release 1.40.0 / web 0.18.0, commit `9170fed51af6894753a9f520074529d15e38a004`.
Source archive, Playwright image and CLI versions are pinned in `upstream.lock`.
Upstream core has no npm lock; `dependencies/package-lock.json` was resolved in
a disposable container on 2026-11-05. Web uses upstream's lock. `npm ci` and the
Next production build run only inside Docker.

## Access and lifecycle

- Open port 8443 over HTTPS on the provisioned LAN IP.
- Credentials: `runtime/career-ops/secrets/access.txt` (mode 0600, not committed).
- Public local CA: `runtime/career-ops/access/career-ops-root.crt`.
  Import this certificate into the client browser/system trust store to avoid
  the local-CA warning. Do not distribute the Caddy directory or any private key.
- App is a single workspace; the gateway password does not create individual
  Career-Ops accounts or isolate users from each other's documents.
- The address follows the host's current LAN IP. If it changes, run
  `node integrations/career-ops/provision.mjs NEW_PRIVATE_IP`, then recreate the
  two pilot services. This updates the certificate address and allowed hosts.

This Compose file assumes a running LiteLLM proxy on the external Docker network
`localai_ollama-docker`, resolvable as `litellm-proxy:4000`. The provisioner
expects its host API at localhost port 1265 and reads `LITELLM_MASTER_KEY` from
the local ignored `.env`. Set these for your installation before provisioning.

From the repository root, provision the pilot with your actual private LAN
address (192.168.x.x), then build it before starting:

```sh
node integrations/career-ops/provision.mjs YOUR_PRIVATE_LAN_IP
sh integrations/career-ops/manage.sh build
```

```sh
sh integrations/career-ops/manage.sh start
sh integrations/career-ops/manage.sh status
sh integrations/career-ops/manage.sh stop
```

Both services use `restart: "no"`. Stop preserves the candidate data and keys.
The app port 3000 is not published. Caddy publishes only LAN IP port 8443;
the admin API is disabled. The main AI services are neither recreated nor stopped.

## Data and model

Runtime data is ignored by Git under `runtime/career-ops/`:

- `real-data/` and `real-state/`: active candidate workspace and isolated Codex state.
- `data/` and `state/`: previous synthetic pilot, retained separately.
- `discovery/`: public vacancy search receipts and a dated shortlist. Only its `public/` subdirectory is served through the authenticated gateway.
- `secrets/`: restricted LiteLLM virtual key and gateway login.
- `caddy-data/`: local certificate authority including its private key.
- `qa/` and `data/.pilot-qa/`: synthetic test evidence.

The launcher fixes the Responses provider to `http://litellm-proxy:4000/v1`,
model `chatgpt/gpt-6.1-sol`, medium reasoning. The virtual key permits only that
model, 20 requests/minute and 1M tokens/minute. Concurrent requests use the
applicable proxy and subscription limits.
No fallback model is configured. Subscription OAuth remains in LiteLLM, outside
this app. The subscription can have its own limits; dollar budgets are not a
reliable quota for requests recorded at zero cost.

For PDF import and AI evaluation, relevant CV and job text travel through LiteLLM to the subscription provider. Markdown and text file drops can be reviewed and saved locally. The search container only reads public vacancy feeds and has no CV volume, model key or tracker.

## Manual search from Prague

Open `/vacancies/index.html` from the LAN. To refresh from the repository root, run `sh integrations/career-ops/manage.sh search` (also `scan`). `sources` checks the entire configured set including the reserves. Both commands produce a dated JSON receipt and a local HTML list. The previous dated receipts remain under `runtime/career-ops/discovery/run-*/`. An outage of every source leaves the previous dated list visible.

The preset lives in `discovery/portals.yml`. The collector uses the upstream provider adapters and workplace policy. For Himalayas it uses the public keyword/country search and the upstream parser. Czech remote, wider remote regions, and Prague offices have separate sections. Roles mentioning Python only in the description are collapsed. Country, hiring arrangements and stack still need confirmation from the posting. The web Explore tab also offers the upstream ATS directory scan, which uses a different set of sources.

StartupJobs.cz uses the public jobseeker MCP operations to read search results and offer details. Search facets can return partial matches, so the detail must still permit remote work. The national Jobs.cz search runs alongside Prague and retains potential home-office roles elsewhere for review. The HN hiring board uses the latest monthly thread, reads the post body for Python, and checks linked Ashby positions against the employer listing. The HTML list links earlier dated shortlists.

Open `/cv` to add the real document. Markdown, text and text-based PDF work with this Codex setup. For Word or a scanned PDF use a text PDF export or paste the text in the editor. On Today, paste the complete description of a selected role to evaluate it against the saved CV. The report offers the tailored PDF and the cover letter with humanizer.

## Pilot scope

The **See tailored CV comparison** link on a report opens the evidence for that role. **Compare tailored PDF** sends the archived posting and text from the report's indexed CV PDF to the configured read-only Codex worker through LiteLLM. Opening a report reads the saved comparison. Replacing the posting or PDF makes a new comparison available to run. Each finding links back to passages in the posting and PDF. The percentage is the share of explicit candidate requirements fully supported by the PDF. Duties, preferences and practical conditions have their own counts. The initial role assessment is stored separately.

- Normal deterministic discovery scripts can read public vacancy sites.
- AI workers are Codex only, read-only, with web search/tool network disabled.
- The backend writes structured reports and renders HTML into PDF itself.
- Application/autofill endpoints, AI Explore, scheduled jobs and portal repair
  are blocked. Evaluate requires pasted job text; URL-only evaluation is refused.
- Cover generation produces a draft in the task transcript; cover PDF was not
  added as a custom feature.
- Cover drafts use short connected paragraphs and one or two relevant examples.
  Source wording may be paraphrased; employers, roles, dates, metrics, attribution
  and uncertainty must remain accurate. Verbatim CV bullets and metric/keyword
  quotas are no longer required. The 150–220-word preference is a soft target.
- Humanizer is a candidate-specific copy of the user's v2.1.1 skill. Its factual
  constraints take precedence over examples suggesting invented personality.
  Only this selected style file is copied, not the user's whole skills/home tree.

The container runs as UID 1000 with a read-only root filesystem, no Linux
capabilities, no-new-privileges and separate data/state mounts. The AI process
uses the app UID: the scoped LiteLLM key file is readable to that UID. Environment
filtering is not a claim that the agent cannot read the file. Do not place other
credentials in this workspace.

## Rebuild and repeat tests

```sh
sh integrations/career-ops/manage.sh build
sh integrations/career-ops/manage.sh start
sh integrations/career-ops/manage.sh scan
```

The `codex/career-ops-eu` branch packages the pinned Career-Ops source with
the Docker pilot overlay. Build and run using `compose.career-ops.yml`.
Runtime data is excluded from the repository.

For a release upgrade, compare the release tag with `upstream.lock`, inspect changed files and newly added API routes, then adapt the overlay on the maintenance branch. Update the source revision/archive digest in the lock and Dockerfile, the image tag, and only reviewed upstream hashes. Build the candidate image. Before applying patches the build runs the overlay, launcher and geography tests offline. The patcher also rejects changed source files. Exercise the new version on a separate synthetic workspace, then recreate only `career-ops-web` in the active checkout after bringing over the reviewed integration and Compose files. The HTML shortlist and candidate volumes persist independently of the image.

See `fixtures/README.md` and `fixtures/qa/README.md` for synthetic test inputs.
Fixture import refuses a nonempty target and never runs automatically on startup.
The default `start` prepares the real workspace with the Prague search preferences and a blank CV editor. Seeding leaves existing candidate files alone. The synthetic smoke harness is used only on an explicit demo data mount.

To return to the previous tested version and its original demo workspace:

```sh
CAREER_OPS_IMAGE=localai/career-ops:d5873cc-pilot CAREER_OPS_DATA_SUBDIR=data CAREER_OPS_STATE_SUBDIR=state \
  docker compose --env-file runtime/career-ops/compose.env -f compose.career-ops.yml up -d --no-deps --no-build --wait career-ops-web
```

The next ordinary `start` selects the current release and real workspace again.

Local TLS setup follows [Caddy internal TLS](https://caddyserver.com/docs/caddyfile/directives/tls)
and [default SNI for IP-address clients](https://caddyserver.com/docs/caddyfile/options#default-sni).

# Career-Ops Codex launcher

Install `codex.mjs` and `launcher.mjs` together, make the entrypoint executable,
and symlink it as `/usr/local/bin/codex`. The real pinned CLI stays at
`/opt/codex/bin/codex`. Use Node.js 24 in the image (`process.execve` is required).

The launcher permits only fresh `exec` calls and exact help/version probes.
It fixes the LiteLLM subscription route, Responses API, medium reasoning,
read-only sandbox, approval `never`, and disabled model web search. Incoming
unsafe flags or conflicting configuration are rejected. A native sandbox error
remains an error; there is no unsandboxed fallback. Validate the native sandbox
inside the final image before allowing real AI jobs.

It reads `/run/secrets/litellm_key` only for an actual run and passes the key in
the child environment, never argv. Codex state is isolated at `/state/codex`;
inherited Codex/OpenAI credentials are removed, and user config is ignored.
This prevents accidental reuse of host credentials, not all access to a secret
by code running as the same Unix user. Use a revocable key restricted to Sol.

The parent process is replaced, preserving upstream process-group cancellation
and the real CLI exit code. The CLI's help text is not synthesized or changed.

Run the deterministic contract tests without a model:

```sh
node --test integrations/career-ops/launcher/launcher.test.mjs
```

Pinned package recommendation checked against the npm registry on 2026-11-04:
`@openai/codex@0.166.0` (stable, published 2026-10-29).
References: [Codex CLI options](https://learn.chatgpt.com/docs/cli/reference),
[provider configuration](https://learn.chatgpt.com/docs/config-file/config-advanced),
[npm package metadata](https://registry.npmjs.org/@openai%2fcodex/0.166.0).

## Native sandbox inside Docker

`seccomp-codex.json` is derived from the exact Docker 29.9.2 engine source
commit [`0367cbeb49b9d98cb0b4f51e95f7b54b4803e76c`](https://github.com/moby/moby/blob/0367cbeb49b9d98cb0b4f51e95f7b54b4803e76c/vendor/github.com/moby/profiles/seccomp/default.json).
The original JSON SHA-256 is
`785b2429264afba4d594320337cb17f144f3c7d51585f9805eef72e28f4f9334`.
All 37 original rules and top-level default-deny settings are preserved.
The vendored source license is included as `seccomp-LICENSE`.

Default Docker seccomp denied bubblewrap `clone(0x78020011)` with `EPERM`.
A disposable own-child ptrace diagnostic established each additional syscall
needed by Codex 0.166.0 before an exception was added. The only additions are:

| Syscall | Allowed argument |
| --- | --- |
| `clone` | flags exactly `0x78020011`: new user, mount, PID, network, IPC namespaces and SIGCHLD |
| `unshare` | flags exactly `0x10000000`: user namespace |
| `mount` | flags exactly one of `0x8c000`, `0x6`, `0xc0edd000`, `0xd000`, `0xa`, `0x209027`, `0xe`, `0x20902f`, `0x9027`, `0x4c000` |
| `pivot_root` | permitted; kernel namespace-capability checks remain |
| `umount2` | flags exactly `0x2`: detach |

The mount values cover temporary filesystems, bind mounts, read-only remounts,
and private/slave propagation. Seccomp cannot inspect path-pointer contents,
so these are flag restrictions, not path restrictions. `setns` and `clone3`
receive no added permission. This profile is tied to the tested amd64 Linux
image, CLI and mount layout; retest when those change.

These exceptions expose more unprivileged user-namespace and mount kernel
code than Docker's default profile. The outer container still uses UID 1000,
all capabilities dropped, `no-new-privileges`, and a read-only root. Mount and
pivot operations need capabilities acquired only inside the new user
namespace. No host or outer-container capabilities, daemon settings, host
sysctls, or unconfined profile are used. Codex's inner sandbox then drops its
capabilities and enforces read-only files and denied network access.

The native `features.use_legacy_landlock=true` alternative was tested and
refused this filesystem-restricted policy because app-server socket isolation
requires bubblewrap. It is not enabled. Codex handles the container's blocked
fresh proc mount using its native restricted-container path.

`entrypoint.sh` performs a no-model `/bin/true` sandbox check using temporary
Codex state and refuses service startup when it fails. No credential is passed
to this check. The launcher still has no unsandboxed fallback.

The substantive no-model test uses `sandbox-probe.py` inside a disposable
container with writable underlying `/data` and `/tmp`:

```sh
docker run --rm --network localai_ollama-docker --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp="$PWD/integrations/career-ops/launcher/seccomp-codex.json" \
  --user 1000:1000 \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000 \
  --tmpfs /state:rw,nosuid,nodev,size=64m,uid=1000,gid=1000 \
  --tmpfs /data:rw,nosuid,nodev,size=64m,uid=1000,gid=1000 \
  --mount type=bind,src="$PWD/integrations/career-ops/launcher/sandbox-probe.py",dst=/sandbox-probe.py,readonly \
  -e CODEX_HOME=/state/codex --workdir /data --entrypoint /bin/sh \
  localai/career-ops-runtime:codex-0.166.0 -c \
  'mkdir -p /state/codex; echo CAREER_SANDBOX_READ_OK > /data/readonly-probe.txt; /opt/codex/bin/codex sandbox -c sandbox_mode="read-only" -- python3 /sandbox-probe.py'
```

On 2026-11-05 this proved allowed file read, rejected writes to `/data` and
`/tmp`, rejected IPv4 TCP, UDP DNS transport, IPv6 TCP, zero effective
capabilities, and `NoNewPrivs=1`. It does not claim exhaustive escape testing.

One authorized live wrapper invocation through LiteLLM Responses then used a
real shell tool call to read a synthetic marker and returned its exact value.
It consumed 24,836 input tokens (12,288 cached) and 66 output tokens; CLI system
and tool context dominates even a tiny task. No real CV was used. Nonsecret
results and synthetic event logs are under `runtime/career-ops/qa/`.

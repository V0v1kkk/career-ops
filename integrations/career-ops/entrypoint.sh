#!/bin/sh
set -eu
if [ ! -s /run/secrets/litellm_key ]; then
    echo 'Career-Ops: dedicated LiteLLM key is missing.' >&2
    exit 1
fi
if [ ! -f /data/cv.md ]; then
    echo 'Career-Ops: this workspace has no CV yet; add one through the web onboarding.' >&2
fi
mkdir -p /state/codex /state/cache /data/output /data/reports /data/data
sandbox_check_state=$(mktemp -d /state/sandbox-check.XXXXXX)
if ! (cd / && CODEX_HOME="$sandbox_check_state" CODEX_SQLITE_HOME="$sandbox_check_state" \
    /opt/codex/bin/codex sandbox -c 'sandbox_mode="read-only"' -- /bin/true); then
    rm -rf "$sandbox_check_state"
    echo 'Career-Ops: native read-only Codex sandbox is unavailable; refusing to start.' >&2
    exit 1
fi
rm -rf "$sandbox_check_state"
exec "$@"

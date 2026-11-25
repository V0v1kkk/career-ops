#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
compose() { docker compose --env-file runtime/career-ops/compose.env -f compose.career-ops.yml "$@"; }
prepare_real() {
  umask 077
  target=runtime/career-ops/real-data
  if [ -e "$target/.synthetic-fixture-initialized.json" ] || [ -e "$target/SYNTHETIC_TEST_PROFILE.md" ]; then
    echo 'The real workspace contains a demo marker. Check the selected directory.' >&2
    return 1
  fi
  mkdir -p "$target/config" "$target/modes" "$target/data/templates" runtime/career-ops/real-state runtime/career-ops/discovery/public
  seed_file() {
    if [ ! -e "$target/$2" ]; then cp -n "integrations/career-ops/$1" "$target/$2"; fi
  }
  seed_file real-workspace/profile.yml config/profile.yml
  seed_file real-workspace/profile.md modes/_profile.md
  seed_file discovery/portals.yml portals.yml
  seed_file fixtures/synthetic-python-prague/data/templates/cv-template.pilot-compact.html data/templates/cv-template.pilot-compact.html
}
case "${1:-status}" in
  build)
    export BUILDX_CONFIG="$ROOT/runtime/career-ops/buildx"
    compose build ;;
  start) prepare_real; compose up -d --no-build ;;
  prepare-real) prepare_real ;;
  stop) compose down ;;
  status) compose ps ;;
  logs) compose logs --tail 80 ;;
  scan|search|sources)
    umask 077
    mkdir -p runtime/career-ops/discovery/public
    if [ "$1" = sources ]; then
      compose run --rm --no-deps -T career-ops-search --audit
    else
      compose run --rm --no-deps -T career-ops-search
    fi ;;
  *) echo 'Usage: sh integrations/career-ops/manage.sh {build|start|stop|status|logs|scan|search|sources|prepare-real}' >&2; exit 2 ;;
esac

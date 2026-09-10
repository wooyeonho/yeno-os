#!/bin/sh
set -eu
umask 077

command -v flock >/dev/null 2>&1 || {
  echo 'YENO startup requires util-linux flock in the Render runtime.' >&2
  exit 1
}
node runtime/service.mjs --preflight-render
export YENO_DATA_DIR="${YENO_DATA_DIR:-/var/data/yeno}"
exec flock --exclusive --nonblock --no-fork "$YENO_DATA_DIR/.container-runtime.flock" node runtime/service.mjs

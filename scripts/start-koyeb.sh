#!/bin/sh
set -eu
umask 077

command -v flock >/dev/null 2>&1 || {
  echo 'YENO startup requires util-linux flock in the Koyeb image.' >&2
  exit 1
}
node runtime/service.mjs --preflight-koyeb
export YENO_DATA_DIR="${YENO_DATA_DIR:-/var/lib/yeno/data}"
exec flock --exclusive --nonblock --no-fork "$YENO_DATA_DIR/.container-runtime.flock" node runtime/service.mjs

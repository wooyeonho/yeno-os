#!/bin/sh
set -eu
umask 077

command -v flock >/dev/null 2>&1 || {
  echo 'YENO startup requires util-linux flock in the Koyeb image.' >&2
  exit 1
}

# Koyeb secrets can be created from pasted/file-backed values. Normalize only
# leading/trailing whitespace before the token is validated or hashed so a
# trailing newline cannot make every Android pairing attempt fail. The secret
# value is never logged.
if [ "${YENO_TOKEN+x}" = x ]; then
  YENO_TOKEN="$(node -e 'process.stdout.write((process.env.YENO_TOKEN || "").trim())')"
  export YENO_TOKEN
fi

node runtime/service.mjs --preflight-koyeb
export YENO_DATA_DIR="${YENO_DATA_DIR:-/var/lib/yeno/data}"
exec flock --exclusive --nonblock --no-fork "$YENO_DATA_DIR/.container-runtime.flock" node runtime/service.mjs

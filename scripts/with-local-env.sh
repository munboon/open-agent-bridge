#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$(readlink -f -- "$0")")/.."
export PATH="$PWD/.local/tools/node-v24.15.0-linux-x64/bin:/usr/lib/postgresql/18/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
export AGE_BINARY=/usr/bin/age
export AGE_KEYGEN_BINARY=/usr/bin/age-keygen
if [[ ${1:-} == --test ]]; then test_database=1; shift; else test_database=0; fi
if [[ -f .local/postgres/development.env ]]; then
 set -a
 source .local/postgres/development.env
 [[ ! -f .local/postgres/app.env ]] || source .local/postgres/app.env
 set +a
fi
if [[ $test_database == 1 ]]; then export DATABASE_URL="${TEST_DATABASE_URL:?Initialize the development database first}"; fi
exec "$@"

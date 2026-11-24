#!/usr/bin/env bash
#
# Runs ON the VPS, piped over ssh by .github/workflows/deploy-vps.yml (WP-08).
# It is not meant to be run by hand, but it is readable on purpose: when a deploy
# fails at 2 a.m., this file is the whole story.
#
# Contract (§14): pull the images built for this commit, run the migrations in
# their own container, bring the stack up, and prove it with a smoke test against
# /readyz — which reads the database. Any failure restores the previous tags, so
# the environment keeps serving the version that worked.
#
# Additive-only migrations (§14, S4) are what make that rollback safe: the older
# image still understands a database that only gained columns.
set -euo pipefail

: "${APP_DIR:?APP_DIR is required}"
: "${DOMAIN:?DOMAIN is required}"
: "${NODE_IMAGE:?NODE_IMAGE is required}"
: "${WEB_IMAGE:?WEB_IMAGE is required}"

cd "$APP_DIR"

# `env` holds the application secrets and the interpolation values (POSTGRES_*,
# APP_DOMAIN). `images.env` holds only the two tags, so a rollback is a file swap.
COMPOSE=(docker compose -p mw-demo --env-file env --env-file images.env -f compose.prod.yaml)

rollback() {
	echo "deploy: restoring the previous version" >&2
	if [[ -f images.env.previous ]]; then
		mv images.env.previous images.env
		"${COMPOSE[@]}" pull || true
		"${COMPOSE[@]}" up -d --remove-orphans || true
		echo "deploy: the previous version is serving again" >&2
	else
		echo "deploy: no previous tags recorded; nothing to restore" >&2
	fi
}

# A single failure path. With additive migrations the database is compatible with
# both images, so going back is always allowed.
trap 'status=$?; if [[ $status -ne 0 ]]; then rollback; fi' EXIT

# Record what is running now, before replacing it.
if [[ -f images.env ]]; then
	cp images.env images.env.previous
fi

cat >images.env <<EOF
NODE_IMAGE=$NODE_IMAGE
WEB_IMAGE=$WEB_IMAGE
EOF

echo "deploy: pulling $NODE_IMAGE and $WEB_IMAGE"
"${COMPOSE[@]}" pull

echo "deploy: applying migrations"
# A broken migration stops here, before api and worker are replaced.
"${COMPOSE[@]}" run --rm migrate

echo "deploy: starting the stack"
"${COMPOSE[@]}" up -d --remove-orphans

echo "deploy: waiting for /readyz on https://$DOMAIN"
for attempt in $(seq 1 30); do
	if curl -fsS "https://$DOMAIN/readyz" >/dev/null 2>&1; then
		echo "deploy: /readyz answered 200 after $attempt attempt(s)"
		# Success: forget the rollback target and drop the failure trap.
		rm -f images.env.previous
		trap - EXIT
		exit 0
	fi
	sleep 2
done

echo "deploy: /readyz did not answer 200 within 60 seconds" >&2
exit 1

#!/bin/sh
# Runs on the box, called by .github/workflows/deploy.yml after `git pull`. Argument: the gzipped image tarball
# that the runner scp'd over. The image inside is tagged collected:candidate; $IMAGE:latest (the GHCR name that
# docker-compose.yml runs, retagged locally so `compose up` never pulls over it) is what compose runs.
#
#   backup -> load candidate -> latest becomes prev -> candidate becomes latest -> compose up -> wait for /api/health
#   on failure: prev becomes latest again, compose up, exit 1 (the database may already have been migrated by the
#   new image; the app wrote a pre-migration snapshot to data/backups/pre-<tag>-<stamp>.db before doing so).
set -eu

TARBALL=${1:-/tmp/collected.tar.gz}
IMAGE=${IMAGE:-ghcr.io/priyam-k/collected}
cd "$(dirname "$0")/.."

echo "== backup"
DATA_DIR="$PWD/data" BACKUP_DIR="$PWD/backups" COMPOSE_DIR="$PWD" sh scripts/backup.sh

echo "== load"
gunzip -c "$TARBALL" | docker load
rm -f "$TARBALL"
docker image inspect collected:candidate >/dev/null

echo "== swap"
docker tag "$IMAGE:latest" "$IMAGE:prev" 2>/dev/null || echo "no $IMAGE:latest yet; nothing to roll back to"
docker tag collected:candidate "$IMAGE:latest"
docker compose up -d --pull never

echo "== health"
# Right after a restart the box is busy (image load, migrations, six boot-time syncs); allow a few minutes.
i=0
while [ $i -lt 36 ]; do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "healthy"
    docker image prune -f >/dev/null
    exit 0
  fi
  i=$((i + 1))
  sleep 5
done

echo "app did not become healthy within 3 minutes" >&2
if docker image inspect "$IMAGE:prev" >/dev/null 2>&1; then
  docker tag "$IMAGE:prev" "$IMAGE:latest"
  docker compose up -d --pull never
  echo "ROLLED BACK to the previous image. The database may have been migrated by the new image;" >&2
  echo "the pre-migration snapshot, if any, is in data/backups/ (pre-<tag>-<stamp>.db); tonight's dump is in backups/." >&2
else
  echo "no $IMAGE:prev to roll back to; the failed image is still $IMAGE:latest" >&2
fi
docker compose ps
exit 1

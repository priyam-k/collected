#!/bin/sh
# Nightly backup of the collected database. Runs on the box from cron and from the deploy script.
#
#   DATA_DIR             where collected.db and .secret_key live        (default /srv/collected/data)
#   BACKUP_DIR           where dumps go                                  (default /srv/collected/backups)
#   COMPOSE_DIR          the checkout with docker-compose.yml, used only for the fallback (default: parent of DATA_DIR)
#   BACKUP_BUCKET        optional; a `gs://bucket/prefix` for `gcloud storage cp`, or a path under the rclone remote
#   BACKUP_RCLONE_REMOTE optional; when set, `rclone copyto` to "$BACKUP_RCLONE_REMOTE:$BACKUP_BUCKET/" instead of gcloud
#
# Produces $BACKUP_DIR/collected-YYYY-MM-DD.db.gz (a consistent single-file copy: `sqlite3 .backup`, or `VACUUM INTO`
# through the app container's @libsql/client when sqlite3 is not installed), keeps 14 days, and copies .secret_key to
# $BACKUP_DIR/secret_key once. The key never goes to the bucket: a dump without it is unreadable, which is the point.
set -eu

DATA_DIR=${DATA_DIR:-/srv/collected/data}
BACKUP_DIR=${BACKUP_DIR:-/srv/collected/backups}
COMPOSE_DIR=${COMPOSE_DIR:-$(dirname "$DATA_DIR")}
DB="$DATA_DIR/collected.db"
stamp=$(date +%F)
out="$BACKUP_DIR/collected-$stamp.db"

if [ ! -f "$DB" ]; then
  echo "backup: $DB does not exist yet, nothing to back up"
  exit 0
fi

umask 077
mkdir -p "$BACKUP_DIR"
rm -f "$out" "$out.gz"

# The database is 0600 and owned by the container's user, which is usually not the cron user, so sqlite3 on the
# host only works when the file is readable (and its -shm writable). Otherwise go through the container.
if command -v sqlite3 >/dev/null 2>&1 && [ -r "$DB" ] && sqlite3 "$DB" ".backup '$out'" 2>/dev/null; then
  :
else
  rm -f "$out"
  # The container has node and @libsql/client; its root filesystem is read-only except
  # /tmp (tmpfs) and /data, so VACUUM INTO a temp file there and stream it back over exec's stdout.
  (cd "$COMPOSE_DIR" && docker compose exec -T app node -e '
    const { createClient } = require("@libsql/client");
    const fs = require("node:fs");
    const tmp = "/tmp/collected-backup-" + process.pid + ".db";
    (async () => {
      const c = createClient({ url: "file:/data/collected.db" });
      await c.execute("VACUUM INTO '"'"'" + tmp + "'"'"'");
      c.close();
      await new Promise((res, rej) => fs.createReadStream(tmp).on("error", rej).on("end", res).pipe(process.stdout, { end: false }));
      fs.unlinkSync(tmp);
    })().catch((e) => { console.error("backup failed:", e.message); process.exit(1); });
  ' > "$out")
fi

# Sanity: a SQLite file starts with this 16-byte header.
if [ "$(head -c 15 "$out" 2>/dev/null)" != "SQLite format 3" ]; then
  echo "backup: $out is not a SQLite database, aborting" >&2
  rm -f "$out"
  exit 1
fi

if [ ! -e "$BACKUP_DIR/secret_key" ]; then
  if cp "$DATA_DIR/.secret_key" "$BACKUP_DIR/secret_key" 2>/dev/null; then
    chmod 600 "$BACKUP_DIR/secret_key"
    echo "backup: copied .secret_key to $BACKUP_DIR/secret_key (keep a second copy somewhere off this box)"
  else
    echo "backup: could not read $DATA_DIR/.secret_key; copy it by hand, the dumps are useless without it" >&2
  fi
fi

gzip -f "$out"
chmod 600 "$out.gz"
find "$BACKUP_DIR" -name 'collected-*.db.gz' -type f -mtime +14 -exec rm -f {} +

if [ -n "${BACKUP_BUCKET:-}" ]; then
  if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
    rclone copyto "$out.gz" "$BACKUP_RCLONE_REMOTE:$BACKUP_BUCKET/collected-$stamp.db.gz"
  else
    gcloud storage cp "$out.gz" "$BACKUP_BUCKET/"
  fi
fi

echo "backup: $out.gz ($(du -h "$out.gz" | cut -f1))"

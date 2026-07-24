#!/bin/sh
set -eu

DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-90}"

if [ -n "${DB_SERVER:-}" ] && [ -n "${DB_PORT:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ]; then
  echo "[entrypoint] Waiting for PostgreSQL at ${DB_SERVER}:${DB_PORT}..."
  start_time="$(date +%s)"

  while ! PGPASSWORD="${DB_PASSWORD:-}" pg_isready -h "${DB_SERVER}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
    now="$(date +%s)"
    elapsed="$((now - start_time))"

    if [ "${elapsed}" -ge "${DB_WAIT_TIMEOUT}" ]; then
      echo "[entrypoint] Timed out after ${DB_WAIT_TIMEOUT}s waiting for PostgreSQL."
      exit 1
    fi

    sleep 2
  done

  echo "[entrypoint] PostgreSQL is ready. Starting Node.js app..."
else
  echo "[entrypoint] DB wait skipped because DB_SERVER/DB_PORT/DB_USER/DB_NAME are not fully set."
fi

exec "$@"
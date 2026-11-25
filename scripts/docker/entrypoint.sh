#!/bin/sh
set -eu

DATA_DIR="${OA_DATA_DIR:-/data}"
ATT_DIR="${ATTACHMENT_DIR:-${DATA_DIR}/attachments}"
UPL_DIR="${STORAGE_LOCAL_DIR:-${DATA_DIR}/uploads}"

DB_RAW="${DATABASE_URL:-file:${DATA_DIR}/db/oa.db}"
DB_PATH="${DB_RAW#file:}"
DB_PATH="${DB_PATH%%\?*}"
DB_DIR="$(dirname "${DB_PATH:-${DATA_DIR}/db/oa.db}")"
BACKUP_DIR="${OA_BACKUP_DIR:-${DB_DIR}/backups}"

# 确保挂载目录存在（SQLite WAL 需对数据库所在目录具备写权限以创建 -wal / -shm）
mkdir -p "${DB_DIR}" "${BACKUP_DIR}" "${ATT_DIR}"
if [ "${STORAGE_DRIVER:-local}" != "s3" ]; then
  mkdir -p "${UPL_DIR}"
fi

# 适配飞牛 NAS / 群晖等宿主机挂载目录权限：
# - 以 root 启动且显式配置了 PUID / PGID 时，自动修正数据目录属主并降权运行；
# - 未配置 PUID / PGID（或以 --user 非 root 启动）时直接执行，避免因宿主机目录属主差异导致 SQLite 只读报错。
if [ "$(id -u)" = "0" ] && { [ -n "${PUID:-}" ] || [ -n "${PGID:-}" ]; }; then
  TARGET_UID="${PUID:-1000}"
  TARGET_GID="${PGID:-1000}"
  chown -R "${TARGET_UID}:${TARGET_GID}" "${DB_DIR}" "${BACKUP_DIR}" "${ATT_DIR}" 2>/dev/null || true
  if [ "${STORAGE_DRIVER:-local}" != "s3" ]; then
    chown -R "${TARGET_UID}:${TARGET_GID}" "${UPL_DIR}" 2>/dev/null || true
  fi
  exec setpriv --reuid="${TARGET_UID}" --regid="${TARGET_GID}" --clear-groups "$@"
fi

exec "$@"

#!/usr/bin/env bash
# Oligool VM updater: pull the latest code, refresh backend deps (incl. the
# git-pinned strider-dna version, which `git pull` alone does NOT reinstall),
# rebuild the frontend, and restart the systemd service.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only

if [ -d backend/venv ]; then
  backend/venv/bin/pip install -r backend/requirements.txt
  # pip skips git-VCS dependencies whose resolved version is unchanged
  # ("Requirement already satisfied"), silently leaving stale strider builds
  # in place when only the branch content moved.  Force-reinstall just it.
  backend/venv/bin/pip install --force-reinstall --no-deps \
    "strider-dna @ git+https://github.com/KowalskiBio/strider.git@mathews2004-dangles"
fi

if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm install && npm run build)
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^oligool\.service'; then
  sudo systemctl restart oligool.service
fi

echo "Oligool is up to date."

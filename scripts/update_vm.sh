#!/usr/bin/env bash
# Oligool VM updater: pull the latest code, refresh backend deps (incl. the
# git-pinned strider-dna version, which `git pull` alone does NOT reinstall),
# rebuild the frontend, and restart the systemd service.
set -euo pipefail
# The strider native extension builds via setuptools-rust, which needs cargo on
# PATH.  cargo lives in ~/.cargo/bin (rustup), present in *login* shells but NOT
# in non-login/non-interactive invocations (ssh exec, systemd, cron).  strider's
# ext-modules are optional=true, so a missing cargo doesn't fail the build —
# it silently ships a pure-Python wheel.  Export it here so the extension is
# always built, regardless of how this script was invoked.
export PATH="$HOME/.cargo/bin:$PATH"
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

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
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/.."

git pull --ff-only

# `git pull` can rewrite THIS file. Bash does not reliably reread a script's
# own remaining lines after its underlying file changes mid-execution: we've
# seen it keep the pre-pull text of the hardcoded strider pin below, silently
# reinstalling a stale version even though `git pull` had already fetched the
# new one. Re-exec fresh from disk (by absolute path, since cwd has since
# changed) once, right after the pull, so every line after this point is
# guaranteed to come from the just-pulled file. The guard env var stops this
# from looping.
if [ -z "${OLIGOOL_UPDATE_REEXECED:-}" ]; then
  export OLIGOOL_UPDATE_REEXECED=1
  exec bash "$SCRIPT_PATH" "$@"
fi

if [ -d backend/venv ]; then
  backend/venv/bin/pip install -r backend/requirements.txt
  # pip skips git-VCS dependencies whose resolved version is unchanged
  # ("Requirement already satisfied"), silently leaving stale strider builds
  # in place when only the branch content moved.  Force-reinstall just it.
  backend/venv/bin/pip install --force-reinstall --no-deps \
    "strider-dna @ git+https://github.com/EmilioVenegas/strider.git@c695359dbc24d4c059fccef4b8e12e60850709ad"
fi

if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm install && npm run build)
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^oligool\.service'; then
  sudo systemctl restart oligool.service
fi

echo "Oligool is up to date."

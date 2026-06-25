#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/release.sh patch       # 0.1.0 → 0.1.1
#   ./scripts/release.sh minor       # 0.1.0 → 0.2.0
#   ./scripts/release.sh major       # 0.1.0 → 1.0.0
#   ./scripts/release.sh 1.2.3       # explicit version

BUMP=${1:-patch}

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}▸ $*${RESET}"; }
ok()    { echo -e "${GREEN}✓ $*${RESET}"; }
fatal() { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }

# ── Guards ────────────────────────────────────────────────────────────────────

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$BRANCH" == "main" ]] || fatal "Must be on main branch (currently on '$BRANCH')"

git diff --quiet && git diff --cached --quiet || fatal "Working tree is dirty — commit or stash changes first"

info "Pulling latest main…"
git pull origin main --quiet

# ── Bump all workspace package versions ───────────────────────────────────────

info "Bumping version ($BUMP)…"
pnpm -r exec -- npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./packages/apex-core/package.json').version")
ok "New version: ${BOLD}v${VERSION}${RESET}"

# ── Commit + tag ──────────────────────────────────────────────────────────────

git add packages/apex-core/package.json \
        packages/apex-lint-cli/package.json \
        packages/eslint-parser-apex/package.json \
        packages/eslint-plugin-apex/package.json
git commit -m "chore: bump version to ${VERSION}" --quiet
git tag "v${VERSION}"
ok "Tagged v${VERSION}"

# ── Push ──────────────────────────────────────────────────────────────────────

info "Pushing to origin…"
git push origin main --tags --quiet
ok "Pushed main + tag"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}Released v${VERSION}${RESET}"
echo -e "Publish workflow: ${CYAN}https://github.com/cloudalgo/apex-lint/actions${RESET}"

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
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}▸ $*${RESET}"; }
ok()    { echo -e "${GREEN}✓ $*${RESET}"; }
warn()  { echo -e "${YELLOW}! $*${RESET}"; }
fatal() { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }

# ── Guards ────────────────────────────────────────────────────────────────────

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$BRANCH" == "main" ]] || fatal "Must be on main branch (currently on '$BRANCH')"

git diff --quiet && git diff --cached --quiet || fatal "Working tree is dirty — commit or stash changes first"

info "Pulling latest main…"
git pull origin main --quiet

# ── Doc audit ─────────────────────────────────────────────────────────────────

info "Checking docs…"

# Count rules from built dist if available, else count exports in source
if [[ -f packages/apex-core/dist/rules/index.js ]]; then
  RULE_COUNT=$(node -e "const m=require('./packages/apex-core/dist/rules/index.js'); console.log(m.allRules.length)" 2>/dev/null || echo "?")
else
  # Fallback: count rule entries in the source allRules array (lines of the form "  ruleVar,")
  RULE_COUNT=$(grep -cE '^\s+[a-z][a-zA-Z]+,$' packages/apex-core/src/rules/index.ts 2>/dev/null || echo "?")
fi

README_COUNT=$(grep -oP '\d+(?= built-in rules)' README.md 2>/dev/null | head -1 || echo "?")

if [[ "$RULE_COUNT" != "?" && "$README_COUNT" != "?" ]]; then
  if [[ "$RULE_COUNT" != "$README_COUNT" ]]; then
    fatal "Rule count mismatch: codebase has $RULE_COUNT rules but README.md says $README_COUNT — update docs before releasing"
  fi
  ok "Rule count verified: $RULE_COUNT rules in code and README"
else
  warn "Could not verify rule count (dist not built or grep failed) — check manually"
fi

# Confirm CHANGELOG has an entry (any heading line)
if ! grep -q "^## \[" CHANGELOG.md 2>/dev/null; then
  fatal "CHANGELOG.md has no version sections — add an entry for this release first"
fi

echo ""
echo -e "${BOLD}Doc checklist${RESET} — confirm each is up to date:"
echo "  [ ] README.md                          — rule count, rule tables, CLI flags"
echo "  [ ] packages/apex-core/README.md       — built-in rule catalog table"
echo "  [ ] packages/apex-lint-cli/README.md   — rule tables, CLI reference"
echo "  [ ] CHANGELOG.md                       — section for the version being released"
echo ""
read -r -p "All docs reviewed and up to date? [y/N] " DOCS_OK
[[ "${DOCS_OK:-n}" =~ ^[Yy]$ ]] || fatal "Aborted — update docs first, then re-run"

echo ""

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

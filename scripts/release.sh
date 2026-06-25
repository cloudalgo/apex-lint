#!/usr/bin/env bash
# Release script — bumps all workspace package versions, commits, tags, and
# creates a GitHub release. The publish workflow picks up the release and
# publishes all packages to npm automatically.
#
# Usage:
#   ./scripts/release.sh <version>           exact version, e.g. 1.2.3
#   ./scripts/release.sh patch               bump patch: 0.1.0 → 0.1.1
#   ./scripts/release.sh minor               bump minor: 0.1.0 → 0.2.0
#   ./scripts/release.sh major               bump major: 0.1.0 → 1.0.0

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}▸${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
die()     { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}$*${NC}"; }

# ── Argument parsing ──────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <version|patch|minor|major>"
  echo "  $0 0.2.0"
  echo "  $0 patch"
  exit 2
fi

BUMP="$1"

# ── Resolve the script's repo root ───────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Read current version from root workspace package ─────────────────────────
CURRENT_VERSION="$(node -p "require('./packages/apex-core/package.json').version")"
info "Current version: ${BOLD}${CURRENT_VERSION}${NC}"

# ── Calculate next version ────────────────────────────────────────────────────
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  VERSION="$BUMP"
elif [[ "$BUMP" == "patch" || "$BUMP" == "minor" || "$BUMP" == "major" ]]; then
  IFS='.' read -ra PARTS <<< "${CURRENT_VERSION%%-*}"
  MAJOR="${PARTS[0]}"; MINOR="${PARTS[1]}"; PATCH="${PARTS[2]}"
  case "$BUMP" in
    patch) VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    minor) VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    major) VERSION="$((MAJOR + 1)).0.0" ;;
  esac
else
  die "Invalid argument '${BUMP}'. Use a semver (X.Y.Z) or patch / minor / major."
fi

if [[ "$VERSION" == "$CURRENT_VERSION" ]]; then
  die "Version ${VERSION} is already the current version — nothing to do."
fi

info "Next version:    ${BOLD}${VERSION}${NC}"
TAG="v${VERSION}"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
step "Pre-flight checks"

# Must be on main
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  die "Must be on 'main' branch (currently on '${BRANCH}')."
fi
success "On branch main"

# Working tree must be clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree has uncommitted changes — commit or stash them first."
fi
success "Working tree clean"

# Tag must not already exist
if git rev-parse "$TAG" &>/dev/null; then
  die "Tag ${TAG} already exists."
fi
success "Tag ${TAG} available"

# gh CLI must be available (needed to create the release)
if ! command -v gh &>/dev/null; then
  die "'gh' CLI is not installed. Install from https://cli.github.com and run 'gh auth login'."
fi
if ! gh auth status &>/dev/null; then
  die "Not logged in to GitHub CLI. Run 'gh auth login' first."
fi
success "GitHub CLI authenticated"

# ── Build ─────────────────────────────────────────────────────────────────────
step "Build"
info "Running pnpm build..."
pnpm build
success "Build passed"

# ── Bump versions ─────────────────────────────────────────────────────────────
step "Bump versions → ${VERSION}"
pnpm -r exec -- npm version "$VERSION" --no-git-tag-version
success "All workspace packages updated to ${VERSION}"

# ── Commit & tag ─────────────────────────────────────────────────────────────
step "Commit & tag"
git add -A
git commit -m "chore: release ${TAG}"
git tag "$TAG"
success "Committed and tagged ${TAG}"

# ── Push ──────────────────────────────────────────────────────────────────────
step "Push"
git push origin main
git push origin "$TAG"
success "Pushed main and ${TAG}"

# ── Create GitHub release (triggers the publish workflow) ─────────────────────
step "Create GitHub release"
gh release create "$TAG" \
  --title "apex-lint ${TAG}" \
  --generate-notes \
  --verify-tag
success "GitHub release created → triggers npm publish workflow"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Released ${TAG} successfully.${NC}"
echo ""
echo "  npm publish is running in CI:"
echo "  https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions"
echo ""
echo "  Once CI completes, packages will be live at:"
echo "    https://www.npmjs.com/package/@cloudalgo/apex-core"
echo "    https://www.npmjs.com/package/@cloudalgo/apex-lint"
echo "    https://www.npmjs.com/package/@cloudalgo/eslint-parser-apex"
echo "    https://www.npmjs.com/package/@cloudalgo/eslint-plugin-apex"

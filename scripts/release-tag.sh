#!/usr/bin/env bash
# Record the package version without moving an existing tag. Tagging does not
# run builds or uploads; see docs/RELEASING.md for the manual release workflows.
# Usage: npm run release:tag [-- --push]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Read version from package.json. Use node so we don't rely on jq/sed
# and so the parse matches exactly what npm sees in $npm_package_version.
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

if [[ -z "${VERSION}" ]]; then
  echo "release-tag: could not read version from package.json" >&2
  exit 1
fi

# Refuse to tag a dirty tree — a tag should reference a commit the
# user can actually reproduce. Allow override with FORCE_DIRTY=1 for
# emergencies.
if [[ -z "${FORCE_DIRTY:-}" ]] && ! git diff-index --quiet HEAD --; then
  echo "release-tag: working tree is dirty. Commit or stash first" >&2
  echo "            (or run with FORCE_DIRTY=1 to bypass)" >&2
  exit 2
fi

# If the tag already exists and points at HEAD, that's fine — idempotent
# re-run. If it exists and points somewhere else, bail — per the user's
# rule we never rewrite published tags; bump the patch version instead.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  EXISTING_SHA=$(git rev-list -n 1 "$TAG")
  HEAD_SHA=$(git rev-parse HEAD)
  if [[ "$EXISTING_SHA" == "$HEAD_SHA" ]]; then
    echo "release-tag: tag $TAG already exists at HEAD — nothing to do"
  else
    echo "release-tag: tag $TAG already exists pointing at $EXISTING_SHA" >&2
    echo "            HEAD is at $HEAD_SHA" >&2
    echo "            Bump the patch version in package.json and retry" >&2
    echo "            (never rewrite a published tag)." >&2
    exit 3
  fi
else
  git tag -a "$TAG" -m "Release $TAG"
  echo "release-tag: tagged HEAD as $TAG"
fi

if [[ "${1:-}" == "--push" ]]; then
  git push origin "$TAG"
  echo "release-tag: pushed $TAG to origin"
fi

echo ""
echo "Tagging does not build or publish. See docs/RELEASING.md."
echo "Dispatch Build desktop binaries on main, then publish its successful run ID."
echo "A download draft requires $TAG to point at that exact build commit."

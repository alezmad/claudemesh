#!/usr/bin/env bash
# One-command publish of all 3 claudemesh images to ghcr.io/alezmad.
#
# Usage:
#   GHCR_TOKEN=ghp_xxx ./scripts/publish-images.sh [TAG]
#   GHCR_TOKEN=ghp_xxx ./scripts/publish-images.sh 0.1.0
#   ./scripts/publish-images.sh 0.1.0 --dry-run     # no login, no push
#
# Produces (all multi-arch: linux/amd64 + linux/arm64):
#   ghcr.io/alezmad/claudemesh-broker:<TAG>  + :latest
#   ghcr.io/alezmad/claudemesh-web:<TAG>     + :latest
#   ghcr.io/alezmad/claudemesh-migrate:<TAG> + :latest
#
# Prereqs:
#   - docker buildx (Docker Desktop on Mac ships with it)
#   - GHCR_TOKEN env var: a GitHub personal access token with `write:packages`
#     scope. Create at https://github.com/settings/tokens
#
# Image sizes after the pnpm deploy trim (arm64):
#   claudemesh-broker  ~341 MB
#   claudemesh-migrate ~653 MB
#   claudemesh-web     (next.js standalone, ~250 MB)

set -euo pipefail

TAG="${1:-latest}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

REGISTRY="ghcr.io/alezmad"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if $DRY_RUN; then
  echo "=== DRY RUN — no login, no push ==="
  echo ""
  echo "Would run:"
  echo "  echo \$GHCR_TOKEN | docker login ghcr.io -u alezmad --password-stdin"
  echo "  ${SCRIPT_DIR}/build-multiarch.sh ${REGISTRY} ${TAG}"
  echo ""
  echo "Images that would be published:"
  echo "  ${REGISTRY}/claudemesh-broker:${TAG}   + :latest"
  echo "  ${REGISTRY}/claudemesh-web:${TAG}      + :latest"
  echo "  ${REGISTRY}/claudemesh-migrate:${TAG}  + :latest"
  echo "  (platforms: linux/amd64, linux/arm64)"
  exit 0
fi

if [[ -z "${GHCR_TOKEN:-}" ]]; then
  echo "error: GHCR_TOKEN env var is required." >&2
  echo "Create a GitHub PAT with 'write:packages' scope at" >&2
  echo "  https://github.com/settings/tokens" >&2
  echo "Then re-run: GHCR_TOKEN=ghp_xxx $0 ${TAG}" >&2
  exit 1
fi

echo "→ logging in to ghcr.io as alezmad"
echo "$GHCR_TOKEN" | docker login ghcr.io -u alezmad --password-stdin

echo "→ building + pushing ${REGISTRY}/claudemesh-{broker,web,migrate}:${TAG}"
"${SCRIPT_DIR}/build-multiarch.sh" "${REGISTRY}" "${TAG}"

echo ""
echo "✓ published. pull with:"
echo "  docker pull ${REGISTRY}/claudemesh-broker:${TAG}"

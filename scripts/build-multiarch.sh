#!/usr/bin/env bash
# Build + push multi-arch (linux/amd64 + linux/arm64) claudemesh images.
#
# Usage:
#   scripts/build-multiarch.sh [REGISTRY] [TAG]
#
#   REGISTRY   default: ghcr.io/alezmad   (override for your own ghcr/dockerhub scope)
#   TAG        default: $(git rev-parse --short HEAD)
#
# Images produced (all three get built + tagged + pushed):
#   <REGISTRY>/claudemesh-broker:<TAG>  + :latest
#   <REGISTRY>/claudemesh-web:<TAG>     + :latest
#   <REGISTRY>/claudemesh-migrate:<TAG> + :latest
#
# Examples:
#   scripts/build-multiarch.sh                              # → ghcr.io/alezmad/claudemesh-*:<sha>
#   scripts/build-multiarch.sh ghcr.io/alezmad 0.1.0        # → ghcr.io/alezmad/claudemesh-*:0.1.0
#   scripts/build-multiarch.sh ghcr.io/myorg latest         # → ghcr.io/myorg/claudemesh-*:latest
#
# Requires: docker buildx with a multi-arch-capable builder. On Docker Desktop
# (Mac/Windows), this is already set up. On Linux CI, run first:
#   docker run --privileged --rm tonistiigi/binfmt --install all
#   docker buildx create --use --name multiarch
#
# Why multi-arch: Mac dev machines are arm64 (Apple Silicon), VPS is typically
# amd64. Single-arch images force one side into QEMU emulation (2-4x slower,
# noisy warnings, occasional native-binding failures).

set -euo pipefail

REGISTRY="${1:-ghcr.io/alezmad}"
TAG="${2:-$(git rev-parse --short HEAD)}"
GIT_SHA="$(git rev-parse --short HEAD)"

PLATFORMS="linux/amd64,linux/arm64"

cd "$(dirname "$0")/.."

echo "→ Building ${REGISTRY}/claudemesh-{broker,web,migrate}:${TAG} for [${PLATFORMS}]"
echo "  GIT_SHA=${GIT_SHA}"
echo ""

docker buildx build \
  --platform "${PLATFORMS}" \
  --file apps/broker/Dockerfile \
  --build-arg "GIT_SHA=${GIT_SHA}" \
  --tag "${REGISTRY}/claudemesh-broker:${TAG}" \
  --tag "${REGISTRY}/claudemesh-broker:latest" \
  --push \
  .

docker buildx build \
  --platform "${PLATFORMS}" \
  --file apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_URL=${NEXT_PUBLIC_URL:-https://claudemesh.com}" \
  --tag "${REGISTRY}/claudemesh-web:${TAG}" \
  --tag "${REGISTRY}/claudemesh-web:latest" \
  --push \
  .

docker buildx build \
  --platform "${PLATFORMS}" \
  --file packages/db/Dockerfile \
  --tag "${REGISTRY}/claudemesh-migrate:${TAG}" \
  --tag "${REGISTRY}/claudemesh-migrate:latest" \
  --push \
  .

echo ""
echo "✓ pushed ${REGISTRY}/claudemesh-{broker,web,migrate}:${TAG} (+ :latest)"
echo "  arm64 + amd64 — no QEMU emulation for your adopters"

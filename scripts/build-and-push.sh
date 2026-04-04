#!/bin/bash
# Build Docker image locally and push to Gitea Container Registry
# Usage: ./scripts/build-and-push.sh [tag]

set -e

# Configuration
REGISTRY="192.168.1.3:3030"
REPO="alezmad/turbostarter"
TAG="${1:-latest}"
IMAGE="${REGISTRY}/${REPO}:${TAG}"

echo "🔨 Building Docker image: ${IMAGE}"
docker build --platform linux/amd64 -t "${IMAGE}" .

echo "📤 Pushing to Gitea registry..."
docker push "${IMAGE}"

echo "✅ Done! Image pushed: ${IMAGE}"
echo ""
echo "To deploy in Coolify, update the application to use:"
echo "  Image: ${IMAGE}"

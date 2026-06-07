#!/bin/bash
# Setup Presenton MCP server for Claude Code
# Requires: Docker Desktop installed and running

echo "=== Presenton Setup ==="

# Check Docker
if ! docker --version &>/dev/null; then
  echo "ERROR: Docker not found. Install Docker Desktop first:"
  echo "  https://www.docker.com/products/docker-desktop/"
  exit 1
fi

# Pull Presenton MCP image
echo "Pulling Presenton MCP image..."
docker pull ghcr.io/presenton/presenton-mcp:latest

# Pull optional full Presenton server (for web UI)
echo ""
echo "Optional: pull full Presenton server for web dashboard:"
echo "  docker pull ghcr.io/presenton/presenton:latest"
echo "  docker run -d --name presenton -p 5000:80 ghcr.io/presenton/presenton:latest"

echo ""
echo "MCP server already configured in ~/.claude.json"
echo "Restart Claude Code to use /deck-generator"

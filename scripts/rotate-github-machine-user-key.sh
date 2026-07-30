#!/usr/bin/env bash
#
# rotate-github-machine-user-key.sh
#
# Generates a new ed25519 SSH key for the GitHub machine user, outputs:
#   1. The public key  → add to GitHub (Settings → SSH and GPG keys) BEFORE removing the old one
#   2. The base64-encoded private key → paste into MCP_LINUX_GIT_SSH_KEY in .env.prod / .env.dev / .env.local
#
# This script does NOT touch the live environment. It only generates and prints.
# After updating the env var, restart the mcp-linux container and run reset_account
# so the new key is written to every user's ~/.ssh/.
#
# Usage:
#   ./scripts/rotate-github-machine-user-key.sh [comment-email]
#
#   comment-email  Email used as the SSH key comment (default: correctiv-team-digital-bot@correctiv.org)
#
set -euo pipefail

COMMENT_EMAIL="${1:-correctiv-team-digital-bot@correctiv.org}"
TMPDIR="$(mktemp -d)"
KEY_PATH="${TMPDIR}/github_machine_user"
trap 'rm -rf "${TMPDIR}"' EXIT

echo "🔐 Generating new ed25519 SSH key..."
echo "   Comment: ${COMMENT_EMAIL}"
echo "   Path:    ${KEY_PATH} (temporary)"
echo ""

ssh-keygen -t ed25519 -C "${COMMENT_EMAIL}" -f "${KEY_PATH}" -N ""

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  STEP 1: Add the PUBLIC key to GitHub"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  GitHub → Settings → SSH and GPG keys → New SSH key"
echo "  Title: machine-user-$(date -u +%Y%m%d)"
echo "  Key:"
echo ""
cat "${KEY_PATH}.pub"
echo ""
echo "  ⚠️  Do NOT remove the old key yet — verify the new one works first."
echo ""
echo "  Verify (after adding to GitHub):"
echo "    ssh -T git@github.com -i ${KEY_PATH}"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  STEP 2: Update MCP_LINUX_GIT_SSH_KEY in your .env file"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Paste this single-line base64 value as MCP_LINUX_GIT_SSH_KEY:"
echo ""
base64 -w0 "${KEY_PATH}"
echo ""
echo ""
echo "  Also update MCP_GITHUB_PAT if the PAT needs rotation (see docs/GITHUB_MACHINE_USER.md)."
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  STEP 3: Deploy and verify"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  1. Update the env var in Portainer (Stack → Environment variables) or .env file"
echo "  2. Restart the mcp-linux container:"
echo "     docker compose -f docker-compose.prod.yml restart mcp-linux"
echo "  3. Run reset_account (via MCP Linux tool) so the new key is written to ~/.ssh/"
echo "     for all existing users"
echo "  4. Verify SSH auth works:"
echo "     ssh -T git@github.com"
echo "  5. Verify gh CLI works (if MCP_GITHUB_PAT was also updated):"
echo "     gh api user --jq .login"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  STEP 4: Remove the OLD key from GitHub"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Only after verifying the new key works:"
echo "  GitHub → Settings → SSH and GPG keys → Delete the old key"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Key fingerprint (for verification):"
echo "═══════════════════════════════════════════════════════════════════════════"
ssh-keygen -lf "${KEY_PATH}"
echo ""
echo "✅ Done. The temporary key files have been deleted from ${TMPDIR}."
echo "   The key now only exists in GitHub and your .env file."

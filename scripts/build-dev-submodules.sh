#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds submodules that must be built for the local and local-dev stacks to work.
# Runs post_init steps from submodules-upstream.yaml (e.g. npm_install_build for dev/agents).
# Does not run git submodule update — run npm run update:submodules first to update all submodules.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUBMODULES_CONFIG="${SCRIPT_DIR}/submodules-upstream.yaml"

cd "${PROJECT_ROOT}"

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}▶${NC} $1"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

list_post_init_submodules() {
    if command_exists yq; then
        yq eval '.submodules[] | select(.post_init != null) | (.path + " " + .post_init)' "$SUBMODULES_CONFIG" 2>/dev/null || true
    else
        python3 -c "
import sys, yaml
try:
    with open(\"${SUBMODULES_CONFIG}\") as f:
        for s in yaml.safe_load(f).get('submodules', []):
            if s.get('post_init'):
                print(s['path'], s['post_init'])
except Exception:
    pass
" 2>/dev/null || true
    fi
}

run_post_init() {
    local path="$1"
    local post_init="$2"
    local dir="${PROJECT_ROOT}/${path}"

    if [ ! -d "$dir" ]; then
        log_warning "${path}: directory not found, skipping post_init ${post_init}"
        return 0
    fi

    case "$post_init" in
        npm_install_build)
            if ! command_exists npm; then
                log_warning "${path}: npm not installed, skipping npm_install_build"
                return 0
            fi
            log_info "${path}: npm install..."
            (cd "$dir" && npm install) || { log_error "${path}: npm install failed"; return 1; }
            log_info "${path}: npm run build..."
            (cd "$dir" && npm run build) || { log_error "${path}: npm run build failed"; return 1; }
            log_success "${path}: npm_install_build completed"
            ;;
        *)
            log_warning "${path}: unknown post_init '${post_init}', skipping"
            ;;
    esac
}

main() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  Build Dev Submodules                                     ║"
    echo "║  Submodules required for local / local-dev stacks        ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    log_info "Project root: ${PROJECT_ROOT}"
    log_info "Running post_init steps from submodules-upstream.yaml"
    echo ""

    if [ ! -f "$SUBMODULES_CONFIG" ]; then
        log_error "Config not found: ${SUBMODULES_CONFIG}"
        exit 1
    fi

    log_step "Post-init steps (builds)"
    local count=0
    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        local path post_init
        path="${line%% *}"
        post_init="${line#* }"
        run_post_init "$path" "$post_init" || exit 1
        ((count++)) || true
    done < <(list_post_init_submodules)

    if [ "$count" -eq 0 ]; then
        log_info "No submodules with post_init defined"
    fi

    echo ""
    log_success "Build steps completed."
    echo ""
    log_info "Next: npm run setup, npm run start:local-dev (or start:local)"
    echo ""
}

main "$@"

#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Creates upstream tracking branches for submodules that have upstream_url in submodules-upstream.yaml.
# Used by update-submodules.sh. Optional — update script creates them automatically.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Change to project root
cd "${PROJECT_ROOT}"

# Configuration
UPSTREAM_CONFIG="${SCRIPT_DIR}/submodules-upstream.yaml"
DRY_RUN=false
FORCE=false

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

log_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}▶${NC} $1"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

log_submodule() {
    echo -e "${CYAN}→${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --force)
                FORCE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Show help message
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Create upstream tracking branches in Faktenforum fork submodules.

OPTIONS:
    --dry-run           Preview changes without applying them
    --force             Overwrite existing upstream branch if it exists
    -h, --help          Show this help message

EXAMPLES:
    $0                  Create upstream tracking branches for all forks
    $0 --dry-run        Preview branch creation
EOF
}

# Check prerequisites
check_prerequisites() {
    if ! command_exists git; then
        log_error "git is not installed"
        exit 1
    fi

    if [ ! -f "${UPSTREAM_CONFIG}" ]; then
        log_error "Upstream configuration file not found: ${UPSTREAM_CONFIG}"
        exit 1
    fi

    # Check for YAML parser (prefer Python with PyYAML, fallback to yq)
    if command_exists python3; then
        if python3 -c "import yaml" 2>/dev/null; then
            YAML_PARSER="python3"
        else
            log_warning "PyYAML not installed. Install with: pip3 install pyyaml"
            log_warning "Falling back to yq if available..."
            if command_exists yq; then
                YAML_PARSER="yq"
            else
                log_error "No YAML parser available. Install PyYAML (pip3 install pyyaml) or yq"
                exit 1
            fi
        fi
    elif command_exists yq; then
        YAML_PARSER="yq"
    else
        log_error "No YAML parser available. Install Python3 with PyYAML (pip3 install pyyaml) or yq"
        exit 1
    fi
}

# Parse YAML configuration using Python
parse_yaml_python() {
    python3 << PYTHON_SCRIPT
import yaml
import sys
import json

try:
    with open('${UPSTREAM_CONFIG}', 'r') as f:
        config = yaml.safe_load(f)
    
    submodules = config.get('submodules', [])
    for submodule in submodules:
        print(json.dumps(submodule))
except Exception as e:
    print(f"Error parsing YAML: {e}", file=sys.stderr)
    sys.exit(1)
PYTHON_SCRIPT
}

# Parse YAML configuration using yq
parse_yaml_yq() {
    # Use -c for compact JSON (one line per object)
    yq eval '.submodules[]' -o json -c "$UPSTREAM_CONFIG" 2>/dev/null
}

# Check if submodule is initialized
is_submodule_initialized() {
    local submodule_path="$1"
    local project_root="$2"
    # Git submodules can have .git as either a directory or a file (pointing to gitdir)
    [ -e "${project_root}/${submodule_path}/.git" ]
}

# Check if branch exists locally
branch_exists_local() {
    local submodule_path="$1"
    local branch="$2"
    local project_root="$3"
    cd "${project_root}/${submodule_path}"
    git rev-parse --verify "$branch" >/dev/null 2>&1
}

# Check if branch exists remotely
branch_exists_remote() {
    local submodule_path="$1"
    local branch="$2"
    cd "${PROJECT_ROOT}/${submodule_path}"
    git ls-remote --heads origin "$branch" | grep -q "$branch" 2>/dev/null
}

# Create upstream tracking branch for a submodule
create_upstream_tracking_branch() {
    local config_json="$1"
    
    local path fork_branch upstream_tracking_branch upstream_branch upstream_url description
    
    if [ "$YAML_PARSER" = "python3" ]; then
        path=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('path', ''))" 2>/dev/null)
        fork_branch=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fork_branch', 'main'))" 2>/dev/null)
        upstream_tracking_branch=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_tracking_branch', 'upstream'))" 2>/dev/null)
        upstream_branch=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_branch', 'main'))" 2>/dev/null)
        upstream_url=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_url', ''))" 2>/dev/null)
        description=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('description', ''))" 2>/dev/null)
    else
        path=$(echo "$config_json" | yq eval '.path' -)
        fork_branch=$(echo "$config_json" | yq eval '.fork_branch // "main"' -)
        upstream_tracking_branch=$(echo "$config_json" | yq eval '.upstream_tracking_branch // "upstream"' -)
        upstream_branch=$(echo "$config_json" | yq eval '.upstream_branch // "main"' -)
        upstream_url=$(echo "$config_json" | yq eval '.upstream_url' -)
        description=$(echo "$config_json" | yq eval '.description // ""' -)
    fi
    
    # Skip entries without upstream_url (e.g. external dev submodules with only post_init)
    if [ -z "$upstream_url" ]; then
        return 0
    fi
    
    log_step "Processing ${path}"
    if [ -n "$description" ]; then
        log_info "Description: $description"
    fi
    
    # Check if submodule is initialized
    is_submodule_initialized "$path" "$PROJECT_ROOT" || {
        log_warning "Submodule not initialized, skipping..."
        log_info "Initialize with: git submodule update --init --remote ${path}"
        return 0
    }
    
    cd "${PROJECT_ROOT}/${path}"
    
    # Fetch latest changes from origin
    log_submodule "Fetching from origin..."
    [ "$DRY_RUN" = false ] && git fetch origin --quiet 2>/dev/null || true
    
    # Setup upstream remote
    if ! git remote | grep -q "^upstream$"; then
        log_submodule "Adding upstream remote..."
        [ "$DRY_RUN" = false ] && {
            git remote add upstream "$upstream_url" 2>/dev/null || {
                log_error "Failed to add upstream remote"
                return 1
            }
        } || log_info "[DRY RUN] Would add upstream remote: ${upstream_url}"
    fi
    
    # Fetch from upstream
    log_submodule "Fetching from upstream..."
    [ "$DRY_RUN" = true ] && { log_info "[DRY RUN] Would fetch from upstream"; return 0; }
    git fetch upstream --quiet 2>/dev/null || { log_error "Failed to fetch from upstream"; return 1; }
    
    # Check if branch already exists
    if branch_exists_local "$path" "$upstream_tracking_branch" "$PROJECT_ROOT"; then
        [ "$FORCE" = true ] && {
            log_warning "Branch ${upstream_tracking_branch} already exists, force mode: will recreate"
            [ "$DRY_RUN" = false ] && git branch -D "$upstream_tracking_branch" 2>/dev/null || true
        } || {
            log_warning "Branch ${upstream_tracking_branch} already exists locally"
            log_info "Branch exists, skipping creation. Use --force to recreate."
            return 0
        }
    fi
    
    # Create upstream tracking branch
    log_submodule "Creating ${upstream_tracking_branch} branch from upstream/${upstream_branch}..."
    [ "$DRY_RUN" = true ] && { log_info "[DRY RUN] Would create branch ${upstream_tracking_branch}"; return 0; }
    git checkout -b "$upstream_tracking_branch" "upstream/${upstream_branch}" 2>/dev/null || {
        log_error "Failed to create ${upstream_tracking_branch} branch"
        return 1
    }
    log_success "Created local branch ${upstream_tracking_branch}"
    
    log_success "Completed setup for ${path}"
    log_info "Note: The ${upstream_tracking_branch} branch is for tracking only and typically not pushed to remote"
}

# Main execution
main() {
    parse_args "$@"
    
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  Create Upstream Tracking Branches                       ║"
    echo "║  AI Chat Interface - Branch Initialization              ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    
    if [ "$DRY_RUN" = true ]; then
        log_warning "DRY RUN MODE: No changes will be applied"
        echo ""
    fi
    
    check_prerequisites
    
    log_step "Creating upstream tracking branches for Faktenforum Fork Submodules"
    
    local config_json failed_creates=0
    
    config_json=$([ "$YAML_PARSER" = "python3" ] && parse_yaml_python || parse_yaml_yq)
    
    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        create_upstream_tracking_branch "$line" || ((failed_creates++))
    done < <(echo "$config_json")
    
    echo ""
    if [ $failed_creates -eq 0 ]; then
        log_success "All upstream tracking branches created successfully!"
        echo ""
        log_info "Next steps:"
        log_info "  1. Make your Faktenforum-specific changes in the main branches"
        log_info "  2. Use 'npm run sync:forks' to sync upstream changes into main"
        log_info "  3. The main branches are set as default in .gitmodules"
    else
        log_error "${failed_creates} branch(es) failed to create"
        exit 1
    fi
}

# Run main function
main "$@"

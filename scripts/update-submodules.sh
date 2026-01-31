#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Brings all submodules up to date.
# (1) git submodule update --init --remote for all (non-forks stay current).
# (2) For entries with upstream_url: upstream remote, tracking branch; for forks: merge into main.
# Usage: docs/SUBMODULE_SYNC.md

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
STATUS_ONLY=false
SELECTED_SUBMODULE=""
SELECTED_BRANCH=""

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
            --status)
                STATUS_ONLY=true
                shift
                ;;
            --submodule)
                SELECTED_SUBMODULE="$2"
                shift 2
                ;;
            --branch)
                SELECTED_BRANCH="$2"
                shift 2
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

Update all submodules: pull non-forks to latest; for forks, update upstream and merge into main.

OPTIONS:
    --dry-run           Preview changes without applying them
    --force             Skip safety checks (use with caution)
    --status            Show sync status (fork/upstream-only submodules)
    --submodule PATH    Update only the specified submodule
    --branch BRANCH     Sync only the specified branch
    -h, --help          Show this help message

EXAMPLES:
    $0                  Update all submodules
    $0 --status         Show fork/upstream status
    $0 --submodule dev/librechat  Update only LibreChat
    $0 --dry-run        Preview without applying
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

# Get submodule configuration
get_submodule_config() {
    local submodule_path="$1"
    
    if [ "$YAML_PARSER" = "python3" ]; then
        parse_yaml_python | while IFS= read -r config_json; do
            local path=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('path', ''))" 2>/dev/null)
            if [ "$path" = "$submodule_path" ]; then
                echo "$config_json"
                return
            fi
        done
    else
        yq eval ".submodules[] | select(.path == \"$submodule_path\")" -o json "$UPSTREAM_CONFIG"
    fi
}

# Check if submodule is initialized
is_submodule_initialized() {
    local submodule_path="$1"
    # Git submodules can have .git as either a directory or a file (pointing to gitdir)
    [ -e "${PROJECT_ROOT}/${submodule_path}/.git" ]
}

# Get current branch of submodule
get_current_branch() {
    local submodule_path="$1"
    cd "${PROJECT_ROOT}/${submodule_path}"
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

# Check if there are uncommitted changes
has_uncommitted_changes() {
    local submodule_path="$1"
    cd "${PROJECT_ROOT}/${submodule_path}"
    ! git diff-index --quiet HEAD -- 2>/dev/null
}

# Setup upstream remote (adds or updates if needed)
setup_upstream_remote() {
    local submodule_path="$1"
    local upstream_url="$2"
    
    cd "${PROJECT_ROOT}/${submodule_path}"
    
    if git remote | grep -q "^upstream$"; then
        local current_url=$(git remote get-url upstream 2>/dev/null || echo "")
        if [ "$current_url" != "$upstream_url" ]; then
            log_submodule "Updating upstream remote URL..."
            [ "$DRY_RUN" = false ] && git remote set-url upstream "$upstream_url"
        fi
    else
        log_submodule "Adding upstream remote..."
        [ "$DRY_RUN" = false ] && git remote add upstream "$upstream_url"
    fi
}

# Fetch from upstream
fetch_upstream() {
    local submodule_path="$1"
    
    cd "${PROJECT_ROOT}/${submodule_path}"
    log_submodule "Fetching from upstream..."
    
    [ "$DRY_RUN" = true ] && { log_info "[DRY RUN] Would fetch from upstream"; return 0; }
    
    git fetch upstream --quiet || { log_error "Failed to fetch from upstream"; return 1; }
}

# Get commits ahead/behind
get_sync_status() {
    local submodule_path="$1"
    local fork_branch="$2"
    local upstream_branch="$3"
    
    cd "${PROJECT_ROOT}/${submodule_path}"
    
    # Ensure we have both origin and upstream refs
    git fetch origin --quiet 2>/dev/null || true
    git fetch upstream --quiet 2>/dev/null || true
    
    local fork_ref="origin/${fork_branch}"
    local upstream_ref="upstream/${upstream_branch}"
    
    # Check if branches exist
    if ! git rev-parse --verify "$fork_ref" >/dev/null 2>&1; then
        echo "fork_branch_missing"
        return
    fi
    
    if ! git rev-parse --verify "$upstream_ref" >/dev/null 2>&1; then
        echo "upstream_branch_missing"
        return
    fi
    
    local ahead=$(git rev-list --count "$upstream_ref..$fork_ref" 2>/dev/null || echo "0")
    local behind=$(git rev-list --count "$fork_ref..$upstream_ref" 2>/dev/null || echo "0")
    
    echo "${ahead}:${behind}"
}

# Show sync status for fork/upstream-only submodules
show_status() {
    log_step "Sync status (fork/upstream-only; non-forks updated by Step 1)"
    
    local config_json
    if [ "$YAML_PARSER" = "python3" ]; then
        config_json=$(parse_yaml_python)
    else
        config_json=$(parse_yaml_yq)
    fi
    
    # Process each JSON object using process substitution to avoid subshell issues
    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        
        local path fork_url upstream_url upstream_branch fork_branch upstream_tracking_branch description
        
        if [ "$YAML_PARSER" = "python3" ]; then
            path=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('path', ''))" 2>/dev/null)
            fork_url=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fork_url', ''))" 2>/dev/null)
            upstream_url=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_url', ''))" 2>/dev/null)
            upstream_branch=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_branch', 'main'))" 2>/dev/null)
            fork_branch=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fork_branch', 'main'))" 2>/dev/null)
            upstream_tracking_branch=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_tracking_branch', 'upstream'))" 2>/dev/null)
            description=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('description', ''))" 2>/dev/null)
        else
            path=$(echo "$line" | yq eval '.path' -)
            fork_url=$(echo "$line" | yq eval '.fork_url' -)
            upstream_url=$(echo "$line" | yq eval '.upstream_url' -)
            upstream_branch=$(echo "$line" | yq eval '.upstream_branch // "main"' -)
            fork_branch=$(echo "$line" | yq eval '.fork_branch // "main"' -)
            upstream_tracking_branch=$(echo "$line" | yq eval '.upstream_tracking_branch // "upstream"' -)
            description=$(echo "$line" | yq eval '.description // ""' -)
        fi
        
        if [ -n "$SELECTED_SUBMODULE" ] && [ "$path" != "$SELECTED_SUBMODULE" ]; then
            continue
        fi
        
        # Skip entries without upstream (no status to show)
        if [ -z "$upstream_url" ]; then
            continue
        fi
        
        echo ""
        log_submodule "${path}"
        if [ -n "$description" ]; then
            echo "  Description: $description"
        fi
        
        if ! is_submodule_initialized "$path"; then
            log_warning "  Status: Not initialized"
            continue
        fi
        
        # Check upstream remote
        cd "${PROJECT_ROOT}/${path}"
        if ! git remote | grep -q "^upstream$"; then
            log_warning "  Upstream remote: Not configured"
            continue
        fi
        
        # Get upstream_tracking_branch from config
        local upstream_tracking_branch
        if [ "$YAML_PARSER" = "python3" ]; then
            upstream_tracking_branch=$(echo "$line" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_tracking_branch', 'upstream'))" 2>/dev/null)
        else
            upstream_tracking_branch=$(echo "$line" | yq eval '.upstream_tracking_branch // "upstream"' -)
        fi
        
        # Get status for main branch (fork: "Faktenforum"; upstream-only: just "Main branch")
        local main_label="Main branch"
        [ -n "$fork_url" ] && main_label="Main branch (Faktenforum)"
        cd "${PROJECT_ROOT}/${path}"
        git fetch upstream --quiet 2>/dev/null || true
        
        if ! git rev-parse --verify "$fork_branch" >/dev/null 2>&1; then
            log_warning "  ${main_label}: Branch does not exist locally"
        elif ! git rev-parse --verify "upstream/${upstream_branch}" >/dev/null 2>&1; then
            log_warning "  ${main_label}: Cannot determine status (upstream branch missing)"
        else
            local local_ahead=$(git rev-list --count "upstream/${upstream_branch}..${fork_branch}" 2>/dev/null || echo "0")
            local local_behind=$(git rev-list --count "${fork_branch}..upstream/${upstream_branch}" 2>/dev/null || echo "0")
            
            # Also check if local is ahead of origin (unpushed commits)
            local origin_ahead="0"
            if git rev-parse --verify "origin/${fork_branch}" >/dev/null 2>&1; then
                origin_ahead=$(git rev-list --count "origin/${fork_branch}..${fork_branch}" 2>/dev/null || echo "0")
            fi
            
            if [ "$local_behind" -gt 0 ]; then
                log_warning "  ${main_label}: ${local_behind} commit(s) behind upstream"
            elif [ "$local_ahead" -gt 0 ]; then
                if [ "$origin_ahead" -gt 0 ]; then
                    log_info "  ${main_label}: ${local_ahead} commit(s) ahead of upstream (${origin_ahead} unpushed)"
                else
                    log_info "  ${main_label}: ${local_ahead} commit(s) ahead of upstream"
                fi
            else
                log_success "  ${main_label}: Up to date with upstream"
            fi
        fi
        
        # Check if upstream tracking branch exists (local only, not pushed)
        cd "${PROJECT_ROOT}/${path}"
        if git rev-parse --verify "$upstream_tracking_branch" >/dev/null 2>&1; then
            if ! git rev-parse --verify "upstream/${upstream_branch}" >/dev/null 2>&1; then
                log_info "  Upstream tracking branch (${upstream_tracking_branch}): Cannot determine status (upstream missing)"
            else
                local tracking_ahead=$(git rev-list --count "upstream/${upstream_branch}..${upstream_tracking_branch}" 2>/dev/null || echo "0")
                local tracking_behind=$(git rev-list --count "${upstream_tracking_branch}..upstream/${upstream_branch}" 2>/dev/null || echo "0")
                if [ "$tracking_behind" -gt 0 ]; then
                    log_warning "  Upstream tracking branch (${upstream_tracking_branch}): ${tracking_behind} commit(s) behind upstream"
                elif [ "$tracking_ahead" -gt 0 ]; then
                    log_info "  Upstream tracking branch (${upstream_tracking_branch}): ${tracking_ahead} commit(s) ahead (unexpected)"
                else
                    log_success "  Upstream tracking branch (${upstream_tracking_branch}): Up to date"
                fi
            fi
        else
            log_info "  Upstream tracking branch (${upstream_tracking_branch}): Not created yet"
        fi
        
    done < <(echo "$config_json")
    
    echo ""
}

# Sync main branch (merge upstream into Faktenforum main branch)
sync_main_branch() {
    local submodule_path="$1"
    local fork_branch="$2"
    local upstream_branch="$3"
    
    cd "${PROJECT_ROOT}/${submodule_path}"
    
    log_submodule "Syncing main branch (${fork_branch}) with upstream..."
    
    [ "$DRY_RUN" = true ] && { log_info "[DRY RUN] Would checkout ${fork_branch} and merge upstream/${upstream_branch}"; return 0; }
    
    git checkout "$fork_branch" 2>/dev/null || { log_error "Failed to checkout ${fork_branch}"; return 1; }
    
    if git merge "upstream/${upstream_branch}" --no-edit; then
        log_success "Merged upstream/${upstream_branch} into ${fork_branch}"
    elif [ -n "$(git ls-files -u)" ]; then
        # Conflicts detected
        handle_merge_conflicts "$submodule_path" "$fork_branch" || return 1
    else
        log_error "Merge failed (unknown reason)"
        return 1
    fi
}

# Create/update upstream tracking branch
sync_upstream_tracking_branch() {
    local submodule_path="$1"
    local upstream_tracking_branch="$2"
    local upstream_branch="$3"
    
    cd "${PROJECT_ROOT}/${submodule_path}"
    
    log_submodule "Updating upstream tracking branch (${upstream_tracking_branch})..."
    
    [ "$DRY_RUN" = true ] && {
        log_info "[DRY RUN] Would create/update ${upstream_tracking_branch} from upstream/${upstream_branch}"
        return 0
    }
    
    if ! git rev-parse --verify "$upstream_tracking_branch" >/dev/null 2>&1; then
        log_warning "Branch ${upstream_tracking_branch} does not exist, creating from upstream/${upstream_branch}..."
        git checkout -b "$upstream_tracking_branch" "upstream/${upstream_branch}" || {
            log_error "Failed to create ${upstream_tracking_branch} branch"
            return 1
        }
    else
        git checkout "$upstream_tracking_branch" 2>/dev/null || {
            log_error "Failed to checkout ${upstream_tracking_branch}"
            return 1
        }
        git reset --hard "upstream/${upstream_branch}" || {
            log_error "Failed to reset ${upstream_tracking_branch} to upstream/${upstream_branch}"
            return 1
        }
        log_success "Updated ${upstream_tracking_branch} to match upstream/${upstream_branch}"
    fi
}

# Handle merge conflicts interactively
handle_merge_conflicts() {
    local submodule_path="$1"
    local branch="$2"
    
    cd "${PROJECT_ROOT}/${submodule_path}"
    
    log_warning "Merge conflicts detected in ${submodule_path} (branch: ${branch})"
    
    # List conflicted files
    local conflicted_files=$(git diff --name-only --diff-filter=U)
    [ -n "$conflicted_files" ] && {
        echo ""
        log_info "Conflicted files:"
        echo "$conflicted_files" | while IFS= read -r file; do
            [ -n "$file" ] && echo "  - $file"
        done
    }
    
    echo ""
    log_info "To resolve conflicts:"
    log_info "  1. cd ${PROJECT_ROOT}/${submodule_path}"
    log_info "  2. Edit conflicted files and resolve conflicts"
    log_info "  3. git add <file>  # Stage resolved files"
    log_info "  4. git commit      # Complete merge"
    log_info "  5. Press Enter here to continue"
    echo ""
    
    [ "$FORCE" = true ] && { log_warning "Force mode: Skipping conflict resolution"; return 0; }
    
    read -p "Press Enter after resolving conflicts, or Ctrl+C to abort... "
    
    # Verify conflicts are resolved
    if [ -z "$(git ls-files -u)" ] && git diff --check --quiet 2>/dev/null; then
        log_success "Conflicts resolved"
    else
        log_error "Unresolved conflicts still exist. Please resolve them before continuing."
        return 1
    fi
}

# Sync a single submodule
sync_submodule() {
    local config_json="$1"
    
    local path fork_url upstream_url upstream_branch fork_branch upstream_tracking_branch description
    
    if [ "$YAML_PARSER" = "python3" ]; then
        path=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('path', ''))" 2>/dev/null)
        fork_url=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fork_url', ''))" 2>/dev/null)
        upstream_url=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_url', ''))" 2>/dev/null)
        upstream_branch=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_branch', 'main'))" 2>/dev/null)
        fork_branch=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('fork_branch', 'main'))" 2>/dev/null)
        upstream_tracking_branch=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('upstream_tracking_branch', 'upstream'))" 2>/dev/null)
        description=$(echo "$config_json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('description', ''))" 2>/dev/null)
    else
        path=$(echo "$config_json" | yq eval '.path' -)
        fork_url=$(echo "$config_json" | yq eval '.fork_url' -)
        upstream_url=$(echo "$config_json" | yq eval '.upstream_url' -)
        upstream_branch=$(echo "$config_json" | yq eval '.upstream_branch // "main"' -)
        fork_branch=$(echo "$config_json" | yq eval '.fork_branch // "main"' -)
        upstream_tracking_branch=$(echo "$config_json" | yq eval '.upstream_tracking_branch // "upstream"' -)
        description=$(echo "$config_json" | yq eval '.description // ""' -)
    fi
    
    # Filter by selected submodule if specified
    if [ -n "$SELECTED_SUBMODULE" ] && [ "$path" != "$SELECTED_SUBMODULE" ]; then
        return 0
    fi
    
    # Skip entries without upstream (e.g. external dev submodules with only post_init)
    if [ -z "$upstream_url" ]; then
        return 0
    fi
    
    log_step "Syncing ${path}"
    if [ -n "$description" ]; then
        log_info "Description: $description"
    fi
    
    # Check if submodule is initialized
    if ! is_submodule_initialized "$path"; then
        log_warning "Submodule not initialized, skipping..."
        return 0
    fi
    
    # Check for uncommitted changes
    if has_uncommitted_changes "$path"; then
        if [ "$FORCE" = false ]; then
            log_error "Uncommitted changes detected in ${path}"
            log_error "Commit or stash changes before syncing, or use --force to skip this check"
            return 1
        else
            log_warning "Uncommitted changes detected, but --force is set, continuing..."
        fi
    fi
    
    # For non-forks: step 1 already pulled; only add upstream remote for reference (optional). Skip branch logic.
    if [ -z "$fork_url" ]; then
        setup_upstream_remote "$path" "$upstream_url"
        fetch_upstream "$path" || true
        log_success "Completed (non-fork; already updated in step 1)"
        return 0
    fi

    # Fork: setup upstream remote, tracking branch, then merge into main
    setup_upstream_remote "$path" "$upstream_url"
    if ! fetch_upstream "$path"; then
        return 1
    fi

    # Sync upstream tracking branch (fork only)
    if [ -z "$SELECTED_BRANCH" ] || [ "$SELECTED_BRANCH" = "$upstream_tracking_branch" ]; then
        sync_upstream_tracking_branch "$path" "$upstream_tracking_branch" "$upstream_branch"
    fi

    if [ -z "$SELECTED_BRANCH" ] || [ "$SELECTED_BRANCH" = "$fork_branch" ]; then
        sync_main_branch "$path" "$fork_branch" "$upstream_branch"
    fi

    log_success "Completed sync for ${path}"
}

# Main update function: (1) pull all submodules, (2) for forks/upstream-only: upstream + merge
sync_all_submodules() {
    log_step "Step 1: Updating all submodules (git submodule update --init --remote)"
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would run: git submodule update --init --remote"
    else
        if git submodule update --init --remote; then
            log_success "All submodules updated"
        else
            log_error "Failed to update submodules"
            exit 1
        fi
    fi

    log_step "Step 2: Fork/upstream-only submodules (upstream remote, tracking branch; forks: merge into main)"
    local config_json failed_syncs=0
    config_json=$([ "$YAML_PARSER" = "python3" ] && parse_yaml_python || parse_yaml_yq)

    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        sync_submodule "$line" || ((failed_syncs++))
    done < <(echo "$config_json")

    echo ""
    if [ $failed_syncs -eq 0 ]; then
        log_success "All submodules up to date!"
    else
        log_error "${failed_syncs} submodule(s) failed to sync"
        exit 1
    fi
}

# Main execution
main() {
    parse_args "$@"
    
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  Update Submodules                                        ║"
    echo "║  All submodules up to date; forks: upstream + merge       ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    
    if [ "$DRY_RUN" = true ]; then
        log_warning "DRY RUN MODE: No changes will be applied"
        echo ""
    fi
    
    check_prerequisites
    
    if [ "$STATUS_ONLY" = true ]; then
        show_status
    else
        sync_all_submodules
    fi
}

# Run main function
main "$@"

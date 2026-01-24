#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Common utilities for submodule management scripts
# Provides shared functions for logging, YAML parsing, and git operations

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

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

# Detect and configure YAML parser
detect_yaml_parser() {
    if command_exists python3 && python3 -c "import yaml" 2>/dev/null; then
        echo "python3"
    elif command_exists yq; then
        echo "yq"
    else
        return 1
    fi
}

# Parse YAML configuration using Python
parse_yaml_python() {
    local config_file="$1"
    python3 << PYTHON_SCRIPT
import yaml
import sys
import json

try:
    with open('${config_file}', 'r') as f:
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
    local config_file="$1"
    yq eval '.submodules[]' -o json -c "$config_file" 2>/dev/null
}

# Parse YAML configuration (auto-detect parser)
parse_yaml_config() {
    local config_file="$1"
    local parser
    
    parser=$(detect_yaml_parser) || {
        log_error "No YAML parser available. Install PyYAML (pip3 install pyyaml) or yq"
        return 1
    }
    
    if [ "$parser" = "python3" ]; then
        parse_yaml_python "$config_file"
    else
        parse_yaml_yq "$config_file"
    fi
}

# Extract field from JSON config (works with both parsers)
extract_config_field() {
    local json="$1"
    local field="$2"
    local default="${3:-}"
    local parser="${4:-python3}"
    
    if [ "$parser" = "python3" ]; then
        echo "$json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('${field}', '${default}'))" 2>/dev/null
    else
        echo "$json" | yq eval ".${field} // \"${default}\"" - 2>/dev/null
    fi
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

# Setup upstream remote
setup_upstream_remote() {
    local submodule_path="$1"
    local upstream_url="$2"
    local project_root="$3"
    
    cd "${project_root}/${submodule_path}"
    
    if git remote | grep -q "^upstream$"; then
        local current_url=$(git remote get-url upstream 2>/dev/null || echo "")
        if [ "$current_url" != "$upstream_url" ]; then
            log_submodule "Updating upstream remote URL..."
            git remote set-url upstream "$upstream_url"
        fi
    else
        log_submodule "Adding upstream remote..."
        git remote add upstream "$upstream_url"
    fi
}

# Fetch from remote
fetch_remote() {
    local submodule_path="$1"
    local remote="$2"
    local project_root="$3"
    local quiet="${4:-true}"
    
    cd "${project_root}/${submodule_path}"
    
    if [ "$quiet" = "true" ]; then
        git fetch "$remote" --quiet 2>/dev/null || return 1
    else
        git fetch "$remote" 2>/dev/null || return 1
    fi
}

# Check for uncommitted changes
has_uncommitted_changes() {
    local submodule_path="$1"
    local project_root="$2"
    cd "${project_root}/${submodule_path}"
    ! git diff-index --quiet HEAD -- 2>/dev/null
}

# Get current branch
get_current_branch() {
    local submodule_path="$1"
    local project_root="$2"
    cd "${project_root}/${submodule_path}"
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

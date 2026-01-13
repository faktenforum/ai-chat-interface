#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Prepare development git submodules for the dev stack
# This script:
# 1. Initializes and updates git submodules
# 2. Builds the agents npm package (required by LibreChat)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Change to project root
cd "${PROJECT_ROOT}"

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

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Step 1: Initialize and update git submodules
step_init_submodules() {
    log_step "Step 1: Initializing and updating git submodules"
    
    if ! command_exists git; then
        log_error "git is not installed"
        exit 1
    fi
    
    log_info "Updating git submodules..."
    if git submodule update --init --remote; then
        log_success "Git submodules initialized and updated"
    else
        log_error "Failed to initialize git submodules"
        exit 1
    fi
}

# Step 2: Build agents npm package
step_build_agents() {
    log_step "Step 2: Building agents npm package"
    
    local agents_dir="${PROJECT_ROOT}/dev/agents"
    
    if [ ! -d "${agents_dir}" ]; then
        log_warning "agents directory not found, skipping..."
        return
    fi
    
    if ! command_exists npm; then
        log_warning "npm is not installed, skipping agents build"
        log_warning "You may need to build agents manually: cd dev/agents && npm install && npm run build"
        return
    fi
    
    cd "${agents_dir}"
    
    log_info "Installing dependencies for agents package..."
    if npm install; then
        log_success "Dependencies installed"
    else
        log_error "Failed to install dependencies"
        exit 1
    fi
    
    log_info "Building agents package..."
    if npm run build; then
        log_success "Agents package built successfully"
    else
        log_error "Failed to build agents package"
        exit 1
    fi
    
    cd "${PROJECT_ROOT}"
}


# Main execution
main() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  Prepare Development Submodules                          ║"
    echo "║  AI Chat Interface - Dev Stack Setup                    ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    
    log_info "Project root: ${PROJECT_ROOT}"
    log_info "This script will:"
    log_info "  1. Initialize and update git submodules"
    log_info "  2. Build agents npm package"
    echo ""
    
    # Run steps
    step_init_submodules
    step_build_agents
    
    echo ""
    log_success "All development submodules prepared successfully!"
    echo ""
    log_info "Next steps:"
    log_info "  docker compose -f docker-compose.dev.yml build"
    log_info "  docker compose -f docker-compose.dev.yml up -d"
    echo ""
}

# Run main function
main "$@"

#!/bin/bash
set -e

# lgtm dev installer
# Creates a wrapper script that runs the local development code via bun

INSTALL_DIR="${LGTM_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="lgtm"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}==>${NC} $1"; }
error() { echo -e "${RED}Error:${NC} $1" >&2; exit 1; }

check_bun() {
    if ! command -v bun &> /dev/null; then
        error "bun is required but not installed. Install it from https://bun.sh"
    fi
}

install() {
    local wrapper_script="${INSTALL_DIR}/${BINARY_NAME}"
    
    info "Creating dev wrapper at ${wrapper_script}..."
    
    # Create the wrapper script
    local wrapper_content="#!/bin/bash
# lgtm dev wrapper - runs local source code
exec bun \"${SCRIPT_DIR}/src/cli.ts\" \"\$@\"
"

    if [ -w "$INSTALL_DIR" ]; then
        echo "$wrapper_content" > "$wrapper_script"
        chmod +x "$wrapper_script"
    else
        warn "Need sudo to install to ${INSTALL_DIR}"
        echo "$wrapper_content" | sudo tee "$wrapper_script" > /dev/null
        sudo chmod +x "$wrapper_script"
    fi

    success "Installed dev wrapper successfully!"
    echo ""
    echo -e "The ${GREEN}lgtm${NC} command now runs: ${BLUE}bun ${SCRIPT_DIR}/src/cli.ts${NC}"
    echo ""
    
    # Verify
    if command -v lgtm &> /dev/null; then
        info "Verifying installation..."
        lgtm --version
    else
        warn "${INSTALL_DIR} may not be in your PATH. Add it with:"
        echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    fi
}

main() {
    echo ""
    echo -e "${BLUE}lgtm dev installer${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    check_bun
    install
}

main "$@"

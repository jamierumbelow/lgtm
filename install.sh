#!/bin/bash
set -e

# lgtm installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jamierumbelow/lgtm/main/install.sh | bash
#
# For private repos, set GITHUB_TOKEN first:
#   export GITHUB_TOKEN=$(gh auth token)
#   curl -fsSL ... | bash

REPO="jamierumbelow/lgtm"
INSTALL_DIR="${LGTM_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="lgtm"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}==>${NC} $1"; }
error() { echo -e "${RED}Error:${NC} $1" >&2; exit 1; }

# Build auth header if token available
get_auth_header() {
    if [ -n "$GITHUB_TOKEN" ]; then
        echo "Authorization: Bearer ${GITHUB_TOKEN}"
    elif command -v gh &> /dev/null; then
        local token
        token=$(gh auth token 2>/dev/null || true)
        if [ -n "$token" ]; then
            echo "Authorization: Bearer ${token}"
        fi
    fi
}

# Detect platform
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) error "Unsupported operating system: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${os}-${arch}"
}

# Get latest release version
get_latest_version() {
    local auth_header
    auth_header=$(get_auth_header)
    
    if [ -n "$auth_header" ]; then
        curl -fsSL -H "$auth_header" "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
    else
        curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
    fi
}

# Download and install
install() {
    local platform version download_url tmp_dir auth_header

    info "Detecting platform..."
    platform=$(detect_platform)
    success "Detected platform: ${platform}"

    auth_header=$(get_auth_header)
    if [ -n "$auth_header" ]; then
        info "Using GitHub authentication"
    fi

    info "Fetching latest version..."
    version=$(get_latest_version)
    if [ -z "$version" ]; then
        error "Could not determine latest version. Make sure you have access to the repository.

For private repos, authenticate with:
  export GITHUB_TOKEN=\$(gh auth token)

Then run this script again."
    fi
    success "Latest version: ${version}"

    # Construct download URL
    local artifact_name="lgtm-${platform}"
    if [ "$platform" = "windows-x64" ]; then
        artifact_name="${artifact_name}.exe"
    fi
    download_url="https://github.com/${REPO}/releases/download/${version}/${artifact_name}"

    # Create temp directory
    tmp_dir=$(mktemp -d)
    trap "rm -rf ${tmp_dir}" EXIT

    info "Downloading ${artifact_name}..."
    local curl_opts="-fsSL -H 'Accept: application/octet-stream'"
    if [ -n "$auth_header" ]; then
        if ! curl -fsSL -H "$auth_header" -H "Accept: application/octet-stream" -L -o "${tmp_dir}/${BINARY_NAME}" "${download_url}"; then
            error "Failed to download. Check your GitHub token has access to releases."
        fi
    else
        if ! curl -fsSL -H "Accept: application/octet-stream" -L -o "${tmp_dir}/${BINARY_NAME}" "${download_url}"; then
            error "Failed to download. For private repos, set GITHUB_TOKEN first:
  export GITHUB_TOKEN=\$(gh auth token)"
        fi
    fi
    success "Downloaded successfully"

    # Make executable
    chmod +x "${tmp_dir}/${BINARY_NAME}"

    # Install to destination
    info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
    
    if [ -w "$INSTALL_DIR" ]; then
        mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        warn "Need sudo to install to ${INSTALL_DIR}"
        sudo mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    success "Installed successfully!"
    echo ""
    echo -e "Run ${GREEN}lgtm --help${NC} to get started"
    echo ""
    
    # Verify installation
    if command -v lgtm &> /dev/null; then
        info "Verifying installation..."
        lgtm --version
    else
        warn "${INSTALL_DIR} may not be in your PATH. Add it with:"
        echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    fi
}

# Check for required commands
check_dependencies() {
    if ! command -v curl &> /dev/null; then
        error "curl is required but not installed"
    fi
}

main() {
    echo ""
    echo -e "${BLUE}lgtm installer${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    check_dependencies
    install
}

main "$@"

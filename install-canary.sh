#!/bin/bash
set -e

# lgtm canary installer
# Installs the latest build from master (may be unstable)
#
# Usage: curl -fsSL https://raw.githubusercontent.com/jamierumbelow/lgtm/master/install-canary.sh | bash
#
# Uses your `gh` CLI authentication to download releases from the private repo.

REPO="jamierumbelow/lgtm"
INSTALL_DIR="${LGTM_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="lgtm"
CANARY_TAG="canary"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
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

# Get canary release info
get_canary_info() {
    local auth_header
    auth_header=$(get_auth_header)
    
    if [ -n "$auth_header" ]; then
        curl -fsSL -H "$auth_header" "https://api.github.com/repos/${REPO}/releases/tags/${CANARY_TAG}"
    else
        curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${CANARY_TAG}"
    fi
}

# Download and install
install() {
    local platform tmp_dir auth_header release_info commit_sha

    info "Detecting platform..."
    platform=$(detect_platform)
    success "Detected platform: ${platform}"

    auth_header=$(get_auth_header)
    if [ -n "$auth_header" ]; then
        info "Using GitHub authentication"
    fi

    info "Fetching canary release..."
    release_info=$(get_canary_info)
    if [ -z "$release_info" ] || echo "$release_info" | grep -q '"message": "Not Found"'; then
        error "Could not find canary release. Either:
  - No canary builds have been published yet
  - You don't have access to the repository

Check releases at: https://github.com/${REPO}/releases"
    fi
    
    # Extract commit info from release body if available
    commit_sha=$(echo "$release_info" | grep -o '"target_commitish": "[^"]*"' | head -1 | sed 's/.*": "//;s/"//')
    if [ -n "$commit_sha" ]; then
        success "Canary build from commit: ${commit_sha:0:7}"
    fi

    # Find asset ID for our platform (required for private repo downloads)
    local artifact_name="lgtm-${platform}"
    if [ "$platform" = "windows-x64" ]; then
        artifact_name="${artifact_name}.exe"
    fi
    
    local asset_id
    asset_id=$(echo "$release_info" | grep -B5 "\"name\": \"${artifact_name}\"" | grep '"id":' | head -1 | sed 's/.*: //;s/,//')
    
    if [ -z "$asset_id" ]; then
        error "Could not find asset '${artifact_name}' in canary release.
Available assets may not include your platform yet.
Check releases at: https://github.com/${REPO}/releases/tag/${CANARY_TAG}"
    fi

    # Create temp directory
    tmp_dir=$(mktemp -d)
    trap "rm -rf ${tmp_dir}" EXIT

    # Download via API (required for private repos)
    local download_url="https://api.github.com/repos/${REPO}/releases/assets/${asset_id}"
    
    info "Downloading ${artifact_name}..."
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
    warn "You installed a canary build. This may be unstable."
    warn "For stable releases, use install.sh instead."
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
    echo -e "${MAGENTA}lgtm canary installer${NC}"
    echo -e "${YELLOW}⚠ Installing latest build from master (may be unstable)${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    check_dependencies
    install
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

# OpenCode Snowflake Cortex Edition - Install from Source
# This script clones the repo, installs dependencies, builds, and installs the binary.

MUTED='\033[0;2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
ORANGE='\033[38;5;214m'
NC='\033[0m'

REPO="sfc-gh-kkeller/Opencode-Snowflake-Cortex-Edition"
REPO_URL="https://github.com/${REPO}.git"
BRANCH="main"
BUILD_DIR="${TMPDIR:-/tmp}/opencode-build-$$"
INSTALL_DIR="${OPENCODE_INSTALL_DIR:-$HOME/.opencode/bin}"

usage() {
    cat <<EOF
OpenCode Installer (Snowflake Cortex Edition) - Build from Source

Usage: install_source.sh [options]

Options:
    -h, --help              Display this help message
    -b, --branch <branch>   Build from a specific branch (default: main)
    -d, --dir <path>        Custom install directory (default: ~/.opencode/bin)
        --keep-build        Don't delete the build directory after install
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://github.com/${REPO}/releases/latest/download/install_source.sh | bash
    ./install_source.sh --branch dev
    ./install_source.sh --dir /usr/local/bin

Requirements:
    - git
    - curl (for bun installation if needed)

EOF
}

no_modify_path=false
keep_build=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -b|--branch)
            if [[ -n "${2:-}" ]]; then
                BRANCH="$2"
                shift 2
            else
                echo -e "${RED}Error: --branch requires an argument${NC}"
                exit 1
            fi
            ;;
        -d|--dir)
            if [[ -n "${2:-}" ]]; then
                INSTALL_DIR="$2"
                shift 2
            else
                echo -e "${RED}Error: --dir requires a path argument${NC}"
                exit 1
            fi
            ;;
        --keep-build)
            keep_build=true
            shift
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${ORANGE}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

print_step() {
    echo -e "\n${GREEN}==>${NC} $1"
}

print_info() {
    echo -e "${MUTED}$1${NC}"
}

print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

# Check for required tools
check_requirements() {
    print_step "Checking requirements..."

    if ! command -v git >/dev/null 2>&1; then
        print_error "git is required but not installed"
        exit 1
    fi
    print_info "  git: $(git --version)"

    if ! command -v curl >/dev/null 2>&1; then
        print_error "curl is required but not installed"
        exit 1
    fi
    print_info "  curl: found"
}

# Install bun if not available
install_bun() {
    if command -v bun >/dev/null 2>&1; then
        print_info "  bun: $(bun --version)"
        return 0
    fi

    print_step "Installing bun..."

    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        # Windows
        powershell -c "irm bun.sh/install.ps1 | iex"
    else
        # macOS / Linux
        curl -fsSL https://bun.sh/install | bash
    fi

    # Source bun into current shell
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if ! command -v bun >/dev/null 2>&1; then
        print_error "Failed to install bun. Please install manually: https://bun.sh"
        exit 1
    fi

    print_info "  bun: $(bun --version) (freshly installed)"
}

# Clone the repository
clone_repo() {
    print_step "Cloning OpenCode Snowflake Cortex Edition..."
    print_info "  Repository: ${REPO_URL}"
    print_info "  Branch: ${BRANCH}"
    print_info "  Build directory: ${BUILD_DIR}"

    mkdir -p "$BUILD_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$BUILD_DIR"
}

# Build the binary
build_opencode() {
    print_step "Installing dependencies..."
    cd "$BUILD_DIR"
    bun install

    print_step "Building opencode_cortex binary..."
    bun ./packages/opencode/script/build.ts --single

    # Find the built binary
    local os arch binary_path
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os" in
        darwin) os="darwin" ;;
        linux) os="linux" ;;
        mingw*|msys*|cygwin*) os="windows" ;;
    esac

    case "$arch" in
        x86_64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
    esac

    # Check for Rosetta on macOS
    if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
        local rosetta_flag
        rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
        if [[ "$rosetta_flag" == "1" ]]; then
            arch="arm64"
        fi
    fi

    binary_path="$BUILD_DIR/packages/opencode/dist/opencode_cortex-${os}-${arch}/bin/opencode_cortex"

    if [[ ! -f "$binary_path" ]]; then
        print_error "Build failed - binary not found at: $binary_path"
        print_info "Checking dist directory contents:"
        ls -la "$BUILD_DIR/packages/opencode/dist/" 2>/dev/null || true
        exit 1
    fi

    BUILT_BINARY="$binary_path"
    print_info "  Built binary: $BUILT_BINARY"
}

# Install the binary
install_binary() {
    print_step "Installing to ${INSTALL_DIR}..."

    mkdir -p "$INSTALL_DIR"
    cp "$BUILT_BINARY" "$INSTALL_DIR/opencode_cortex"
    chmod 755 "$INSTALL_DIR/opencode_cortex"
    # Ensure opencode remains available for vanilla installs only
    rm -f "$INSTALL_DIR/opencode"

    print_info "  Installed: ${INSTALL_DIR}/opencode_cortex"
}

# Add to PATH
add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file" 2>/dev/null; then
        print_info "  Already in PATH via $config_file"
    elif [[ -w "$config_file" ]]; then
        echo -e "\n# opencode_cortex" >> "$config_file"
        echo "$command" >> "$config_file"
        print_info "  Added to PATH in $config_file"
    else
        echo -e "${ORANGE}  Manually add to your shell config:${NC}"
        echo "    $command"
    fi
}

setup_path() {
    if [[ "$no_modify_path" == "true" ]]; then
        return 0
    fi

    if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
        return 0
    fi

    print_step "Setting up PATH..."

    local current_shell config_file
    current_shell=$(basename "$SHELL")

    case $current_shell in
        fish)
            config_file="$HOME/.config/fish/config.fish"
            [[ -f "$config_file" ]] && add_to_path "$config_file" "fish_add_path $INSTALL_DIR"
            ;;
        zsh)
            config_file="${ZDOTDIR:-$HOME}/.zshrc"
            [[ -f "$config_file" ]] && add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        bash)
            for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
                if [[ -f "$f" ]]; then
                    config_file="$f"
                    break
                fi
            done
            [[ -n "$config_file" ]] && add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        *)
            echo -e "${ORANGE}  Add this to your shell config:${NC}"
            echo "    export PATH=$INSTALL_DIR:\$PATH"
            ;;
    esac
}

# Cleanup
cleanup() {
    if [[ "$keep_build" == "true" ]]; then
        print_info "\n  Build directory kept at: $BUILD_DIR"
    else
        print_step "Cleaning up..."
        rm -rf "$BUILD_DIR"
        print_info "  Removed build directory"
    fi
}

# Print success message
print_success() {
    local version
    version=$("$INSTALL_DIR/opencode_cortex" --version 2>/dev/null || echo "unknown")

    echo -e ""
    echo -e "${MUTED}                    ${NC}             ▄     "
    echo -e "${MUTED}█▀▀█ █▀▀█ █▀▀█ █▀▀▄ ${NC}█▀▀▀ █▀▀█ █▀▀█ █▀▀█"
    echo -e "${MUTED}█░░█ █░░█ █▀▀▀ █░░█ ${NC}█░░░ █░░█ █░░█ █▀▀▀"
    echo -e "${MUTED}▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ${NC}▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"
    echo -e "${MUTED}       Snowflake Cortex Edition${NC}"
    echo -e ""
    echo -e "${GREEN}Successfully installed!${NC}"
    echo -e ""
    echo -e "  ${MUTED}Version:${NC}  $version"
    echo -e "  ${MUTED}Binary:${NC}   $INSTALL_DIR/opencode_cortex"
    echo -e ""
    echo -e "${MUTED}To start with Snowflake Cortex:${NC}"
    echo -e ""
    echo -e "  cd <project>  ${MUTED}# Open directory${NC}"
    echo -e "  opencode_cortex ${MUTED}# Run command${NC}"
    echo -e ""
    echo -e "${MUTED}Configure Cortex in opencode_cortex.json - see:${NC}"
    echo -e "https://github.com/${REPO}#snowflake-cortex-edition"
    echo -e ""

    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        echo -e "${ORANGE}Note: Restart your shell or run:${NC}"
        echo -e "  export PATH=$INSTALL_DIR:\$PATH"
        echo -e ""
    fi
}

# Main
main() {
    echo -e "${GREEN}OpenCode Snowflake Cortex Edition - Install from Source${NC}"

    check_requirements
    install_bun
    clone_repo
    build_opencode
    install_binary
    setup_path
    cleanup
    print_success
}

main

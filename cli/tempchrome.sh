#!/bin/bash

# TempChrome - Temporary Profile Launcher
# Usage: tempchrome [--auto-cleanup] [chromium-arguments]
# Example: tempchrome --incognito --disable-extensions
# Example: tempchrome --auto-cleanup --incognito

# =============================================================================
# Simple Colored Echo with Icons
# =============================================================================

# Basic Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[0;37m'

# Text Styles
BOLD='\033[1m'

# Reset
NC='\033[0m' # No Color

# =============================================================================
# Common Icons
# =============================================================================

# Simple symbols for better compatibility
CHECK="[✓]"
CROSS="[✗]"
WARN="[!]"
INFO="[i]"

set -e  # Exit on any error

# Configuration
CHROMIUM_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
TEMP_BASE_DIR="/tmp/tempchrome_profile"

# Function to print a full-width line
print_divider() {
    local color="${1:-$PURPLE}"
    local width=$(($(tput cols 2>/dev/null || echo 80) - 16))
    printf "${color}━━━━[tempchrome]%${width}s${NC}\n" | tr ' ' '━'
}

# Function to display usage
usage() {
    echo ""
    echo -e "  ${CYAN}${BOLD}TempChrome - Temporary Profile Launcher${NC}"
    echo -e "  ${CYAN}Creates isolated browsing sessions with throwaway profiles${NC}"
    echo ""
    echo -e "${YELLOW}${BOLD}USAGE${NC}"
    echo -e "  ${WHITE}tempchrome${NC} ${GREEN}[options]${NC} ${GREEN}[chromium-arguments...]${NC}"
    echo ""
    echo -e "${YELLOW}${BOLD}OPTIONS${NC}"
    echo -e "  ${WHITE}--auto-cleanup${NC}        Automatically delete temp profile after Chromium closes"
    echo -e "  ${WHITE}-h, --help${NC}            Show this help message"
    echo ""
    echo -e "${YELLOW}${BOLD}EXAMPLES${NC}"
    echo -e "  ${WHITE}tempchrome${NC}                              ${BLUE}Launch with temporary profile${NC}"
    echo -e "  ${WHITE}tempchrome --auto-cleanup${NC}               ${BLUE}Launch and cleanup after exit${NC}"
    echo -e "  ${WHITE}tempchrome --incognito${NC}                  ${BLUE}Launch in incognito mode${NC}"
    echo -e "  ${WHITE}tempchrome --disable-extensions${NC}         ${BLUE}Launch without extensions${NC}"
    echo -e "  ${WHITE}tempchrome --auto-cleanup --incognito${NC}   ${BLUE}Auto-cleanup + incognito${NC}"
    echo -e "  ${WHITE}tempchrome --disable-web-security${NC}       ${BLUE}Don't check same-origin policy${NC}"
    echo ""
    echo -e "${YELLOW}${BOLD}DETAILS${NC}"
    echo -e "  ${PURPLE}Source${NC}        Official Chromium snapshots (storage.googleapis.com)"
    echo -e "  ${PURPLE}Platforms${NC}     Intel (Mac) and Apple Silicon (Mac_Arm), auto-detected"
    echo -e "  ${PURPLE}Profiles${NC}      ${CYAN}/tmp/tempchrome_profile/<id>${NC}  (mode 700, 10-char random ID)"
    echo -e "  ${PURPLE}Google API${NC}    Pre-configured with Chromium API keys for Google sign-in"
    echo -e "  ${PURPLE}Quarantine${NC}    macOS quarantine attributes cleared automatically on launch"
    echo ""
    exit 0
}

# Function to cleanup on exit
cleanup() {
    if [[ -d "$PROFILE_DIR" ]]; then
        echo -e "${YELLOW}${WARN}${NC} ${YELLOW}Cleaning up temporary profile:${NC} ${CYAN}${BOLD}$PROFILE_DIR${NC}"
        rm -rf "$PROFILE_DIR"
        echo -e "${GREEN}${CHECK}${NC} ${GREEN}Temporary profile removed successfully${NC}"
    fi
}

# Parse options
AUTO_CLEANUP=0
CHROMIUM_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto-cleanup)
            AUTO_CLEANUP=1
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            CHROMIUM_ARGS+=("$1")
            shift
            ;;
    esac
done

# Check if Chromium exists
if [[ ! -f "$CHROMIUM_PATH" ]]; then
    echo -e "${RED}${CROSS}${NC} ${RED}Chromium not found at${NC} ${CYAN}${BOLD}$CHROMIUM_PATH${NC}"
    echo -e "${CYAN}${INFO}${NC} ${CYAN}Install Chromium via the Raycast command 'Install or Update Chromium…' in the TempChrome extension.${NC}"
    echo -e "${YELLOW}${WARN}${NC} ${YELLOW}Note: Homebrew 'chromium' cask is deprecated as of September 2026${NC}"
    exit 1
fi

# Ensure base directory exists with proper permissions
mkdir -p "$TEMP_BASE_DIR"
chmod 700 "$TEMP_BASE_DIR"

# Generate unique temporary directory with collision avoidance
# Using 10 characters for better entropy (36^10 = 3.66 quadrillion combinations)
MAX_ATTEMPTS=100
attempt=0

while [[ $attempt -lt $MAX_ATTEMPTS ]]; do
    TMP_ID=$(LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c 10)
    PROFILE_DIR="$TEMP_BASE_DIR/$TMP_ID"

    # Atomic directory creation - fails if exists
    if mkdir -m 700 "$PROFILE_DIR" 2>/dev/null; then
        echo -e "${GREEN}${CHECK}${NC} ${GREEN}Temporary profile created:${NC} ${CYAN}${BOLD}$PROFILE_DIR${NC}"
        break
    fi

    ((attempt++))
done

if [[ $attempt -eq $MAX_ATTEMPTS ]]; then
    echo -e "${RED}${CROSS}${NC} ${RED}Error: Failed to create unique profile directory after $MAX_ATTEMPTS attempts${NC}"
    exit 1
fi

if [[ $AUTO_CLEANUP -eq 1 ]]; then
    trap cleanup EXIT
    echo -e "${BLUE}${INFO}${NC} ${BLUE}Auto-cleanup enabled - profile will be deleted after Chromium closes${NC}"
fi


echo -e "${PURPLE}🚀${NC} ${PURPLE}Launching Chromium with temporary profile...${NC}"
print_divider "$PURPLE"

# Credential from LINUX Chromium Browser
xattr -cr /Applications/Chromium.app

GOOGLE_API_KEY="AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k" \
GOOGLE_DEFAULT_CLIENT_ID="811574891467.apps.googleusercontent.com" \
GOOGLE_DEFAULT_CLIENT_SECRET="kdloedMFGdGla2P1zacGjAQh" \
"$CHROMIUM_PATH" \
--user-data-dir="$PROFILE_DIR" \
--disable-fre \
--no-first-run \
--no-default-browser-check \
--new-window \
--enable-logging \
--log-file="$PROFILE_DIR/chrome_debug.log" \
"${CHROMIUM_ARGS[@]}"

print_divider "$PURPLE"
echo -e "${YELLOW}${WARN}${NC} ${YELLOW}Chromium session ended${NC}"

if [[ $AUTO_CLEANUP -eq 0 ]]; then
    echo -e "${BLUE}${INFO}${NC} ${BLUE}To clean up temporary profile, run:${NC} ${CYAN}${BOLD}rm -rf '$PROFILE_DIR'${NC}"
fi

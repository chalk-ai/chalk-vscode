#!/bin/bash
LAST_TAG=$(gh release view --json tagName --jq '.tagName')

COLOR_RESET=$'\033[0m'
COLOR_PATCH=$'\033[32m'
COLOR_MINOR=$'\033[33m'
COLOR_MAJOR=$'\033[31m'

should_colorize() {
    [[ -t 2 ]]
}

color_for_bump() {
    local bump="$1"
    case "$bump" in
        patch) echo "$COLOR_PATCH" ;;
        minor) echo "$COLOR_MINOR" ;;
        major) echo "$COLOR_MAJOR" ;;
        *) echo "" ;;
    esac
}

format_bump_tag() {
    local bump="$1"
    local next_tag="$2"
    local prefix="${next_tag%%[0-9]*}"
    local version="${next_tag#"$prefix"}"
    local major=0 minor=0 patch=0
    local color=""

    IFS='.' read -r major minor patch _ <<<"$version"
    major=${major:-0}
    minor=${minor:-0}
    patch=${patch:-0}

    if ! should_colorize; then
        echo "$next_tag"
        return 0
    fi

    color=$(color_for_bump "$bump")
    case "$bump" in
        patch) echo "${prefix}${major}.${minor}.${color}${patch}${COLOR_RESET}" ;;
        minor) echo "${prefix}${major}.${color}${minor}${COLOR_RESET}.${patch}" ;;
        major) echo "${prefix}${color}${major}${COLOR_RESET}.${minor}.${patch}" ;;
        *) echo "$next_tag" ;;
    esac
}

draw_bump_menu() {
    local idx="$1"
    local current_tag="$2"
    local patch_tag="$3"
    local minor_tag="$4"
    local major_tag="$5"
    printf "Current version: %s\n" "$current_tag" >&2
    printf "Select version bump (j/k or up/down or 1-3, Enter to confirm):\n" >&2
    printf "%s 1) patch (%s)\n" "$( [[ "$idx" -eq 0 ]] && echo ">" || echo " " )" "$patch_tag" >&2
    printf "%s 2) minor (%s)\n" "$( [[ "$idx" -eq 1 ]] && echo ">" || echo " " )" "$minor_tag" >&2
    printf "%s 3) major (%s)\n" "$( [[ "$idx" -eq 2 ]] && echo ">" || echo " " )" "$major_tag" >&2
}

clear_bump_menu() {
    for _ in 1 2 3 4 5; do
        printf "\033[1A\033[2K" >&2
    done
}

select_bump() {
    local last_tag="$1"
    local options=("patch" "minor" "major")
    local patch_tag=""
    local minor_tag=""
    local major_tag=""
    local patch_tag_display=""
    local minor_tag_display=""
    local major_tag_display=""
    local idx=0
    local key=""
    local key_rest=""
    local new_idx=0

    patch_tag=$(next_tag_for_bump "patch" "$last_tag") || return 1
    minor_tag=$(next_tag_for_bump "minor" "$last_tag") || return 1
    major_tag=$(next_tag_for_bump "major" "$last_tag") || return 1
    patch_tag_display=$(format_bump_tag "patch" "$patch_tag")
    minor_tag_display=$(format_bump_tag "minor" "$minor_tag")
    major_tag_display=$(format_bump_tag "major" "$major_tag")

    if [[ ! -t 0 ]]; then
        printf "Current version: %s\n" "$last_tag" >&2
        printf "Select version bump: 1) patch (%s) 2) minor (%s) 3) major (%s): " "$patch_tag_display" "$minor_tag_display" "$major_tag_display" >&2
        read -r key
        case "$key" in
            1|patch) echo "patch" ;;
            2|minor) echo "minor" ;;
            3|major) echo "major" ;;
            *) echo "Invalid selection." >&2; return 1 ;;
        esac
        return 0
    fi

    draw_bump_menu "$idx" "$last_tag" "$patch_tag_display" "$minor_tag_display" "$major_tag_display"
    while true; do
        new_idx="$idx"
        IFS= read -rsn1 key
        if [[ "$key" == $'\x1b' ]]; then
            read -rsn2 -t 1 key_rest || true
            key+="$key_rest"
        fi

        case "$key" in
            "") printf "\n" >&2; echo "${options[$idx]}"; return 0 ;;
            1|2|3) printf "\n" >&2; echo "${options[$((key-1))]}"; return 0 ;;
            j|$'\x1b[B'|$'\x1bOB') new_idx=$(( (idx + 1) % 3 )) ;;
            k|$'\x1b[A'|$'\x1bOA') new_idx=$(( (idx + 2) % 3 )) ;;
        esac

        if [[ "$new_idx" -ne "$idx" ]]; then
            idx="$new_idx"
            clear_bump_menu
            draw_bump_menu "$idx" "$last_tag" "$patch_tag_display" "$minor_tag_display" "$major_tag_display"
        else
            continue
        fi
    done
}

next_tag_for_bump() {
    local bump="$1"
    local last_tag="$2"
    local prefix="${last_tag%%[0-9]*}"
    local version="${last_tag#"$prefix"}"
    local major=0 minor=0 patch=0

    IFS='.' read -r major minor patch _ <<<"$version"
    major=${major:-0}
    minor=${minor:-0}
    patch=${patch:-0}

    case "$bump" in
        patch) patch=$((patch + 1)) ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        major) major=$((major + 1)); minor=0; patch=0 ;;
        *) echo "Unknown bump type: $bump" >&2; return 1 ;;
    esac

    echo "${prefix}${major}.${minor}.${patch}"
}

if ! BUMP_TYPE=$(select_bump "${LAST_TAG}"); then
    exit 1
fi
NEXT_TAG=$(next_tag_for_bump "${BUMP_TYPE}" "${LAST_TAG}")
echo "Bumping from ${LAST_TAG} -> ${NEXT_TAG}"

confirm() {
    # call with a prompt string or use a default
    read -r -p "${1:-Are you sure? [y/N]} " response
    case "$response" in
        [yY][eE][sS]|[yY])
            true
            ;;
        *)
            false
            ;;
    esac
}
confirm "Submit to GitHub (y/N)?" && echo "Submitting..." && gh release create "${NEXT_TAG}" --generate-notes

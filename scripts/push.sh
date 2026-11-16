#!/bin/sh
# Push to GitHub as the personal account (dasAbhijit), even when the shell's GITHUB_TOKEN belongs to another account.
set -e
T=$(env -u GITHUB_TOKEN gh auth token -u dasAbhijit)
git push "https://x-access-token:${T}@github.com/dasAbhijit/jhapi.git" "${1:-main}" 2>&1 | sed "s/${T}/***/g"
git fetch -q "https://x-access-token:${T}@github.com/dasAbhijit/jhapi.git" "${1:-main}:refs/remotes/origin/${1:-main}"

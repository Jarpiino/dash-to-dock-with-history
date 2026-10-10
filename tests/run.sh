#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
export XDG_DATA_HOME="$test_root/data"
export XDG_CONFIG_HOME="$test_root/config"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"
gjs -m tests/recentItems.js "$@"
node --experimental-vm-modules tests/recentItemsMenu.mjs

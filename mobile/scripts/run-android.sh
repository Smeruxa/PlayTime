#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
exec node node_modules/@react-native-community/cli/build/bin.js run-android "$@"

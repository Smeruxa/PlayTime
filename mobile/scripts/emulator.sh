#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
exec "$ANDROID_HOME/emulator/emulator" -avd PlayTime_API36 -no-snapshot -no-boot-anim "$@"

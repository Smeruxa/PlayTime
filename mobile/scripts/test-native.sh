#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
native_test_abi="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
if [[ "$native_test_abi" != arm64-v8a && "$native_test_abi" != x86_64 ]]; then
    printf 'Unsupported connected test ABI: %s\n' "$native_test_abi" >&2
    exit 1
fi
exec bash scripts/android.sh :app:connectedDebugAndroidTest \
    "-PreactNativeArchitectures=$native_test_abi" \
    '-PplaytimeApiBase=http://10.0.2.2:1502/playtime' \
    '-PplaytimeSocketUrl=http://10.0.2.2:1502' "$@"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh

playtime_signing_count=0
for playtime_name in PLAYTIME_ANDROID_KEYSTORE PLAYTIME_ANDROID_STORE_PASSWORD PLAYTIME_ANDROID_KEY_ALIAS PLAYTIME_ANDROID_KEY_PASSWORD; do
    if [[ -n "${!playtime_name:-}" ]]; then
        playtime_signing_count=$((playtime_signing_count + 1))
    fi
done
if [[ "$playtime_signing_count" != 0 && "$playtime_signing_count" != 4 ]]; then
    echo 'Set all four PLAYTIME_ANDROID signing variables, or leave all unset for unsigned artifacts.' >&2
    exit 1
fi

node scripts/patch-webrtc.cjs
bash scripts/android.sh :app:assembleRelease :app:bundleRelease :app:lintRelease \
    -PreactNativeArchitectures=arm64-v8a,x86_64 --console=plain
python3 scripts/verify-release.py

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
mkdir -p "$playtime_tools/sdk/cmdline-tools" "$playtime_tools/user" "$playtime_tools/avd"
if [[ ! -x "$playtime_tools/sdk/cmdline-tools/latest/bin/sdkmanager" ]]; then
    sdk_os=linux
    if [[ "$(uname -s)" == Darwin ]]; then sdk_os=mac; fi
    archive="$playtime_tools/commandline.zip"
    curl --fail --location --retry 3 "https://dl.google.com/android/repository/commandlinetools-${sdk_os}-13114758_latest.zip" --output "$archive"
    unzip -q "$archive" -d "$playtime_tools/sdk/cmdline-tools"
    mv "$playtime_tools/sdk/cmdline-tools/cmdline-tools" "$playtime_tools/sdk/cmdline-tools/latest"
    rm "$archive"
fi
export ANDROID_HOME="$playtime_tools/sdk"
export ANDROID_USER_HOME="$playtime_tools/user"
export ANDROID_AVD_HOME="$playtime_tools/avd"
sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
"$sdkmanager" --sdk_root="$ANDROID_HOME" --licenses
"$sdkmanager" --sdk_root="$ANDROID_HOME" \
    'platform-tools' 'platforms;android-37.0' 'build-tools;37.0.0' 'build-tools;36.0.0' \
    'ndk;27.1.12297006' 'cmake;3.22.1' 'emulator'
if [[ "$(uname -m)" == arm64 || "$(uname -m)" == aarch64 ]]; then
    image_abi=arm64-v8a
else
    image_abi=x86_64
fi
"$sdkmanager" --sdk_root="$ANDROID_HOME" "system-images;android-36;google_apis;$image_abi"
if [[ ! -f "$ANDROID_AVD_HOME/PlayTime_API36.ini" ]]; then
    echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
        --name PlayTime_API36 --package "system-images;android-36;google_apis;$image_abi" \
        --device pixel_7 --path "$ANDROID_AVD_HOME/PlayTime_API36.avd"
fi
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

#!/usr/bin/env bash
playtime_tools="${PLAYTIME_ANDROID_TOOLS:-/tmp/playtime-android-tools}"
if [[ -z "${JAVA_HOME:-}" && -d '/Applications/Android Studio.app/Contents/jbr/Contents/Home' ]]; then
    export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
    if [[ -d "$HOME/Library/Android/sdk" ]]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    elif [[ -d "$playtime_tools/sdk" ]]; then
        export ANDROID_HOME="$playtime_tools/sdk"
    fi
fi
if [[ -n "${ANDROID_HOME:-}" ]]; then
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$playtime_tools/gradle}"
if [[ "${ANDROID_HOME:-}" == "$playtime_tools/sdk" ]]; then
    export ANDROID_USER_HOME="$playtime_tools/user"
    export ANDROID_AVD_HOME="$playtime_tools/avd"
fi

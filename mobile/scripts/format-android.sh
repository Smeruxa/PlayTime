#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
formatter="${KTFMT_JAR:-/tmp/playtime-android-tools/ktfmt.jar}"
java_bin="${JAVA_HOME:+$JAVA_HOME/bin/}java"
if [[ -z "${JAVA_HOME:-}" && -x '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java' ]]; then
    java_bin='/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java'
fi
if [[ ! -f "$formatter" ]]; then
    mkdir -p "$(dirname "$formatter")"
    curl --fail --location --retry 3 \
        https://repo.maven.apache.org/maven2/com/facebook/ktfmt/0.64/ktfmt-0.64-with-dependencies.jar \
        --output "$formatter"
fi
args=(--kotlinlang-style)
if [[ "${1:-}" == '--check' ]]; then
    args+=(--dry-run --set-exit-if-changed)
fi
files=()
while IFS= read -r -d '' file; do
    files+=("$file")
done < <(rg --files android/app/src -g '*.kt' -0)
exec "$java_bin" -jar "$formatter" "${args[@]}" "${files[@]}"

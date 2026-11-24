#!/usr/bin/env python3
"""Validate and archive actual release outputs; never sign, upload or install them."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "android/app/build"
OUTPUT = ROOT / "release/rustore/artifacts"
EXPECTED_PERMISSIONS = {
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.BLUETOOTH",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.VIBRATE",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.WAKE_LOCK",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "com.playtimemobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
}
EXPECTED_ABIS = {"arm64-v8a", "x86_64"}
RELEASE_CERTIFICATE_SHA256 = "f669c6af50fff7f5b392c04eaff7491b70c9189c10655ea5d2e646279d42eb57"


def run(*arguments: str) -> str:
    return subprocess.check_output(arguments, text=True, stderr=subprocess.STDOUT)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def elf_alignment(data: bytes) -> int:
    require(data[:4] == b"\x7fELF" and data[4] == 2, "Expected 64-bit ELF library")
    endian = "<" if data[5] == 1 else ">"
    offset = struct.unpack_from(endian + "Q", data, 32)[0]
    entry_size, count = struct.unpack_from(endian + "HH", data, 54)
    alignments = []
    for index in range(count):
        position = offset + index * entry_size
        if struct.unpack_from(endian + "I", data, position)[0] != 1:
            continue
        file_offset, virtual_address = struct.unpack_from(endian + "QQ", data, position + 8)
        alignment = struct.unpack_from(endian + "Q", data, position + 48)[0]
        require((virtual_address - file_offset) % 16384 == 0, "ELF segment is not 16 KB compatible")
        alignments.append(alignment)
    require(bool(alignments) and min(alignments) >= 16384, "ELF alignment is below 16 KB")
    return min(alignments)


def verify_archive(path: Path, prefix: str) -> dict:
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, f"Corrupt ZIP: {path.name}")
        dex_files = [name for name in archive.namelist() if name.endswith(".dex")]
        require(bool(dex_files), "Missing Android DEX code")
        for name in dex_files:
            dex = archive.read(name)
            require(not any(marker in dex for marker in
                            (b"PlayTimePushProbe", b"PlayTimePushSdkProbe")),
                    f"Temporary Push diagnostic tag remains in {path.name}:{name}")
        bundle = archive.read(prefix + "assets/index.android.bundle")
        require(len(bundle) > 100_000, "Missing embedded JavaScript bundle")
        require(bundle[:8] == bytes.fromhex("c61fbc03c103191f"), "Expected Hermes release bytecode")
        libraries = {}
        abis = set()
        for name in archive.namelist():
            if not name.startswith(prefix + "lib/") or not name.endswith(".so"):
                continue
            abis.add(name[len(prefix):].split("/")[1])
            libraries[name] = elf_alignment(archive.read(name))
        require(abis == EXPECTED_ABIS, f"Unexpected ABIs: {abis}")
        require(path.stat().st_size < 5_000_000_000, "Artifact exceeds RuStore 5 GB limit")
        return {"abis": sorted(abis), "nativeLibraries": len(libraries), "elfAlignment": 16384,
                "embeddedHermesBytes": len(bundle)}


def main() -> None:
    metadata = json.loads((BUILD / "outputs/apk/release/output-metadata.json").read_text())
    element = metadata["elements"][0]
    apk = BUILD / "outputs/apk/release" / element["outputFile"]
    aab = BUILD / "outputs/bundle/release/app-release.aab"
    version = element["versionName"]
    require(re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", version) is not None, "Unexpected version format")
    require(metadata["applicationId"] == "com.playtimemobile", "Wrong package")
    sdk = Path(os.environ["ANDROID_HOME"])
    tools_version = re.search(r'buildToolsVersion = "([^"]+)"',
                              (ROOT / "android/build.gradle").read_text()).group(1)
    tools = sdk / "build-tools" / tools_version
    badging = run(str(tools / "aapt2"), "dump", "badging", str(apk))
    min_sdk_match = re.search(r"^(?:minSdkVersion|sdkVersion):'([0-9]+)'", badging, re.MULTILINE)
    target_sdk_match = re.search(r"^targetSdkVersion:'([0-9]+)'", badging, re.MULTILINE)
    require(min_sdk_match is not None and target_sdk_match is not None, "Missing binary manifest SDK versions")
    min_sdk, target_sdk = int(min_sdk_match.group(1)), int(target_sdk_match.group(1))
    require(min_sdk == 24 and target_sdk == 36, "Unexpected binary manifest SDK versions")
    tree = run(str(tools / "aapt2"), "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk))
    require(re.search(r":usesCleartextTraffic\([^)]*\)=false", tree) is not None,
            "Release allows cleartext traffic")
    require(re.search(r":debuggable\([^)]*\)=true", tree) is None, "Release is debuggable")
    require(re.search(r":allowBackup\([^)]*\)=false", tree) is not None, "OS backup is enabled")
    permissions_output = run(str(tools / "aapt2"), "dump", "permissions", str(apk))
    permissions = set(re.findall(r"uses-permission: name='([^']+)'", permissions_output))
    require(permissions == EXPECTED_PERMISSIONS, f"Unexpected permissions: {permissions ^ EXPECTED_PERMISSIONS}")
    config = (BUILD / "generated/source/buildConfig/release/com/playtimemobile/BuildConfig.java").read_text()
    require('boolean DEBUG = false;' in config, "Development runtime is enabled")
    require('API_BASE = "https://playtime.smeruxa.ru/playtime";' in config, "Wrong production API")
    require('SOCKET_URL = "https://playtime.smeruxa.ru";' in config, "Wrong production socket endpoint")
    push_project_match = re.search(r'RUSTORE_PROJECT_ID = "([a-zA-Z0-9_-]*)";', config)
    require(push_project_match is not None, "Missing RuStore Push project configuration")
    push_project_id = push_project_match.group(1)
    public_properties = (ROOT / "android/gradle.properties").read_text()
    public_push_match = re.search(r"^playtimeRustoreProjectId=([a-zA-Z0-9_-]*)$",
                                  public_properties, re.MULTILINE)
    require(public_push_match is not None, "Missing public RuStore Push default")
    expected_push_project = os.environ.get("PLAYTIME_RUSTORE_PROJECT_ID", public_push_match.group(1))
    require(push_project_id == expected_push_project,
            "Wrong RuStore Push project ID")
    run(str(tools / "zipalign"), "-c", "-P", "16", "4", str(apk))
    signature = subprocess.run([str(tools / "apksigner"), "verify", "--print-certs", str(apk)],
                               capture_output=True, text=True)
    signed = signature.returncode == 0
    require(signed == bool(os.environ.get("PLAYTIME_ANDROID_KEYSTORE")), "Unexpected signing state")
    signer_sha256 = None
    if signed:
        require("CN=Android Debug" not in signature.stdout, "Development key is not a store key")
        digest = re.search(r"certificate SHA-256 digest: ([0-9a-fA-F]{64})", signature.stdout)
        require(digest is not None, "Missing signer certificate digest")
        signer_sha256 = digest.group(1).lower()
        require(signer_sha256 == RELEASE_CERTIFICATE_SHA256, "APK certificate does not match the published PlayTime app")
        bundle_signature = run(str(Path(os.environ["JAVA_HOME"]) / "bin/jarsigner"),
                               "-J-Duser.language=en", "-verify", str(aab))
        require("jar verified." in bundle_signature, "Android App Bundle signature verification failed")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    artifacts = []
    for source, prefix in [(apk, ""), (aab, "base/")]:
        verification = verify_archive(source, prefix)
        destination = OUTPUT / f"PlayTime-{version}{'' if signed else '-unsigned'}{source.suffix}"
        shutil.copy2(source, destination)
        artifacts.append({"file": destination.name, "bytes": source.stat().st_size,
                          "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), **verification})
    report = {"package": "com.playtimemobile", "versionName": version,
              "versionCode": element["versionCode"], "minSdk": min_sdk, "targetSdk": target_sdk,
              "signed": signed, "signerCertificateSha256": signer_sha256, "uploadReady": False,
              "remaining": "Final acceptance, configured push delivery and owner publication approval remain separate.",
              "debuggable": False, "cleartext": False, "osBackup": False,
              "apiBase": "https://playtime.smeruxa.ru/playtime", "socketUrl": "https://playtime.smeruxa.ru",
              "rustorePushProjectId": push_project_id,
              "rustorePushProjectConfigured": bool(push_project_id),
              "pushDiagnostics": False,
              "permissions": sorted(permissions), "artifacts": artifacts}
    (OUTPUT / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=4) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=4))


if __name__ == "__main__":
    main()

from __future__ import annotations

from contextlib import contextmanager
import fcntl
from ipaddress import IPv4Address
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
from typing import BinaryIO, Iterator

from common import AGE_HEADER, ARCHIVE_LIMIT, BACKUPS, EXPORT_COMMAND, FILES, FORMAT_VERSION, METADATA, SETTINGS, SNAPSHOT_NAME
from common import protected_directory, sha256, utc_now


def config() -> dict:
    profile = json.loads((SETTINGS / "pull.json").read_text())
    host = IPv4Address(profile["primary_host"])
    if not host.is_private or host.is_loopback or host.is_unspecified:
        raise ValueError("The backup source must be the primary WireGuard address")
    if not re.fullmatch(r"postgres@sha256:[a-f0-9]{64}", profile["restore_image"]):
        raise ValueError("Expected a digest-pinned PostgreSQL restore image")
    if not isinstance(profile["retain"], int) or not 2 <= profile["retain"] <= 7:
        raise ValueError("Retain between two and seven validated snapshots")
    return profile


def copy_member(source: BinaryIO, target: Path, size: int) -> None:
    with target.open("xb") as out:
        remaining = size
        while remaining:
            data = source.read(min(remaining, 1024 * 1024))
            if not data:
                raise ValueError("Truncated backup archive member")
            out.write(data)
            remaining -= len(data)
        out.flush()
        os.fsync(out.fileno())


def receive(source: BinaryIO, stage: Path) -> None:
    names: set[str] = set()
    allowance = ARCHIVE_LIMIT
    with tarfile.open(fileobj=source, mode="r|") as archive:
        for item in archive:
            maximum = 16 * 1024 if item.name == METADATA else allowance
            if (
                item.name not in (*FILES, METADATA) or item.name in names
                or not item.isfile() or not 0 < item.size <= min(maximum, allowance)
            ):
                raise ValueError("Backup stream contains an unexpected or oversized file")
            stream = archive.extractfile(item)
            if stream is None:
                raise ValueError("Unreadable backup archive member")
            with stream:
                copy_member(stream, stage / item.name, item.size)
            names.add(item.name)
            allowance -= item.size
    if names != {*FILES, METADATA}:
        raise ValueError("Backup stream is incomplete")


def verify_files(stage: Path) -> None:
    data = json.loads((stage / METADATA).read_text())
    if data["version"] != FORMAT_VERSION or set(data["files"]) != set(FILES):
        raise ValueError("Unexpected recovery archive manifest")
    for name in FILES:
        path = stage / name
        record = data["files"][name]
        if path.is_symlink() or path.stat().st_size != record["bytes"] or sha256(path) != record["sha256"]:
            raise ValueError("Backup checksum mismatch")
        with path.open("rb") as encrypted:
            if encrypted.readline(len(AGE_HEADER)) != AGE_HEADER:
                raise ValueError(f"Backup member {name} is not age encrypted")


def committed_snapshots() -> list[Path]:
    return sorted(
        item for item in BACKUPS.iterdir()
        if SNAPSHOT_NAME.fullmatch(item.name) and item.is_dir() and not item.is_symlink()
    )


@contextmanager
def pull_lock() -> Iterator[None]:
    descriptor = os.open(BACKUPS / ".lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def pull(profile: dict, stage: Path) -> None:
    settings = [
        "-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", f"UserKnownHostsFile={SETTINGS / 'known-hosts'}",
        "-o", "HostKeyAlias=playtime-primary-backup", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2", "-i", str(SETTINGS / "pull-key"),
    ]
    with subprocess.Popen(
        ["ssh", *settings, f"root@{profile['primary_host']}", EXPORT_COMMAND],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
    ) as process:
        try:
            receive(process.stdout, stage)
        except BaseException:
            process.terminate()
            raise
        finally:
            process.stdout.close()
        if process.wait():
            raise RuntimeError("The primary did not finish the backup stream")


def main() -> None:
    os.umask(0o077)
    protected_directory(BACKUPS)
    profile = config()
    with pull_lock():
        if shutil.disk_usage(BACKUPS).free < 2 * ARCHIVE_LIMIT:
            raise RuntimeError("Insufficient free space for a recovery snapshot")
        with tempfile.TemporaryDirectory(prefix=".pending-", dir=BACKUPS) as temporary:
            stage = Path(temporary)
            pull(profile, stage)
            verify_files(stage)
            name = "snapshot-" + utc_now().strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)
            destination = BACKUPS / name
            stage.rename(destination)
            descriptor = os.open(BACKUPS, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        snapshots = committed_snapshots()
        for old in snapshots[:-profile["retain"]]:
            shutil.rmtree(old)
        print(f"Validated backup {name}; {min(len(snapshots), profile['retain'])} retained.", flush=True)


if __name__ == "__main__":
    main()

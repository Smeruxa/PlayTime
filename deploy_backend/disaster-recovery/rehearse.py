from __future__ import annotations

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import time
from typing import Iterator

from common import PG_DUMP, BACKUPS, protected_directory
from pull import committed_snapshots, config, pull_lock, verify_files


@contextmanager
def test_server(image: str) -> Iterator[str]:
    name = "playtime-dr-rehearsal-" + secrets.token_hex(6)
    subprocess.run(
        ["docker", "run", "--rm", "-d", "--pull", "never", "--network", "none",
         "--name", name, "--memory", "256m", "--cpus", "0.5",
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=playtime_rehearsal",
         image, "postgres", "-c", "listen_addresses=", "-c", "shared_buffers=24MB",
         "-c", "max_connections=8", "-c", "fsync=off"],
        stdout=subprocess.DEVNULL, check=True,
    )
    try:
        for _ in range(40):
            attempt = subprocess.run(
                ["docker", "exec", name, "pg_isready", "-q", "-U", "postgres", "-d", "playtime_rehearsal"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if attempt.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("The isolated restore server did not start")
        yield name
    finally:
        subprocess.run(["docker", "stop", "--time", "10", name], stdout=subprocess.DEVNULL, check=True)


def restore_postgres(snapshot: Path, identity: Path, container: str) -> None:
    command = ["age", "--decrypt", "--identity", str(identity), str(snapshot / PG_DUMP)]
    with subprocess.Popen(command, stdout=subprocess.PIPE) as decryption:
        try:
            subprocess.run(
                ["docker", "exec", "-i", container, "pg_restore", "--exit-on-error", "--single-transaction", "--no-owner",
                 "--no-privileges", "-U", "postgres", "-d", "playtime_rehearsal"],
                stdin=decryption.stdout, stdout=subprocess.DEVNULL, check=True,
            )
            for _ in iter(lambda: decryption.stdout.read(1024 * 1024), b""):
                pass
        finally:
            decryption.stdout.close()
        if decryption.wait():
            raise RuntimeError("Database snapshot decryption failed")


def rehearse(snapshot: Path, image: str, identity: Path) -> None:
    verify_files(snapshot)
    with test_server(image) as container:
        restore_postgres(snapshot, identity, container)
        proof = subprocess.check_output(
            ["docker", "exec", container, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1",
             "-U", "postgres", "-d", "playtime_rehearsal", "-c",
             "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S'); "
             "SELECT count(*) FROM schema_migrations; SELECT count(*) FROM app_releases;"],
            text=True,
        ).split()
        tables, migrations, releases = map(int, proof)
        if not (tables >= 48 and migrations >= 35 and releases > 0):
            raise RuntimeError("Snapshot proof failed")
        print(f"Restored {tables} tables/sequences, {migrations} migrations, and {releases} release records.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore a PlayTime backup in an isolated local PostgreSQL 18 container")
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--restore-image")
    args = parser.parse_args()
    current = args.identity.lstat()
    if not stat.S_ISREG(current.st_mode) or current.st_uid != os.geteuid() or stat.S_IMODE(current.st_mode) != 0o600:
        parser.error("the age identity must be an owned regular file with mode 0600")
    os.umask(0o077)
    if args.snapshot or args.restore_image:
        if not args.snapshot or not re.fullmatch(r"postgres@sha256:[a-f0-9]{64}", args.restore_image or ""):
            parser.error("--snapshot requires --restore-image with a digest-pinned PostgreSQL 18 image")
        rehearse(args.snapshot, args.restore_image, args.identity)
        return
    protected_directory(BACKUPS)
    profile = config()
    with pull_lock():
        snapshots = committed_snapshots()
        if not snapshots:
            raise RuntimeError("No validated snapshots are available")
        rehearse(snapshots[-1], profile["restore_image"], args.identity)


if __name__ == "__main__":
    main()

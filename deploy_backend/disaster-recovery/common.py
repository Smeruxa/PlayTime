from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import stat


SETTINGS = Path("/etc/playtime-disaster-recovery")
BACKUPS = Path("/var/backups/playtime-dr")
PG_DUMP = "playtime.dump.age"
RECOVERY = "recovery.tar.age"
METADATA = "manifest.json"
FORMAT_VERSION = 2
EXPORT_COMMAND = "playtime-dr-v2"
AGE_HEADER = b"age-encryption.org/v1\n"
ARCHIVE_LIMIT = 1024 ** 3
FILES = (PG_DUMP, RECOVERY)
SNAPSHOT_NAME = re.compile(r"^snapshot-\d{8}T\d{6}Z-[a-f0-9]{8}$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def protected_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    current = path.lstat()
    if not stat.S_ISDIR(current.st_mode) or current.st_uid != os.geteuid() or stat.S_IMODE(current.st_mode) != 0o700:
        raise PermissionError(f"Expected an owner-only directory: {path}")

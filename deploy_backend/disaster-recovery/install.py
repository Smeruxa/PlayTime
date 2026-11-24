from __future__ import annotations

import argparse
from ipaddress import IPv4Address
import io
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tarfile
from urllib.parse import urlsplit

from common import SETTINGS


HERE = Path(__file__).resolve().parent
LIB = Path("/usr/local/lib/playtime-disaster-recovery")
UNITS = Path("/etc/systemd/system")
PROJECT = HERE.parent
sys.path.insert(0, str(PROJECT))
from cluster import load_profile, ssh_command


def ssh(client: list[str], command: str, data: bytes | None = None) -> str:
    return subprocess.check_output([*client, command], input=data).decode().strip()


def install_files(client: list[str], files: dict[Path, bytes]) -> None:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for index, contents in enumerate(files.values()):
            entry = tarfile.TarInfo(str(index))
            entry.mode = 0o600
            entry.size = len(contents)
            archive.addfile(entry, io.BytesIO(contents))
    commands = [
        "set -eu",
        "umask 077",
        'test "$(id -u)" = 0',
        'work=$(mktemp -d)',
        'trap \'rm -rf -- "$work"\' EXIT',
        'cd "$work"',
        "tar -xzf -",
        f"install -d -m 700 {LIB} {SETTINGS}",
    ]
    for index, path in enumerate(files):
        mode = "644" if path.parent == UNITS else "600"
        commands.append(f"install -m {mode} {index} {shlex.quote(str(path))}")
    ssh(client, " && ".join(commands), buffer.getvalue())


def wireguard_addresses(primary: list[str]) -> dict[str, str]:
    result = ssh(primary, "k3s kubectl get nodes -l playtime.io/node -o json")
    addresses = {}
    for node in json.loads(result)["items"]:
        role = node["metadata"]["labels"]["playtime.io/node"]
        target = IPv4Address(next(x["address"] for x in node["status"]["addresses"] if x["type"] == "InternalIP"))
        if role in addresses or not target.is_private or target.is_loopback or target.is_unspecified:
            raise ValueError("Expected two distinct private node addresses")
        addresses[role] = str(target)
    if set(addresses) != {"primary", "secondary"} or len(set(addresses.values())) != 2:
        raise ValueError("PlayTime primary and secondary nodes are required")
    return addresses


def native_age_recipient(identity: Path, keygen: str) -> str:
    current = identity.lstat()
    if not stat.S_ISREG(current.st_mode) or current.st_uid != os.geteuid() or stat.S_IMODE(current.st_mode) != 0o600:
        raise PermissionError("The age identity must be an owned regular file with mode 0600")
    value = subprocess.check_output([keygen, "-y", str(identity)], text=True).strip()
    if not re.fullmatch(r"age1[a-z0-9]{40,80}", value):
        raise ValueError("A native age public recipient is required")
    return value


def parse_key(data: str) -> str:
    parts = data.split()
    if len(parts) < 2 or parts[0] != "ssh-ed25519" or not re.fullmatch(r"[A-Za-z0-9+/]+=*", parts[1]):
        raise ValueError("Expected an Ed25519 public key")
    return " ".join(parts[:2])


def secondary_pull_identity(client: list[str]) -> str:
    key = SETTINGS / "pull-key"
    command = (
        f"umask 077; install -d -m 700 {SETTINGS} && "
        f"{{ test -f {key} || ssh-keygen -q -t ed25519 -N '' -f {key}; }} && "
        f'test "$(stat -c %a {key})" = 600 && cat {key}.pub'
    )
    return parse_key(ssh(client, command))


def grant_read_only_export(primary: list[str], public: str, source: str) -> None:
    line = (
        f'from="{source}",restrict,command="/usr/bin/python3 -BEs {LIB / "export.py"}" '
        + public + " playtime-disaster-recovery"
    )
    command = (
        "umask 077; install -d -m 700 /root/.ssh && "
        "IFS= read -r line && "
        '{ grep -Fqx -- "$line" /root/.ssh/authorized_keys || printf "%s\\n" "$line" >> /root/.ssh/authorized_keys; }'
    )
    ssh(primary, command, (line + "\n").encode())


def main() -> None:
    parser = argparse.ArgumentParser(description="Install verified logical backup and encrypted recovery configuration")
    parser.add_argument("--profile", type=Path, default=PROJECT / ".secrets/cluster.json")
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--age-keygen", default="age-keygen")
    parser.add_argument("--restore-image", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"postgres@sha256:[a-f0-9]{64}", args.restore_image):
        parser.error("--restore-image requires the pinned PostgreSQL 18 Docker image digest")
    recipient = native_age_recipient(args.identity, args.age_keygen)
    profile = load_profile(args.profile)
    primary, secondary = (ssh_command(profile, role) for role in ("primary", "secondary"))
    addresses = wireguard_addresses(primary)
    hostname = urlsplit(profile["web_origin"]).hostname
    ssh(primary, "command -v age >/dev/null && test -x /usr/lib/postgresql/18/bin/pg_dump")
    version = ssh(
        secondary, shlex.join(
            ["docker", "run", "--rm", "--pull", "never", "--network", "none", "--entrypoint", "pg_restore",
             args.restore_image, "--version"]
        )
    )
    if not version.startswith("pg_restore (PostgreSQL) 18."):
        raise RuntimeError("The restore image must use PostgreSQL 18 tools")
    host_key = parse_key(ssh(primary, "cat /etc/ssh/ssh_host_ed25519_key.pub"))
    pull_key = secondary_pull_identity(secondary)
    export_config = json.dumps({"age_recipient": recipient, "tls_hostname": hostname})
    pull_config = json.dumps({
        "primary_host": addresses["primary"], "restore_image": args.restore_image, "retain": 7,
    })
    install_files(primary, {
        LIB / "common.py": (HERE / "common.py").read_bytes(),
        LIB / "export.py": (HERE / "export.py").read_bytes(),
        SETTINGS / "export.json": export_config.encode(),
    })
    install_files(secondary, {
        **{LIB / name: (HERE / name).read_bytes() for name in ("common.py", "pull.py", "rehearse.py")},
        **{UNITS / name: (HERE / name).read_bytes() for name in (
            "playtime-disaster-recovery.service", "playtime-disaster-recovery.timer",
        )},
        SETTINGS / "pull.json": pull_config.encode(),
        SETTINGS / "known-hosts": f"playtime-primary-backup {host_key}\n".encode(),
    })
    grant_read_only_export(primary, pull_key, addresses["secondary"])
    ssh(secondary, "systemctl daemon-reload")
    print("Backup installed. Run the service and complete the restore and decryption checks before enabling its timer.")


if __name__ == "__main__":
    main()

from __future__ import annotations

from contextlib import closing, contextmanager
import fcntl
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from typing import Iterator

from common import EXPORT_COMMAND, FILES, FORMAT_VERSION, METADATA, PG_DUMP, RECOVERY, SETTINGS, sha256, utc_now


CLUSTER = Path("/etc/playtime-cluster")
K3S_SERVER = Path("/var/lib/rancher/k3s/server")
K3S_DATABASE = K3S_SERVER / "db/state.db"
PG_BIN = Path("/usr/lib/postgresql/18/bin")
REQUIRED_CONFIG = (
    Path("/etc/rancher/k3s/config.yaml"),
    Path("/etc/wireguard/ptwg0.conf"),
    CLUSTER / "data",
    CLUSTER / "service-identities.json",
    K3S_SERVER / "token",
)
OPTIONAL_CONFIG = (
    Path("/etc/rancher/k3s/config.yaml.d"),
    Path("/etc/rancher/k3s/registries.yaml"),
    Path("/etc/systemd/system/k3s.service"),
    Path("/etc/systemd/system/playtime-data-firewall.service"),
    Path("/etc/systemd/system/playtime-cluster-guard.service"),
    Path("/etc/systemd/system/redis-playtime@.service"),
    Path("/etc/systemd/system/playtime-kubelet-loopback.service"),
    Path("/etc/systemd/system/playtime-kubelet-loopback.socket"),
    Path("/etc/systemd/system/postgresql@18-main.service.d/playtime.conf"),
    Path("/etc/systemd/system/playtime-gateway-watch.service"),
    Path("/etc/nginx/sites-available/playtime-edge"),
    Path("/etc/nginx/conf.d/playtime-gateway-routing.conf"),
    Path("/etc/nginx/conf.d/playtime-gateway-probes.conf"),
    Path("/etc/letsencrypt/renewal-hooks/deploy/playtime-edge"),
    Path("/etc/exports.d/playtime-releases.exports"),
    Path("/etc/turnserver.conf"),
    Path("/etc/postgresql/18/main/conf.d/70-playtime.conf"),
    Path("/etc/postgresql/18/main/pg_hba.conf"),
    Path("/etc/redis/playtime-main.conf"),
    Path("/etc/redis/playtime-admin.conf"),
    Path("/usr/local/sbin/playtime-data-firewall"),
    CLUSTER / "gateway-watch",
    CLUSTER / "network-guard",
    CLUSTER / "nfs-guard.sh",
    K3S_SERVER / "cred/encryption-config.json",
    K3S_SERVER / "cred/encryption-state.json",
    Path("/srv/playtime-cluster/media"),
)


def kubernetes_config() -> list[dict]:
    commands = [
        ["-n", "playtime", "get", "configmaps,secrets,statefulsets,deployments,services,networkpolicies,persistentvolumeclaims,serviceaccounts"],
        ["get", "persistentvolumes"],
    ]
    resources = []
    for command in commands:
        result = subprocess.check_output(["k3s", "kubectl", "--request-timeout=20s", *command, "-o", "json"])
        for item in json.loads(result)["items"]:
            meta = item["metadata"]
            if not meta["name"].startswith("playtime-"):
                continue
            item.pop("status", None)
            item["metadata"] = {key: meta[key] for key in ("name", "namespace", "labels") if key in meta}
            annotations = meta.get("annotations", {})
            clean = {key: value for key, value in annotations.items() if not key.startswith("kubectl.kubernetes.io/")}
            if clean:
                item["metadata"]["annotations"] = clean
            resources.append(item)
    kinds = {item["kind"] for item in resources}
    if not {"ConfigMap", "Secret", "StatefulSet", "PersistentVolume", "PersistentVolumeClaim"}.issubset(kinds):
        raise RuntimeError("The live PlayTime Kubernetes configuration is incomplete")
    secrets = {item["metadata"]["name"] for item in resources if item["kind"] == "Secret" and item.get("data")}
    if not {f"playtime-{scope}" for scope in ("auth", "chat", "database", "gateway", "redis", "room", "transport")}.issubset(secrets):
        raise RuntimeError("A required PlayTime Kubernetes Secret is missing or empty")
    return resources


def sqlite_snapshot(destination: Path) -> None:
    if not K3S_DATABASE.is_file():
        raise FileNotFoundError("K3s SQLite datastore unavailable")
    with closing(sqlite3.connect(f"{K3S_DATABASE.as_uri()}?mode=ro", uri=True, timeout=5)) as source:
        with closing(sqlite3.connect(destination)) as backup:
            source.backup(backup, pages=128, sleep=0.05)
            if backup.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise RuntimeError("K3s SQLite backup integrity check failed")


def add_file(archive: tarfile.TarFile, file: Path, name: str | None = None) -> None:
    archive.add(file, arcname=name or "rootfs/" + file.as_posix().lstrip("/"))


def add_json(archive: tarfile.TarFile, name: str, content: dict) -> None:
    data = json.dumps(content, separators=(",", ":")).encode()
    meta = tarfile.TarInfo(name)
    meta.mode = 0o600
    meta.size = len(data)
    meta.mtime = int(utc_now().timestamp())
    archive.addfile(meta, io.BytesIO(data))


def certificate_files(hostname: str) -> list[Path]:
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+", hostname):
        raise ValueError("Recovery TLS name must be a hostname")
    certs = Path("/etc/letsencrypt/live") / hostname
    return [certs / name for name in ("cert.pem", "chain.pem", "fullchain.pem", "privkey.pem")]


def validate_certificate(files: list[Path], hostname: str) -> None:
    certificate, _, _, private = files
    name_check = subprocess.check_output(["openssl", "x509", "-in", str(certificate), "-noout", "-checkhost", hostname])
    if not name_check.strip().endswith(b"does match certificate"):
        raise RuntimeError("The PlayTime TLS certificate does not cover the recovery hostname")
    certificate_key = subprocess.check_output(["openssl", "x509", "-in", str(certificate), "-noout", "-pubkey"])
    private_key = subprocess.check_output(["openssl", "pkey", "-in", str(private), "-pubout"])
    if certificate_key != private_key:
        raise RuntimeError("The PlayTime TLS certificate and key do not match")


def encrypt_bundle(stage: Path, recipient: str, hostname: str) -> None:
    sqlite = stage / "state.db"
    sqlite_snapshot(sqlite)
    certificates = certificate_files(hostname)
    files = [*REQUIRED_CONFIG, *certificates]
    if any(not path.exists() for path in files):
        raise RuntimeError("A required PlayTime recovery file is unavailable")
    if len((K3S_SERVER / "token").read_bytes().strip()) < 20:
        raise RuntimeError("The K3s server token is incomplete")
    validate_certificate(certificates, hostname)
    resources = kubernetes_config()
    command = ["age", "--encrypt", "--recipient", recipient, "--output", str(stage / RECOVERY)]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encryption:
        try:
            with tarfile.open(fileobj=encryption.stdin, mode="w|gz", dereference=True) as archive:
                for path in files:
                    add_file(archive, path)
                tls_paths = (Path("/etc/letsencrypt/archive") / hostname, Path("/etc/letsencrypt/renewal") / f"{hostname}.conf")
                for path in (*OPTIONAL_CONFIG, *tls_paths):
                    if path.exists():
                        add_file(archive, path)
                add_file(archive, sqlite, "rootfs/" + K3S_DATABASE.as_posix().lstrip("/"))
                add_json(archive, "kubernetes/playtime.json", {"apiVersion": "v1", "kind": "List", "items": resources})
        finally:
            encryption.stdin.close()
        if encryption.wait():
            raise RuntimeError("Recovery configuration encryption failed")


def encrypt_postgres(stage: Path, recipient: str) -> None:
    with tempfile.TemporaryFile(mode="w+b", dir=stage) as dump:
        subprocess.run(
            ["runuser", "-u", "postgres", "--", str(PG_BIN / "pg_dump"), "-Fc", "--lock-wait-timeout=10s", "playtime"],
            stdout=dump, check=True,
        )
        dump.seek(0)
        subprocess.run([str(PG_BIN / "pg_restore"), "--list"], stdin=dump, stdout=subprocess.DEVNULL, check=True)
        dump.seek(0)
        subprocess.run(
            ["age", "--encrypt", "--recipient", recipient, "--output", str(stage / PG_DUMP)],
            stdin=dump, check=True,
        )


@contextmanager
def release_guard() -> Iterator[None]:
    lock = os.open("/run/lock/playtime-release.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        deadline = time.monotonic() + 90
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("PlayTime release lock stayed busy; retry the backup")
                time.sleep(1)
        yield
    finally:
        os.close(lock)


def main() -> None:
    os.umask(0o077)
    if os.environ.get("SSH_ORIGINAL_COMMAND") != EXPORT_COMMAND:
        raise SystemExit("Only the PlayTime backup stream is supported")
    settings = json.loads((SETTINGS / "export.json").read_text())
    recipient, hostname = settings["age_recipient"], settings["tls_hostname"]
    if not re.fullmatch(r"age1[a-z0-9]{40,80}", recipient):
        raise ValueError("A native age public recipient is required")
    created = utc_now().isoformat()
    with release_guard(), tempfile.TemporaryDirectory(prefix="playtime-dr-export-") as temp:
        stage = Path(temp)
        encrypt_postgres(stage, recipient)
        encrypt_bundle(stage, recipient, hostname)
        files = {name: {"sha256": sha256(stage / name), "bytes": (stage / name).stat().st_size} for name in FILES}
        (stage / METADATA).write_text(json.dumps({"version": FORMAT_VERSION, "created_utc": created, "files": files}) + "\n")
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
            for name in (METADATA, *FILES):
                archive.add(stage / name, arcname=name)


if __name__ == "__main__":
    main()

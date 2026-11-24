import argparse
import contextlib
import gzip
import hashlib
import io
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TARGETS = {"primary": ["database", "auth-api", "chat-api", "room-api", "gateway"], "secondary": ["auth-api"]}


def ssh_command(profile, role):
    host = profile[role]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", host["host"]) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]*", host["user"]):
        raise ValueError("Invalid SSH host or account")
    port = int(host.get("port", 22))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid SSH port")
    return [
        "ssh", "-F", "/dev/null", "-T", "-p", str(port), "-i", profile["ssh_key"],
        "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UpdateHostKeys=no",
        "-o", f'UserKnownHostsFile="{profile["known_hosts"]}"', "-o", f"HostKeyAlias=playtime-{role}",
        "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        host["user"] + "@" + host["host"],
    ]


def load_profile(path):
    profile = json.loads(path.read_text())
    for key in ["ssh_key", "known_hosts"]:
        file = (path.parent / Path(profile[key]).expanduser()).resolve(strict=True)
        profile[key] = str(file)
    for role in TARGETS:
        subprocess.run(["ssh-keygen", "-F", "playtime-" + role, "-f", profile["known_hosts"]], stdout=subprocess.DEVNULL, check=True)
    origin = urlsplit(profile["web_origin"])
    if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
        raise ValueError("web_origin must be a public HTTPS origin")
    return profile


def manifest_archive():
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for name in ["base", "migrations", "two-vps"]:
            for path in sorted((ROOT / "deploy" / "k8s" / name).rglob("*.yaml")):
                tar.add(path, arcname=str(path.relative_to(ROOT / "deploy")))
        tar.add(HERE / "cluster-rollout.py", arcname="rollout.py")
        tar.add(HERE / "gateway_topology.py", arcname="gateway_topology.py")
    return output.getvalue()


def cluster_step(ssh, archive, tag, mode, bootstrap=False):
    args = [tag, mode, *(["bootstrap-domains"] if bootstrap else [])]
    cmd = 'set -eu; umask 077; d=$(mktemp -d); trap \'rm -rf -- "$d"\' EXIT; cd "$d"; tar -xzf -; python3 rollout.py ' + shlex.join(args)
    subprocess.run([*ssh, cmd], input=archive, check=True)


@contextlib.contextmanager
def release_lock(ssh):
    cmd = "flock -n /run/lock/playtime-release.lock sh -c 'echo locked; cat >/dev/null'"
    with subprocess.Popen([*ssh, cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as holder:
        try:
            if holder.stdout.readline() != b"locked\n":
                raise RuntimeError("Another release holds the production lock, or SSH failed")
            yield holder
        finally:
            holder.stdin.close()


def image_names(targets, tag):
    return [f"playtime-{target}:{tag}" for target in targets]


def require_unused_tag(ssh, targets, tag):
    names = " ".join("docker.io/library/" + name for name in image_names(targets, tag))
    cmd = (
        "set -eu; refs=$(k3s ctr -n k8s.io images list -q); "
        f"for name in {names}; do if printf '%s\\n' \"$refs\" | grep -Fxq \"$name\"; "
        "then echo 'Release tag already present' >&2; exit 1; fi; done"
    )
    subprocess.run([*ssh, cmd], check=True)


def prepared_digests(ssh, targets, tag):
    table = subprocess.check_output([*ssh, "k3s ctr -n k8s.io images list"], text=True)
    available = {
        fields[0]: fields[2] for line in table.splitlines()
        if len(fields := line.split()) >= 3
    }
    digests = {}
    for target, image in zip(targets, image_names(targets, tag)):
        qualified = "docker.io/library/" + image
        digest = available.get(qualified, "")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            raise RuntimeError(f"Prepared image is unavailable: {image}")
        info = json.loads(subprocess.check_output([*ssh, f"k3s crictl inspecti {qualified}"]))
        spec = info["info"]["imageSpec"]
        if spec["architecture"] != "amd64" or spec["os"] != "linux":
            raise RuntimeError(f"Unsupported platform for prepared image: {image}")
        digests[target] = digest
    return digests


def ship_images(docker, ssh, targets, tag):
    with tempfile.TemporaryFile() as file:
        with subprocess.Popen([*docker, "save", *image_names(targets, tag)], stdout=subprocess.PIPE) as saved:
            with gzip.GzipFile(fileobj=file, mode="wb", compresslevel=2) as compressed:
                shutil.copyfileobj(saved.stdout, compressed)
            if saved.wait() != 0:
                raise RuntimeError("Image export failed")
        file.seek(0)
        digest = hashlib.sha256()
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
        file.seek(0)
        cmd = (
            'set -euo pipefail; umask 077; f=$(mktemp); trap \'rm -f -- "$f"\' EXIT; cat > "$f"; '
            f'echo "{digest.hexdigest()}  $f" | sha256sum --check --status; '
            'gzip -dc "$f" | k3s ctr -n k8s.io images import -'
        )
        subprocess.run([*ssh, "bash -c " + shlex.quote(cmd)], stdin=file, check=True)


def main():
    parser = argparse.ArgumentParser(description="Publish PlayTime to the two-node Kubernetes cluster")
    parser.add_argument("--dry-run", action="store_true", help="Check node placement, volumes, secrets and server-side manifests")
    parser.add_argument("--domains-only", action="store_true", help="Deploy migrations, Auth, Chat and Room without touching either Gateway")
    parser.add_argument("--bootstrap-domain-replicas", action="store_true", help="Add the first warm replicas before replacing the legacy Chat and Room pods")
    parser.add_argument("--prepared-tag", help="Use already imported images with this immutable release tag")
    parser.add_argument("--profile", type=Path, default=HERE / ".secrets/cluster.json")
    args = parser.parse_args()
    if args.bootstrap_domain_replicas and not args.domains_only:
        parser.error("--bootstrap-domain-replicas requires --domains-only")
    if args.prepared_tag and not re.fullmatch(r"r-[a-f0-9]{24}", args.prepared_tag):
        parser.error("--prepared-tag must be a valid release tag")
    dry_run = args.dry_run or os.environ.get("DEPLOY_DRY_RUN") == "1"
    profile = load_profile(args.profile.resolve())
    clients = {role: ssh_command(profile, role) for role in TARGETS}
    docker = ["docker"] + (["--context", profile["docker_context"]] if profile.get("docker_context") else [])
    if not args.prepared_tag:
        subprocess.run([*docker, "version", "--format", "{{.Server.Version}}"], check=True)
    tag = args.prepared_tag or "r-" + secrets.token_hex(12)
    archive = manifest_archive()
    targets_by_role = {
        role: [target for target in targets if not (args.domains_only and target == "gateway")]
        for role, targets in TARGETS.items() if targets
    }
    mode = "domains-" if args.domains_only else ""
    print(f"Release {tag}. " + ". ".join(
        f"{role}: {', '.join(targets)}" for role, targets in targets_by_role.items()
    ) + ".", flush=True)
    with release_lock(clients["primary"]) as lock:
        digests = {}
        for role, targets in targets_by_role.items():
            if args.prepared_tag:
                available = prepared_digests(clients[role], targets, tag)
                for target, digest in available.items():
                    if digests.setdefault(target, digest) != digest:
                        raise RuntimeError(f"Prepared image differs between nodes: {target}")
            else:
                require_unused_tag(clients[role], targets, tag)
        cluster_step(clients["primary"], archive, tag, mode + "check", args.bootstrap_domain_replicas)
        if dry_run:
            print("Preflight passed. No images or Kubernetes resources changed.")
            return
        if not args.prepared_tag:
            for target in dict.fromkeys(target for targets in targets_by_role.values() for target in targets):
                print(f"Building {target}", flush=True)
                subprocess.run([*docker, "build", "--platform", "linux/amd64", "--target", target,
                                "--build-arg", "WEB_API_ORIGIN=" + profile["web_origin"].rstrip("/"),
                                "-t", f"playtime-{target}:{tag}", "."], cwd=ROOT, check=True)
        for role, targets in targets_by_role.items():
            if args.prepared_tag:
                break
            if lock.poll() is not None:
                raise RuntimeError("Release lock was lost")
            platforms = subprocess.check_output(
                [*docker, "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", *image_names(targets, tag)], text=True
            ).splitlines()
            if platforms != ["linux/amd64"] * len(targets):
                raise RuntimeError("Unexpected image architecture")
            ship_images(docker, clients[role], targets, tag)
        if lock.poll() is not None:
            raise RuntimeError("Release lock was lost")
        cluster_step(clients["primary"], archive, tag, mode + "apply", args.bootstrap_domain_replicas)


if __name__ == "__main__":
    main()

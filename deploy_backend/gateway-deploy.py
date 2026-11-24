import argparse
from contextlib import ExitStack, contextmanager
import io
from ipaddress import IPv4Address
import json
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import tarfile
from typing import Callable, Iterator

from cluster import HERE, ROOT, load_profile, prepared_digests, release_lock, require_unused_tag, ship_images, ssh_command
from gateway_topology import RELEASE_MOUNT, RELEASE_ROOT


ROLES = ("primary", "secondary")
TEMPLATE = "nginx-routing.conf.template"
WATCH_FILES = ("nginx-probes.conf.template", "gateway-watch.service.template")


def archive() -> bytes:
    blob = io.BytesIO()
    deploy = ROOT / "deploy"
    with tarfile.open(fileobj=blob, mode="w:gz") as output:
        for tree in ["base", "two-vps"]:
            for path in sorted((deploy / "k8s" / tree).rglob("*.yaml")):
                output.add(path, arcname=str(path.relative_to(deploy)))
        for script in ["gateway-edge.py", "gateway-apply.py", "gateway_topology.py", "gateway_failover.py"]:
            output.add(HERE / script, arcname=script)
        for name in (TEMPLATE, *WATCH_FILES):
            output.add(deploy / "k8s" / "two-vps" / "rolling" / name, arcname=name)
    return blob.getvalue()


def remote_action(ssh: list[str], bundle: bytes, *args: str, capture: bool = False) -> str:
    command = (
        'set -eu; umask 077; work=$(mktemp -d); trap \'rm -rf -- "$work"\' EXIT; '
        'cd "$work"; tar -xzf -; ' + shlex.join(args)
    )
    output = subprocess.run(
        [*ssh, command], input=bundle, stdout=subprocess.PIPE if capture else None, check=True
    )
    return output.stdout.decode().strip() if capture else ""


@contextmanager
def hold_edge_routing(ssh: list[str]) -> Iterator[subprocess.Popen]:
    command = (
        "timeout 40m flock -x -w 25 /run/lock/playtime-gateway-rollout.lock "
        "sh -c 'echo held; cat >/dev/null'"
    )
    with subprocess.Popen([*ssh, command], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as holder:
        try:
            if holder.stdout.readline() != b"held\n":
                raise RuntimeError("Could not pause automatic Gateway switching for this release")
            yield holder
        finally:
            holder.stdin.close()


def require_routing_locks(release: subprocess.Popen, edges: list[subprocess.Popen]) -> None:
    if any(lock.poll() is not None for lock in [release, *edges]):
        raise RuntimeError("Gateway deployment lock was lost")


def topology(ssh: list[str]) -> tuple[dict[str, str], str]:
    command = ["k3s", "kubectl", "get", "nodes", "-l", "playtime.io/node", "-o", "json"]
    data = subprocess.check_output([*ssh, shlex.join(command)])
    addresses = {}
    for node in json.loads(data)["items"]:
        role = node["metadata"]["labels"]["playtime.io/node"]
        if role not in ROLES or role in addresses:
            raise ValueError("Expected exactly two deployment nodes with independent roles")
        if not any(c["type"] == "Ready" and c["status"] == "True" for c in node["status"]["conditions"]):
            raise ValueError(f"Deployment node is not Ready: {role}")
        addresses[role] = next(a["address"] for a in node["status"]["addresses"] if a["type"] == "InternalIP")
    if set(addresses) != set(ROLES):
        raise ValueError("Expected two Ready deployment nodes")
    cmd = ["k3s", "kubectl", "-n", "kube-system", "get", "svc", "kube-dns", "-o", "json"]
    dns = json.loads(subprocess.check_output([*ssh, shlex.join(cmd)]))["spec"]["clusterIP"]
    return addresses, dns


def require_release_mount(ssh: list[str], primary: str) -> None:
    address = IPv4Address(primary)
    if not address.is_private or address.is_loopback or address.is_unspecified:
        raise ValueError("Gateway release export requires the primary WireGuard address")
    cmd = ["findmnt", "--json", "-T", RELEASE_MOUNT, "--output", "FSTYPE,OPTIONS,SOURCE,TARGET"]
    result = json.loads(subprocess.check_output([*ssh, shlex.join(cmd)]))
    mounts = result["filesystems"]
    if len(mounts) == 1:
        mount = mounts[0]
        options = set(mount["options"].split(","))
        if (
            mount["target"] == RELEASE_MOUNT
            and mount["source"] == f"{address}:{RELEASE_ROOT}"
            and mount["fstype"] in {"nfs", "nfs4"}
            and {"ro", "vers=4.2", "proto=tcp"}.issubset(options)
            and "rw" not in options
        ):
            return
    raise RuntimeError("Secondary Gateway requires the primary releases export mounted read-only over NFSv4.2/TCP")


def switch_edges(action: Callable[..., str], old: str, new: str, legacy: bool = False) -> None:
    switched: list[str] = []
    try:
        for role in ROLES:
            action(role, "activate", "--slot", new)
            switched.append(role)
        for role in ROLES:
            action(role, "check", "--slot", new)
    except (OSError, subprocess.CalledProcessError, ValueError):
        errors = []
        for role in switched:
            try:
                flag = ["--legacy-primary"] if old == "primary" and legacy else []
                action(role, "activate", "--slot", old, *flag)
            except (OSError, subprocess.CalledProcessError, ValueError):
                errors.append(role)
        if errors:
            print(f"Edge recovery needs attention on {', '.join(errors)}; both Gateways were kept running.", flush=True)
        raise


def configure_watchers(
    action: Callable[..., str], addresses: dict[str, str], dns: str, preview: bool
) -> None:
    options = {
        role: ["--edge", "direct" if role == "primary" else "compat", "--bind", addresses[role], "--dns", dns]
        for role in ROLES
    }
    for role in ROLES:
        action(role, "inspect-watch", *options[role])
    if preview:
        return
    active = {role for role in ROLES if action(role, "watch-status") == "active"}
    started: list[str] = []
    try:
        for role in ROLES:
            if role not in active:
                started.append(role)
            action(role, "enable-watch", *options[role])
    except (OSError, subprocess.CalledProcessError, ValueError):
        for role in started:
            try:
                action(role, "disable-watch")
            except (OSError, subprocess.CalledProcessError):
                print(f"Could not stop the new watcher on {role}.", flush=True)
        raise


def build_and_ship(docker: list[str], clients: dict[str, list[str]], origin: str, tag: str) -> None:
    image = f"playtime-gateway:{tag}"
    subprocess.run(
        [*docker, "build", "--platform", "linux/amd64", "--target", "gateway",
         "--build-arg", f"WEB_API_ORIGIN={origin.rstrip('/')}", "-t", image, "."],
        cwd=ROOT, check=True,
    )
    platform = subprocess.check_output(
        [*docker, "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image], text=True
    ).strip()
    if platform != "linux/amd64":
        raise ValueError("Gateway image must support both amd64 nodes")
    for role in ROLES:
        ship_images(docker, clients[role], ["gateway"], tag)


def main() -> None:
    parser = argparse.ArgumentParser(description="Update PlayTime Gateway through its standby on the second VPS")
    parser.add_argument("--profile", type=Path, default=HERE / ".secrets/cluster.json")
    parser.add_argument("--dry-run", action="store_true")
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--configure-edges", action="store_true", help="Set up the rolling Gateway vhosts")
    options.add_argument("--enable-failover", action="store_true", help="Enable the edge failover watchers")
    options.add_argument("--disable-failover", action="store_true", help="Stop the edge failover watchers")
    parser.add_argument("--prepared-tag", help="Use one already imported immutable image on both nodes")
    args = parser.parse_args()
    if args.prepared_tag and not re.fullmatch(r"r-[a-f0-9]{24}", args.prepared_tag):
        parser.error("--prepared-tag must be a valid release tag")
    if args.prepared_tag and (args.enable_failover or args.disable_failover):
        parser.error("Watcher changes do not use a release image")
    profile = load_profile(args.profile.resolve())
    deployed = {role: ssh_command(profile, role) for role in ROLES}
    docker = ["docker"] + (["--context", profile["docker_context"]] if profile.get("docker_context") else [])
    origins = {
        "primary": profile["web_origin"],
        "secondary": profile.get("web_compat_origin", "https://smeruxa.ru"),
    }
    bundle = archive()

    def edge(role: str, command: str, *options: str) -> str:
        return remote_action(
            deployed[role], bundle, "python3", "gateway-edge.py", command,
            "--template", TEMPLATE, "--origin", origins[role], *options,
            capture=command in {"show", "watch-status"},
        )

    def kubernetes(*options: str) -> None:
        remote_action(deployed["primary"], bundle, "python3", "gateway-apply.py", *options)

    if args.disable_failover:
        errors = []
        for role in ROLES:
            try:
                if args.dry_run:
                    print(f"{role}: {edge(role, 'watch-status')}")
                else:
                    edge(role, "disable-watch")
            except (OSError, subprocess.CalledProcessError):
                errors.append(role)
        if errors:
            raise RuntimeError(f"Could not reach watcher on {', '.join(errors)}")
        return

    tag = args.prepared_tag or f"r-{secrets.token_hex(12)}"
    with release_lock(deployed["primary"]) as lock, ExitStack() as stack:
        guards = [] if args.dry_run else [
            stack.enter_context(hold_edge_routing(deployed[role])) for role in ROLES
        ]
        addresses, dns = topology(deployed["primary"])
        require_release_mount(deployed["secondary"], addresses["primary"])
        if not args.enable_failover:
            kubernetes("preflight", "--tag", tag)
        slots = {role: edge(role, "show") for role in ROLES}
        pending = [role for role, value in slots.items() if value == "unconfigured"]
        legacy = bool(pending) or args.configure_edges
        if pending and not args.configure_edges:
            raise ValueError("Use --configure-edges during initial Gateway rollout")
        normalized = {"primary" if current == "unconfigured" else current for current in slots.values()}
        if len(normalized) != 1:
            raise ValueError("Edge Gateway slots differ. Resolve routing before updating either Pod")
        active, = normalized
        if args.enable_failover:
            for candidate in ROLES:
                kubernetes("probe", "--slot", candidate, "--http")
            require_routing_locks(lock, guards)
            configure_watchers(edge, addresses, dns, args.dry_run)
            print("Gateway failover preflight passed." if args.dry_run else "Gateway failover watchers are enabled.")
            return
        flags = ["--legacy-primary"] if active == "primary" and legacy else []
        kubernetes("probe", "--slot", active, *flags)
        pending_options = {
            role: ["--edge", "direct" if role == "primary" else "compat",
                   "--bind", addresses[role], "--dns", dns, "--legacy-primary"]
            for role in pending
        }
        if args.prepared_tag:
            digests = [prepared_digests(deployed[role], ["gateway"], tag)["gateway"] for role in ROLES]
            if len(set(digests)) != 1:
                raise RuntimeError("Prepared Gateway image digest differs between the nodes")
        for role in ROLES:
            if not args.prepared_tag:
                require_unused_tag(deployed[role], ["gateway"], tag)
            if role in pending:
                edge(role, "inspect", *pending_options[role])
            else:
                edge(role, "check", "--slot", active, *flags)
        if args.dry_run:
            print(f"Gateway rolling preflight passed. Active slot: {active}.")
            return

        if not args.prepared_tag:
            build_and_ship(docker, deployed, origins["primary"], tag)
        require_routing_locks(lock, guards)
        require_release_mount(deployed["secondary"], addresses["primary"])
        for role in pending:
            edge(role, "install", *pending_options[role])
        inactive = next(role for role in ROLES if role != active)
        require_routing_locks(lock, guards)
        kubernetes("apply", "--slot", inactive, "--tag", tag)
        require_release_mount(deployed["secondary"], addresses["primary"])
        require_routing_locks(lock, guards)
        switch_edges(edge, active, inactive, legacy)
        require_routing_locks(lock, guards)
        kubernetes("apply", "--slot", active, "--tag", tag)
        if inactive != "primary":
            require_routing_locks(lock, guards)
            switch_edges(edge, inactive, "primary")
        print(f"Both Gateway slots use {tag}; primary is active.")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
from http.client import HTTPConnection, HTTPException
from ipaddress import IPv4Address
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
from typing import Callable, Iterator
from urllib.parse import urlsplit

from gateway_failover import GatewayFailover, SLOTS, Slot


CONFIG_DIR = Path("/etc/nginx/conf.d")
ROUTING = CONFIG_DIR / "playtime-gateway-routing.conf"
BINDING = CONFIG_DIR / "playtime-gateway-routing.lock"
ROLLOUT_LOCK = Path("/run/lock/playtime-gateway-rollout.lock")
WATCH_ROOT = Path("/etc/playtime-cluster/gateway-watch")
WATCH_UNIT_NAME = "playtime-gateway-watch.service"
WATCH_UNIT = Path("/etc/systemd/system") / WATCH_UNIT_NAME
WATCH_PROBES = CONFIG_DIR / "playtime-gateway-probes.conf"
WATCH_PORT = 18501
LEGACY_EDGE = Path("/etc/playtime-cluster/edge")
DIRECT_EDGE = Path("/etc/nginx/sites-enabled/playtime-edge")
COMPAT_FEEDBACK = LEGACY_EDGE / "feedback-live.conf"
PROXY_LOCATION = re.compile(r"^\s*location\s+(?:\^~\s+)?(/playtime/(?:auth/|socket\.io/|feedback-api/)?)\s*\{")
NODEPORT = re.compile(r"http://(?:[0-9]{1,3}\.){3}[0-9]{1,3}:31501;")
DIRECT_PROXY = "http://$playtime_gateway;"


@dataclass(frozen=True)
class Change:
    path: Path
    text: str


def generate_route(template: str, slot: str) -> str:
    if slot not in SLOTS or template.count("${PLAYTIME_ACTIVE_SLOT}") != 1:
        raise ValueError("Invalid slot or routing template")
    return template.replace("${PLAYTIME_ACTIVE_SLOT}", slot)


def read_slot(template: str, config: Path) -> Slot:
    original = config.read_text()
    for slot in SLOTS:
        if original == generate_route(template, slot):
            return slot
    raise ValueError("Active routing configuration does not match a known Gateway slot")


def install_upstreams(text: str, paths: set[str], bind: IPv4Address, dns: IPv4Address, compat: bool) -> str:
    modified: set[str] = set()
    location: str | None = None
    output: list[str] = []
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("location "):
            found = PROXY_LOCATION.match(line)
            location = found[1] if found else None
        stripped = line.strip()
        if location in paths and stripped.startswith("proxy_pass "):
            upstream = stripped.removeprefix("proxy_pass ")
            expected = NODEPORT.fullmatch(upstream) if compat else upstream == DIRECT_PROXY
            if not expected or location in modified:
                raise ValueError(f"Unexpected proxy for {location}")
            pad = line[:len(line) - len(line.lstrip())]
            if compat:
                output.append(f"{pad}resolver {dns} valid=5s ipv6=off;\n")
                output.append(f"{pad}proxy_bind {bind};\n")
                if location == "/playtime/socket.io/" and "proxy_buffering off;" not in text:
                    output.append(f"{pad}proxy_buffering off;\n")
            variable = "playtime_socket_gateway" if location == "/playtime/socket.io/" else "playtime_http_gateway"
            output.append(f"{pad}proxy_next_upstream off;\n")
            line = f"{pad}proxy_pass http://${variable};\n"
            modified.add(location)
        output.append(line)

    if modified != paths:
        raise ValueError(f"Proxy paths differ from expected configuration: {sorted(modified)}")
    return "".join(output)


def compat_target() -> Path:
    target = Path((LEGACY_EDGE / "target").read_text().strip()).resolve(strict=True)
    nginx_root = Path("/etc/nginx").resolve(strict=True)
    if nginx_root not in target.parents:
        raise ValueError("Compatibility vhost is outside the nginx configuration directory")
    return target


def read_compat_target() -> Path:
    target = compat_target()
    previous = (LEGACY_EDGE / "live.conf").read_text()
    if previous != target.read_text():
        raise ValueError("Compatibility vhost is not the previous live configuration")
    return target


def install_changes(edge: str, bind: IPv4Address, dns: IPv4Address, template: str) -> list[Change]:
    if ROUTING.exists():
        raise ValueError("Gateway routing is already installed")
    changes = [Change(ROUTING, generate_route(template, "primary"))]
    paths = {"/playtime/auth/", "/playtime/socket.io/", "/playtime/"}
    if edge == "direct":
        target = DIRECT_EDGE.resolve(strict=True)
        changes.append(Change(target, install_upstreams(target.read_text(), paths, bind, dns, False)))
    else:
        target = read_compat_target()
        old_feedback = f"include {COMPAT_FEEDBACK};"
        content = target.read_text()
        if content.count(old_feedback) != 1:
            raise ValueError("Unexpected PlayTime feedback include")
        feedback = CONFIG_DIR.parent / "snippets" / "playtime-feedback-gateway.conf"
        if feedback.exists():
            raise ValueError("New feedback include already exists")
        content = content.replace(old_feedback, f"include {feedback};")
        changes.extend([
            Change(feedback, install_upstreams(COMPAT_FEEDBACK.read_text(), {"/playtime/feedback-api/"}, bind, dns, True)),
            Change(target, install_upstreams(content, paths, bind, dns, True)),
        ])
    return changes


def write_atomic(path: Path, data: str, mode: int) -> None:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        name = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(name, path)
        finally:
            name.unlink(missing_ok=True)


def reload_nginx() -> None:
    subprocess.run(["nginx", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)


def verify_origin(origin: str, slot: str, legacy_primary: bool = False, attempts: int = 20) -> None:
    url = urlsplit(origin)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.port not in {443, None} or url.path not in {"", "/"} or url.query or url.fragment):
        raise ValueError("Expected an HTTPS edge origin")
    for _ in range(attempts):
        response = subprocess.run(
            ["curl", "-fsS", "--max-time", "2", "--resolve", f"{url.hostname}:443:127.0.0.1",
             "-D", "-", "-o", "/dev/null", f"https://{url.hostname}/playtime/health"],
            check=False, capture_output=True, text=True,
        )
        header = re.search(
            r"^x-playtime-gateway-slot:[ \t]*([^\r\n]+)", response.stdout, re.MULTILINE | re.IGNORECASE
        )
        if response.returncode == 0 and (
            (header and header[1].strip() == slot) or (header is None and slot == "primary" and legacy_primary)
        ):
            return
        time.sleep(1)
    raise RuntimeError(f"HTTPS edge did not reach the {slot} Gateway")


@contextmanager
def configuration_lock() -> Iterator[None]:
    descriptor = os.open(BINDING, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        os.close(descriptor)


@contextmanager
def automatic_switch_allowed() -> Iterator[bool]:
    descriptor = os.open(ROLLOUT_LOCK, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
        else:
            yield True
    finally:
        os.close(descriptor)


def apply_changes(
    changes: list[Change],
    origin: str,
    slot: str,
    legacy_primary: bool = False,
    verify: Callable[[], None] | None = None,
    attempts: int = 20,
) -> None:
    previous: list[tuple[Path, str | None, int]] = []
    try:
        for change in changes:
            if change.path.is_symlink():
                raise ValueError("Refusing to replace a symbolic link")
            original = change.path.read_text() if change.path.exists() else None
            mode = stat.S_IMODE(change.path.stat().st_mode) if original is not None else 0o644
            previous.append((change.path, original, mode))
            write_atomic(change.path, change.text, mode)
        reload_nginx()
        verify_origin(origin, slot, legacy_primary, attempts)
        if verify:
            verify()
    except Exception:
        for path, original, mode in reversed(previous):
            if original is None:
                path.unlink(missing_ok=True)
            else:
                write_atomic(path, original, mode)
        reload_nginx()
        raise


def probe_slot(slot: Slot) -> bool:
    connection = HTTPConnection("127.0.0.1", WATCH_PORT, timeout=1.0)
    try:
        connection.request("GET", f"/{slot}")
        response = connection.getresponse()
        return response.status == 200 and response.getheader("X-PlayTime-Gateway-Slot") == slot
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()


def watch(template: str, origin: str) -> None:
    decision = GatewayFailover()
    retry_at = 0.0
    with ThreadPoolExecutor(max_workers=2) as workers:
        while True:
            started = time.monotonic()
            with automatic_switch_allowed() as allowed:
                if not allowed:
                    decision = GatewayFailover()
                else:
                    probes = dict(zip(SLOTS, workers.map(probe_slot, SLOTS)))
                    with configuration_lock():
                        active = read_slot(template, ROUTING)
                        target = decision.record(active, probes, started)
                        if target and started >= retry_at:
                            try:
                                print(f"Gateway failover {active} → {target}", flush=True)
                                apply_changes(
                                    [Change(ROUTING, generate_route(template, target))], origin, target, attempts=5
                                )
                            except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
                                print(f"Gateway failover failed: {error}", flush=True)
                                decision = GatewayFailover()
                                retry_at = time.monotonic() + 10.0
            time.sleep(max(0.0, 1.0 - (time.monotonic() - started)))


def disable_retries(text: str, paths: set[str]) -> str:
    found: set[str] = set()
    output: list[str] = []
    location: str | None = None
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("location "):
            match = PROXY_LOCATION.match(line)
            location = match[1] if match else None
        if location in paths and line.lstrip().startswith("proxy_next_upstream "):
            continue
        if location in paths and line.lstrip().startswith("proxy_pass "):
            upstream = "socket" if location == "/playtime/socket.io/" else "http"
            if line.strip() != f"proxy_pass http://$playtime_{upstream}_gateway;" or location in found:
                raise ValueError(f"Unexpected Gateway proxy for {location}")
            indent = line[:len(line) - len(line.lstrip())]
            output.append(f"{indent}proxy_next_upstream off;\n")
            found.add(location)
        output.append(line)
    if found != paths:
        raise ValueError("Gateway routes must be configured before enabling failover")
    return "".join(output)


def watch_changes(
    edge: str, bind: IPv4Address, dns: IPv4Address, origin: str, template_file: Path
) -> list[Change]:
    parsed = urlsplit(origin)
    if not parsed.hostname or origin.rstrip("/") != f"https://{parsed.hostname}":
        raise ValueError("Watcher needs a canonical HTTPS edge origin")
    source = template_file.parent
    probes = (source / "nginx-probes.conf.template").read_text()
    probes = probes.replace("${PLAYTIME_CLUSTER_DNS}", str(dns)).replace("${PLAYTIME_EDGE_PRIVATE_IP}", str(bind))
    unit = (source / "gateway-watch.service.template").read_text()
    unit = unit.replace("${PLAYTIME_EDGE_ORIGIN}", origin.rstrip("/"))
    changes = [
        Change(WATCH_PROBES, probes),
        Change(WATCH_UNIT, unit),
    ]
    for name in [template_file.name, "gateway-edge.py", "gateway_failover.py"]:
        changes.append(Change(WATCH_ROOT / name, (source / name).read_text()))
    target = DIRECT_EDGE.resolve(strict=True) if edge == "direct" else compat_target()
    paths = {"/playtime/auth/", "/playtime/socket.io/", "/playtime/"}
    changes.append(Change(target, disable_retries(target.read_text(), paths)))
    if edge == "compat":
        feedback = CONFIG_DIR.parent / "snippets" / "playtime-feedback-gateway.conf"
        changes.append(Change(feedback, disable_retries(feedback.read_text(), {"/playtime/feedback-api/"})))
    return changes


def verify_probes() -> None:
    for _ in range(10):
        if all(probe_slot(slot) for slot in SLOTS):
            return
        time.sleep(1)
    raise RuntimeError("Both private Gateway HTTP readiness probes must pass")


def main() -> None:
    parser = argparse.ArgumentParser(description="Select the active PlayTime Gateway")
    parser.add_argument("command", choices=[
        "show", "inspect", "install", "activate", "check",
        "watch", "inspect-watch", "enable-watch", "disable-watch", "watch-status",
    ])
    parser.add_argument("--template", required=True, type=Path)
    parser.add_argument("--origin")
    parser.add_argument("--slot", choices=SLOTS)
    parser.add_argument("--edge", choices=["direct", "compat"])
    parser.add_argument("--bind", type=IPv4Address)
    parser.add_argument("--dns", type=IPv4Address)
    parser.add_argument("--legacy-primary", action="store_true")
    args = parser.parse_args()
    template = args.template.read_text()

    if args.command == "watch":
        if not args.origin:
            parser.error("--origin is required")
        watch(template, args.origin)
        return
    if args.command == "disable-watch":
        if WATCH_UNIT.is_file():
            subprocess.run(["systemctl", "disable", "--now", WATCH_UNIT_NAME], check=True)
        return
    if args.command == "watch-status":
        status = subprocess.run(["systemctl", "is-active", "--quiet", WATCH_UNIT_NAME], check=False)
        print("active" if status.returncode == 0 else "inactive")
        return

    with configuration_lock():
        if args.command == "show":
            print(read_slot(template, ROUTING) if ROUTING.exists() else "unconfigured")
            return
        if not args.origin:
            parser.error("--origin is required")
        if args.command in {"inspect-watch", "enable-watch"}:
            if not (args.edge and args.bind and args.dns):
                parser.error("--edge, --bind and --dns are required for the failover watcher")
            active = read_slot(template, ROUTING)
            changes = watch_changes(args.edge, args.bind, args.dns, args.origin, args.template)
            if args.command == "enable-watch":
                WATCH_ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
                apply_changes(changes, args.origin, active, verify=verify_probes)
                subprocess.run(["systemctl", "daemon-reload"], check=True)
                subprocess.run(["systemctl", "enable", WATCH_UNIT_NAME], check=True)
                subprocess.run(["systemctl", "restart", WATCH_UNIT_NAME], check=True)
            return
        if args.command in {"inspect", "install"}:
            if not (args.edge and args.bind and args.dns):
                parser.error("--edge, --bind and --dns are required for initial configuration")
            changes = install_changes(args.edge, args.bind, args.dns, template)
            if args.command == "install":
                apply_changes(changes, args.origin, "primary", args.legacy_primary)
            return
        if not args.slot:
            parser.error("--slot is required")
        active = read_slot(template, ROUTING)
        if args.command == "check":
            if active != args.slot:
                raise ValueError(f"Expected {args.slot} while {active} is configured")
            verify_origin(args.origin, active, args.legacy_primary)
        elif active == args.slot:
            verify_origin(args.origin, active, args.legacy_primary)
        else:
            apply_changes(
                [Change(ROUTING, generate_route(template, args.slot))], args.origin, args.slot, args.legacy_primary
            )


if __name__ == "__main__":
    main()

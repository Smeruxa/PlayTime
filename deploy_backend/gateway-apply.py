from __future__ import annotations

import argparse
from ipaddress import IPv4Address
import json
from pathlib import Path
import re
import subprocess
import time
from typing import Any
from urllib.parse import urlsplit

import yaml
from gateway_topology import PRIMARY_GATEWAY, SECONDARY_GATEWAY, Resource, domain_relay_env, rolling_gateway_resources, wait_for_quiet_gateways


NAMESPACE = "playtime"
NAMES = {"primary": PRIMARY_GATEWAY, "secondary": SECONDARY_GATEWAY}


def slot_workload(resources: list[Resource], slot: str) -> Resource:
    candidate, = [
        resource for resource in resources
        if resource["kind"] == "StatefulSet" and resource["metadata"]["name"] == NAMES[slot]
    ]
    return candidate


def kubectl(*args: str, data: bytes | None = None) -> bytes:
    return subprocess.check_output(["k3s", "kubectl", "--request-timeout=25s", *args], input=data)


def render(root: Path, tag: str) -> list[Resource]:
    manifests = yaml.safe_load_all(kubectl("kustomize", str(root)))
    resources = rolling_gateway_resources(manifests)
    for item in resources:
        if item["kind"] == "StatefulSet":
            container, = item["spec"]["template"]["spec"]["containers"]
            container["image"] = f"playtime-gateway:{tag}"
            for source in container["envFrom"]:
                key, = source
                reference = source[key]
                if not reference.get("optional", False):
                    kind = {"configMapRef": "configmap", "secretRef": "secret"}[key]
                    kubectl("-n", NAMESPACE, "get", kind, reference["name"], "-o", "name")
    return resources


def apply(resources: list[Resource], dry_run: bool = False) -> None:
    args = ["apply", "-f", "-", "-o", "name"]
    if dry_run:
        args.append("--dry-run=server")
    print(kubectl(*args, data=yaml.safe_dump_all(resources).encode()).decode().strip())


def pod(slot: str) -> dict[str, Any]:
    return json.loads(kubectl("-n", NAMESPACE, "get", "pod", f"{NAMES[slot]}-0", "-o", "json"))


def curl(url: str, *args: str) -> bytes:
    return subprocess.check_output(["curl", "-fsS", "--max-time", "7", *args, url])


def probe(slot: str, legacy_primary: bool = False, http: bool = False) -> None:
    details = pod(slot)
    statuses = details["status"]
    ip = IPv4Address(statuses["podIP"])
    if not any(item["type"] == "Ready" and item["status"] == "True" for item in statuses.get("conditions", [])):
        raise RuntimeError(f"{slot} Pod is not Ready")
    origin = f"http://{ip}:1501"
    readiness_path = "/http-readyz" if http else "/readyz"
    ready = curl(origin + readiness_path, "-D", "-", "-o", "/dev/null").decode()
    header = re.search(r"^x-playtime-gateway-slot:[ \t]*([^\r\n]+)", ready, re.MULTILINE | re.IGNORECASE)
    if not ((header and header[1].strip() == slot) or (header is None and slot == "primary" and legacy_primary)):
        raise RuntimeError(f"Wrong Gateway slot at {slot} Pod")
    result = json.loads(curl(origin + "/playtime/releases/latest"))
    releases = result["releases"]
    if not releases:
        raise RuntimeError("Latest Gateway release metadata is empty")
    for item in releases.values():
        path = urlsplit(item["url"]).path
        if not path.startswith("/playtime/downloads/"):
            raise RuntimeError("Unexpected release download URL")
        curl(origin + path, "--head", "-o", "/dev/null")
    print(f"{slot} Gateway ready. Current release files are readable.")


def wait(slot: str) -> None:
    for _ in range(60):
        try:
            probe(slot)
            return
        except (subprocess.CalledProcessError, KeyError, RuntimeError):
            time.sleep(4)
    raise RuntimeError(f"Readiness probe for {slot} Gateway timed out")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render, validate or update one PlayTime Gateway")
    parser.add_argument("stage", choices=["preflight", "apply", "probe"])
    parser.add_argument("--slot", choices=NAMES)
    parser.add_argument("--tag")
    parser.add_argument("--legacy-primary", action="store_true")
    parser.add_argument("--http", action="store_true", help="Check only HTTP readiness")
    args = parser.parse_args()

    if args.stage == "probe":
        if not args.slot:
            parser.error("probe requires --slot")
        probe(args.slot, args.legacy_primary, args.http)
        return
    if not args.tag or not re.fullmatch(r"r-[a-f0-9]{24}", args.tag):
        parser.error("a deploy image tag is required")
    config = render(Path("k8s/two-vps"), args.tag)
    if args.stage == "preflight":
        apply(config, dry_run=True)
        return

    if not args.slot:
        parser.error("apply requires --slot")
    pod_name = f"{NAMES[args.slot]}-0"
    live = kubectl("-n", NAMESPACE, "get", "pod", pod_name, "--ignore-not-found", "-o", "json").strip()
    if live:
        active = json.loads(live)
        container, = active["spec"]["containers"]
        keys = {item["name"] for item in container.get("env", ())}
        if not domain_relay_env().keys() <= keys:
            wait_for_quiet_gateways(kubectl, [pod_name])
    policies = [item for item in config if item["kind"] in {"NetworkPolicy", "Service"}]
    apply([*policies, slot_workload(config, args.slot)])
    subprocess.run(
        ["k3s", "kubectl", "-n", NAMESPACE, "rollout", "status", f"statefulset/{NAMES[args.slot]}", "--timeout=5m"],
        check=True,
    )
    wait(args.slot)


if __name__ == "__main__":
    main()

import argparse
from copy import deepcopy
from pathlib import Path
import time
from typing import Any, Callable, Iterable

import yaml

Resource = dict[str, Any]
PRIMARY_GATEWAY = "playtime-gateway"
SECONDARY_GATEWAY = "playtime-gateway-secondary"
RELEASE_ROOT = "/srv/playtime-cluster/release-data"
RELEASE_MOUNT = "/srv/playtime-cluster/gateway-release-share"
DOMAIN_PORTS = {"chat": 1512, "room": 1513}
GATEWAY_CONNECTION_PROBE = """
const fs = require('node:fs');
const listen = Number(process.env.PORT || '1501').toString(16).padStart(4, '0').toUpperCase();
const rows = ['tcp', 'tcp6'].flatMap(file => fs.readFileSync('/proc/net/' + file, 'utf8').trim().split('\\n').slice(1));
const established = rows.filter(line => {
    const [, local,, status] = line.trim().split(/\\s+/);
    return status === '01' && local.endsWith(':' + listen);
});
process.stdout.write(String(established.length));
"""


def wait_for_quiet_gateways(read: Callable[..., bytes], pods: Iterable[str]) -> None:
    names = tuple(pods)
    quiet = 0
    for _ in range(30):
        counts = [int(read("-n", "playtime", "exec", name, "--", "node", "-e", GATEWAY_CONNECTION_PROBE)) for name in names]
        quiet = quiet + 1 if all(count == 0 for count in counts) else 0
        if quiet == 3:
            return
        time.sleep(2)
    raise RuntimeError("Initial migration postponed while the retiring Gateway has client connections")


def domain_relay_env() -> dict[str, str]:
    return {
        f"PLAYTIME_{name.upper()}_RELAY_URLS": ",".join(
            f"http://playtime-{name}-api-{index}.playtime-pods:{port}" for index in range(2)
        )
        for name, port in DOMAIN_PORTS.items()
    }


def replace_env(container: Resource, name: str, value: str) -> None:
    options = container.setdefault("env", [])
    if not isinstance(options, list):
        raise ValueError("Gateway env is not a list")
    options[:] = [item for item in options if item["name"] != name]
    options.append({"name": name, "value": value})


def gateway_slot(source: Resource, slot: str) -> Resource:
    gateway = deepcopy(source)
    spec = gateway["spec"]
    pod = spec["template"]["spec"]
    container, = pod["containers"]
    replace_env(container, "PLAYTIME_GATEWAY_SLOT", slot)
    replace_env(container, "PLAYTIME_AUTH_HA", "1")
    for key, value in domain_relay_env().items():
        replace_env(container, key, value)
    container["readinessProbe"]["httpGet"]["path"] = "/http-readyz"
    spec["minReadySeconds"] = 5
    pod["terminationGracePeriodSeconds"] = 45
    if slot == "primary":
        return gateway

    gateway["metadata"]["name"] = SECONDARY_GATEWAY
    spec["selector"]["matchLabels"]["app.kubernetes.io/name"] = SECONDARY_GATEWAY
    spec["template"]["metadata"]["labels"]["app.kubernetes.io/name"] = SECONDARY_GATEWAY
    pod["nodeSelector"]["playtime.io/node"] = "secondary"

    for volume in pod["volumes"]:
        if volume["name"] == "releases":
            volume.pop("persistentVolumeClaim")
            volume["hostPath"] = {"path": RELEASE_MOUNT, "type": "Directory"}
            break
    else:
        raise ValueError("Gateway release volume missing")

    for mount in container["volumeMounts"]:
        if mount["name"] == "releases":
            mount["readOnly"] = True
            break
    else:
        raise ValueError("Gateway release mount missing")
    return gateway


def share_gateway_relays(resource: Resource) -> Resource:
    updated = deepcopy(resource)
    for rule in updated["spec"].get("ingress", []):
        for source in rule.get("from", []):
            for expression in source.get("podSelector", {}).get("matchExpressions", []):
                if expression.get("key") == "app.kubernetes.io/name" and expression.get("operator") == "In":
                    values = expression["values"]
                    if PRIMARY_GATEWAY in values and SECONDARY_GATEWAY not in values:
                        values.append(SECONDARY_GATEWAY)
    return updated


def rolling_gateway_resources(base: Iterable[Resource]) -> list[Resource]:
    sources = list(base)
    gateways = [
        item for item in sources
        if item["kind"] == "StatefulSet" and item["metadata"]["name"] == PRIMARY_GATEWAY
    ]
    if len(gateways) != 1:
        raise ValueError("Expected exactly one primary Gateway StatefulSet")
    policies = [
        share_gateway_relays(item) for item in sources
        if item["kind"] == "NetworkPolicy" and item["metadata"]["name"] in {
            "playtime-auth-ingress", "playtime-chat-ingress", "playtime-room-ingress",
        }
    ]
    if len(policies) != 3:
        raise ValueError("Gateway relay policies are incomplete")
    return [
        *policies,
        *(item for item in sources if item["kind"] == "Service" and item["metadata"]["name"] in {PRIMARY_GATEWAY, "playtime-pods"}),
        gateway_slot(gateways[0], "primary"),
        gateway_slot(gateways[0], "secondary"),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Render both Gateway StatefulSets and their relay policies")
    parser.add_argument("application", type=Path)
    options = parser.parse_args()
    config = yaml.safe_load_all(options.application.read_text())
    print(yaml.safe_dump_all(rolling_gateway_resources(config), sort_keys=False), end="")


if __name__ == "__main__":
    main()

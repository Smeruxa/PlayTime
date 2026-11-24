import json
import re
import subprocess
import sys
import time
from ipaddress import ip_address
from pathlib import Path

import yaml
from gateway_topology import PRIMARY_GATEWAY, SECONDARY_GATEWAY, domain_relay_env, replace_env, share_gateway_relays, wait_for_quiet_gateways


REPLICATED_DOMAINS = {"chat-api": (1512, 0), "room-api": (1513, 1)}


def kube(*args, data=None, capture=False):
    result = subprocess.run(
        ["k3s", "kubectl", "--request-timeout=30s", *args],
        input=data, stdout=subprocess.PIPE if capture else None, check=True
    )
    return result.stdout


def render(directory):
    return list(yaml.safe_load_all(kube("kustomize", str(directory), capture=True)))


def apply(resources, preview):
    options = ["--dry-run=server"] if preview else []
    kube("apply", *options, "-f", "-", "-o", "name", data=yaml.safe_dump_all(resources).encode())


def wait_for_job(name):
    for _ in range(155):
        job = json.loads(kube("-n", "playtime", "get", "job", name, "-o", "json", capture=True))
        for condition in job.get("status", {}).get("conditions", []):
            if condition["status"] == "True":
                if condition["type"] == "Complete":
                    return
                if condition["type"] in {"Failed", "FailureTarget"}:
                    raise SystemExit(f"Migration {name} failed; inspect its logs before retrying.")
        time.sleep(4)
    raise SystemExit(f"Migration {name} timed out.")


def statefulset(name):
    return json.loads(kube("-n", "playtime", "get", "statefulset", name, "-o", "json", capture=True))


def accepts_multiple_auth_replicas(resource):
    container, = resource["spec"]["template"]["spec"]["containers"]
    return any(item.get("name") == "PLAYTIME_AUTH_HA" and item.get("value") == "1" for item in container.get("env", []))


def auth_replica_count():
    gateways = [statefulset(name) for name in (PRIMARY_GATEWAY, SECONDARY_GATEWAY)]
    current = statefulset("playtime-auth-api")["spec"]["replicas"]
    if not all(accepts_multiple_auth_replicas(gateway) for gateway in gateways):
        if current > 1:
            raise SystemExit("Restore auth HA on both Gateways before updating Auth replicas")
        return current
    if all(
        resource["status"].get("readyReplicas") == 1
        and resource["status"].get("currentRevision") == resource["status"].get("updateRevision")
        for resource in gateways
    ):
        return 2
    return current


def distribute_auth(workload):
    pod = workload["template"]["spec"]
    pod["nodeSelector"].pop("playtime.io/node")
    pod["affinity"] = {
        "nodeAffinity": {
            "requiredDuringSchedulingIgnoredDuringExecution": {
                "nodeSelectorTerms": [{
                    "matchExpressions": [{
                        "key": "playtime.io/node", "operator": "In", "values": ["primary", "secondary"],
                    }],
                }],
            },
            "preferredDuringSchedulingIgnoredDuringExecution": [{
                "weight": 100,
                "preference": {
                    "matchExpressions": [{"key": "playtime.io/node", "operator": "In", "values": ["primary"]}],
                },
            }],
        },
        "podAntiAffinity": {
            "requiredDuringSchedulingIgnoredDuringExecution": [{
                "labelSelector": workload["selector"],
                "topologyKey": "kubernetes.io/hostname",
            }],
        },
    }


def prepare_domain(workload, port):
    spec = workload["spec"]
    pod = spec["template"]["spec"]
    container, = pod["containers"]
    replace_env(container, "PLAYTIME_DOMAIN_ROLLOUT", "1")
    container["lifecycle"] = {"preStop": {"exec": {"command": ["node", "-e", "setTimeout(()=>{},4000)"]}}}
    container["readinessProbe"] = {
        "exec": {"command": ["node", "-e", (
            f'fetch("http://127.0.0.1:{port}/internal/ready",'
            '{headers:{"x-playtime-internal":process.env.PLAYTIME_INTERNAL_SECRET},'
            'signal:AbortSignal.timeout(1000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))'
        )]},
        "periodSeconds": 3,
        "timeoutSeconds": 2,
        "failureThreshold": 1,
    }


def domain_counts():
    counts = []
    for name in (PRIMARY_GATEWAY, SECONDARY_GATEWAY):
        gateway = statefulset(name)
        container, = gateway["spec"]["template"]["spec"]["containers"]
        env = {entry["name"]: entry.get("value") for entry in container.get("env", [])}
        if any(env.get(key) != value for key, value in domain_relay_env().items()):
            raise RuntimeError("Run deploy:gateway on both nodes before enabling domain replicas")
        pod = json.loads(kube("-n", "playtime", "get", "pod", f"{name}-0", "-o", "json", capture=True))
        origin = "http://" + pod["status"]["podIP"] + ":1501"
        headers = subprocess.check_output(["curl", "-fsS", "--max-time", "5", "-D", "-", "-o", "/dev/null", origin + "/readyz"])
        match = re.search(rb"^x-playtime-domain-replicas:\s*([012]),([012])\r?$", headers, re.M | re.I)
        if not match:
            raise RuntimeError("Gateway has not enabled the replicated domain protocol")
        counts.append(tuple(map(int, match.groups())))
    return counts


def wait_for_domain(index, minimum):
    for _ in range(36):
        try:
            if all(counts[index] >= minimum for counts in domain_counts()):
                return
        except (RuntimeError, subprocess.CalledProcessError, KeyError):
            pass
        time.sleep(3)
    raise RuntimeError(f"Both Gateways must reach {minimum} ready replicas of domain {index + 1}")


def gateway_service_health(service):
    spec = service["spec"]
    if spec.get("type") != "ClusterIP":
        raise RuntimeError("Gateway service must be internal")
    address = ip_address(spec["clusterIP"])
    host = f"[{address}]" if address.version == 6 else str(address)
    port = next(p["port"] for p in spec["ports"] if p["name"] == "http")
    health = subprocess.check_output(["curl", "-fsS", "--max-time", "8", f"http://{host}:{port}/playtime/health"])
    if json.loads(health).get("ok") is not True:
        raise SystemExit("Gateway health check failed")


def main():
    tag, mode, *options = sys.argv[1:]
    bootstrap = options == ["bootstrap-domains"]
    if options and not bootstrap:
        raise SystemExit("Invalid rollout option")
    if mode not in {"check", "apply", "domains-check", "domains-apply"} or not re.fullmatch(r"r-[a-f0-9]{24}", tag):
        raise SystemExit("Invalid deployment stage or tag")
    domains_only = mode.startswith("domains-")
    rolling = bool(kube(
        "-n", "playtime", "get", "statefulset", SECONDARY_GATEWAY, "--ignore-not-found", "-o", "name", capture=True
    ).strip())
    if rolling and not domains_only:
        raise SystemExit("Rolling Gateway is installed. Use deploy:backend -- --domains-only, then deploy:gateway.")
    if bootstrap and not rolling:
        raise SystemExit("Install rolling Gateways before adding domain replicas")
    directory = Path("k8s/two-vps")
    for overlay in [directory, directory / "migrations"]:
        file = overlay / "kustomization.yaml"
        config = yaml.safe_load(file.read_text())
        for image in config["images"]:
            image["newTag"] = tag
        file.write_text(yaml.safe_dump(config))
    app = render(directory)
    job, = render(directory / "migrations")
    job["metadata"]["name"] = f"playtime-migrate-{tag}"
    job["spec"]["ttlSecondsAfterFinished"] = 7 * 24 * 60 * 60
    service_names = ["auth-api", "chat-api", "room-api", "gateway"]
    workloads = {item["metadata"]["name"]: item for item in app if item["kind"] == "StatefulSet"}
    expected = {"playtime-" + name for name in service_names}
    if set(workloads) != expected:
        raise SystemExit("Unexpected StatefulSet inventory")
    names = service_names[:-1] if domains_only else service_names
    if domains_only:
        workloads.pop("playtime-gateway")
        app = [item for item in app if not (
            item["metadata"]["name"] == "playtime-gateway" and item["kind"] in {"StatefulSet", "Service"}
        )]
    if rolling:
        app = [share_gateway_relays(item) if item["kind"] == "NetworkPolicy" else item for item in app]
        auth = workloads["playtime-auth-api"]["spec"]
        auth["replicas"] = auth_replica_count()
        auth["minReadySeconds"] = 3
        if auth["replicas"] == 2:
            distribute_auth(auth)
        counts = [] if bootstrap and mode.endswith("check") else domain_counts()
        if not bootstrap and any(pair != (2, 2) for pair in counts):
            raise SystemExit("Both Gateways need two ready Chat and Room replicas. For first conversion use --bootstrap-domain-replicas.")
        for name, (port, _) in REPLICATED_DOMAINS.items():
            prepare_domain(workloads["playtime-" + name], port)
    else:
        for name in REPLICATED_DOMAINS:
            workloads["playtime-" + name]["spec"]["replicas"] = 1
    shared = [item for item in app if item["kind"] != "StatefulSet"]
    live_jobs = json.loads(kube("-n", "playtime", "get", "jobs", "-o", "json", capture=True))["items"]
    for previous in live_jobs:
        if previous["metadata"]["name"].startswith("playtime-migrate") and not any(
            c["type"] in {"Complete", "Failed"} and c["status"] == "True"
            for c in previous.get("status", {}).get("conditions", [])
        ):
            raise SystemExit("A migration job is still running")
    for item in [*workloads.values(), job]:
        image = "playtime-database" if item["kind"] == "Job" else item["metadata"]["name"]
        spec = item["spec"]["template"]["spec"]
        distributed_auth = image == "playtime-auth-api" and item["spec"]["replicas"] == 2
        if ((not distributed_auth and spec["nodeSelector"].get("playtime.io/node") != "primary")
                or [c["image"] for c in spec["containers"]] != [f"{image}:{tag}"]):
            raise SystemExit(f"Unexpected image or placement for {image}")
        for container in spec["containers"]:
            for source in container.get("envFrom", []):
                for kind, ref in source.items():
                    if kind in {"configMapRef", "secretRef"} and not ref.get("optional"):
                        refname = ref["name"]
                        if any(r["kind"] == "ConfigMap" and r["metadata"]["name"] == refname for r in shared):
                            continue
                        kube("-n", "playtime", "get", "secret" if kind == "secretRef" else "configmap", refname, "-o", "name", capture=True)
    for role in ["primary", "secondary"]:
        nodes = json.loads(kube("get", "nodes", "-l", f"playtime.io/node={role}", "-o", "json", capture=True))["items"]
        if len(nodes) != 1 or not any(c["type"] == "Ready" and c["status"] == "True" for c in nodes[0]["status"]["conditions"]):
            raise SystemExit(f"Exactly one Ready {role} node is required")
    for claim in (r for r in shared if r["kind"] == "PersistentVolumeClaim"):
        live = json.loads(kube("-n", "playtime", "get", "pvc", claim["metadata"]["name"], "-o", "json", capture=True))
        if live["status"]["phase"] != "Bound" or live["spec"]["volumeName"] != claim["spec"]["volumeName"]:
            raise SystemExit("Unexpected storage binding: " + claim["metadata"]["name"])
    apply([job, *app], True)
    if mode.endswith("check"):
        return
    apply([job], False)
    wait_for_job(job["metadata"]["name"])
    apply(shared, False)
    for name in names:
        resource = "playtime-" + name
        workload = workloads[resource]
        if rolling and name in REPLICATED_DOMAINS:
            _, index = REPLICATED_DOMAINS[name]
            if bootstrap and any(counts[index] < 2 for counts in domain_counts()):
                strategy = workload["spec"]["updateStrategy"]["rollingUpdate"]
                strategy["partition"] = 1
                apply([workload], False)
                wait_for_domain(index, 1)
                if name == "room-api":
                    wait_for_quiet_gateways(
                        lambda *args: kube(*args, capture=True),
                        [f"{PRIMARY_GATEWAY}-0", f"{SECONDARY_GATEWAY}-0"],
                    )
                strategy["partition"] = 0
        apply([workload], False)
        subprocess.run(["k3s", "kubectl", "-n", "playtime", "rollout", "status", "statefulset/" + resource, "--timeout=4m"], check=True)
        if rolling and name in REPLICATED_DOMAINS:
            wait_for_domain(REPLICATED_DOMAINS[name][1], 2)
    if domains_only:
        print(f"Domain services are ready. Deployed {tag}.")
        return
    service = json.loads(kube("-n", "playtime", "get", "service", "playtime-gateway", "-o", "json", capture=True))
    gateway_service_health(service)
    print(f"Gateway is ready. Deployed {tag}.")


if __name__ == "__main__":
    main()

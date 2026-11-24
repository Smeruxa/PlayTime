import importlib.util
from ipaddress import IPv4Address
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import yaml


DEPLOY = Path(__file__).resolve().parent
ROOT = DEPLOY.parent
RECOVERY_DIR = DEPLOY / "disaster-recovery"
sys.path.insert(0, str(RECOVERY_DIR))

import common
import export
import pull


def load_script(name, file):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InfrastructureSecurityTests(unittest.TestCase):
    def test_gateway_probe_uses_internal_service(self):
        manifests = list(yaml.safe_load_all((ROOT / "deploy/k8s/base/services.yaml").read_text()))
        gateway = next(item for item in manifests if item["metadata"]["name"] == "playtime-gateway")
        spec = gateway["spec"]
        self.assertEqual(spec["type"], "ClusterIP")
        self.assertTrue(all("nodePort" not in port for port in spec["ports"]))
        overlay = (ROOT / "deploy/k8s/two-vps/kustomization.yaml").read_text()
        self.assertNotIn("NodePort", overlay)
        rollout = load_script("test_cluster_rollout", "cluster-rollout.py")
        spec["clusterIP"] = "10.43.0.42"
        with patch.object(rollout.subprocess, "check_output", return_value=b'{"ok":true}') as check:
            rollout.gateway_service_health(gateway)
            self.assertEqual(check.call_args.args[0][-1], "http://10.43.0.42:1501/playtime/health")
            spec["type"] = "NodePort"
            with self.assertRaisesRegex(RuntimeError, "must be internal"):
                rollout.gateway_service_health(gateway)

    def test_gateway_rollout_selects_workload_when_service_shares_its_name(self):
        rollout = load_script("test_gateway_apply", "gateway-apply.py")
        name = {"name": "playtime-gateway"}
        service = {"kind": "Service", "metadata": name}
        workload = {"kind": "StatefulSet", "metadata": name}
        self.assertIs(rollout.slot_workload([service, workload], "primary"), workload)

    def test_turn_blocks_special_ranges_and_requires_both_hosts(self):
        turn = load_script("test_turn_peers", "turn-peers.py")
        relay = "192.0.2.10"
        peer = "203.0.113.20"
        configured = turn.deny_rules(relay, f"{relay}, {peer}")
        for address in (
            relay, peer, "0.0.0.0-0.255.255.255", "100.64.0.0-100.127.255.255",
            "192.0.0.0-192.0.0.255", "198.18.0.0-198.19.255.255", "224.0.0.0-239.255.255.255",
            "240.0.0.0-255.255.255.255", "::1", "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
            "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
        ):
            self.assertIn(f"denied-peer-ip={address}", configured)
        for missing in ("", relay, f"{peer},2001:db8::1"):
            with self.assertRaises(ValueError):
                turn.deny_rules(relay, missing)
        self.assertIn("\nno-tcp-relay\n", (DEPLOY / "setup-coturn.sh").read_text())

    def test_turn_hairpin_is_confined_to_its_dedicated_udp_ports(self):
        firewall = load_script("test_turn_firewall", "turn-peer-firewall.py")
        relay = IPv4Address("192.0.2.10")
        rules = firewall.filter_rules(relay, 104, (32768, 60999), True)
        self.assertIn("-d 192.0.2.10/32 -p udp --dport 62000:62999 -j RETURN\n", rules)
        self.assertIn("-d 192.0.2.10/32 -j REJECT\n", rules)
        self.assertIn("--dst-type LOCAL -j REJECT\n", rules)
        self.assertIn("-I OUTPUT 1 -m owner --uid-owner 104", rules)
        self.assertNotIn("-I OUTPUT", firewall.filter_rules(relay, 104, (32768, 60999), False))
        with self.assertRaises(ValueError):
            firewall.filter_rules(relay, 104, (32768, 62300), True)

    def test_nginx_preserves_security_headers_with_local_cache_policy(self):
        edge = (ROOT / "deploy/k8s/two-vps/edge.conf.template").read_text()
        self.assertEqual(edge.count("server_tokens off;"), 2)
        self.assertIn("add_header X-Frame-Options DENY always;", edge)
        self.assertIn("add_header Content-Security-Policy \"frame-ancestors 'none'\" always;", edge)
        vhost = (DEPLOY / "smeruxa.ru.nginx.conf").read_text()
        location = vhost.split("location /stalk/socket.io/ {", 1)[1].split("\n    }", 1)[0]
        for header in ("Cache-Control", "Strict-Transport-Security", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options", "X-Content-Type-Options"):
            self.assertRegex(location, rf"add_header {header} [^\n]+ always;")

    def test_export_encrypts_validated_database_for_recovery_recipient(self):
        fake_dump = b"PGDMP fixture"
        ciphertext = common.AGE_HEADER + b"fixture ciphertext"
        recipient = "fixture recovery recipient"
        with TemporaryDirectory() as directory:
            stage = Path(directory)

            def run(command, *, check, stdout=None, stdin=None):
                self.assertTrue(check)
                if command[0] == "runuser":
                    stdout.write(fake_dump)
                else:
                    self.assertEqual(stdin.read(), fake_dump)
                    if command[0] == "age":
                        self.assertEqual(command[1:4], ["--encrypt", "--recipient", recipient])
                        Path(command[-1]).write_bytes(ciphertext)
                    else:
                        self.assertEqual(command[-1], "--list")
            with patch.object(export.subprocess, "run", side_effect=run) as process:
                export.encrypt_postgres(stage, recipient)
            self.assertEqual(process.call_count, 3)
            self.assertEqual([file.name for file in stage.iterdir()], [common.PG_DUMP])
            self.assertEqual((stage / common.PG_DUMP).read_bytes(), ciphertext)

    def test_receiver_rejects_plaintext_even_when_hash_matches(self):
        with TemporaryDirectory() as directory:
            stage = Path(directory)
            data = {name: common.AGE_HEADER + b"fixture ciphertext" for name in common.FILES}

            def write_snapshot(version):
                for name, content in data.items():
                    (stage / name).write_bytes(content)
                metadata = {name: {"bytes": len(content), "sha256": common.sha256(stage / name)} for name, content in data.items()}
                (stage / common.METADATA).write_text(json.dumps({"version": version, "files": metadata}))

            write_snapshot(2)
            pull.verify_files(stage)
            write_snapshot(1)
            with self.assertRaisesRegex(ValueError, "Unexpected recovery archive manifest"):
                pull.verify_files(stage)
            data[common.PG_DUMP] = b"PGDMP fixture plaintext"
            write_snapshot(2)
            with self.assertRaisesRegex(ValueError, "not age encrypted"):
                pull.verify_files(stage)


if __name__ == "__main__":
    unittest.main()

import json
from ipaddress import IPv4Address
from pathlib import Path
from pwd import getpwnam
import subprocess


SETTINGS = Path("/etc/playtime/turn-peer-firewall.json")
CHAIN = "PLAYTIME_TURN_PEERS"
RELAY_PORTS = (62000, 62999)


def filter_rules(host: IPv4Address, uid: int, ephemeral: tuple[int, int], add_hook: bool) -> str:
    first, last = RELAY_PORTS
    ephemeral_first, ephemeral_last = ephemeral
    if uid <= 0 or not (last < ephemeral_first or first > ephemeral_last):
        raise ValueError("TURN must have an unprivileged user and dedicated UDP ports outside the ephemeral range")
    terms = [
        "*filter", f":{CHAIN} - [0:0]", f"-F {CHAIN}",
        f"-A {CHAIN} -d {host}/32 -p udp --dport {first}:{last} -j RETURN",
        f"-A {CHAIN} -d {host}/32 -j REJECT",
        f"-A {CHAIN} -m addrtype --dst-type LOCAL -j REJECT",
    ]
    if add_hook:
        terms.append(f"-I OUTPUT 1 -m owner --uid-owner {uid} -j {CHAIN}")
    return "\n".join([*terms, "COMMIT", ""])


def main() -> None:
    host = IPv4Address(json.loads(SETTINGS.read_bytes())["relay"])
    uid = getpwnam("turnserver").pw_uid
    ephemeral = tuple(map(int, Path("/proc/sys/net/ipv4/ip_local_port_range").read_text().split()))
    first, last = RELAY_PORTS
    sockets = subprocess.check_output(["ss", "-Huanp", f"sport >= :{first} and sport <= :{last}"], text=True)
    if any('"turnserver"' not in line for line in sockets.splitlines()):
        raise RuntimeError("Dedicated TURN UDP range is already in use by another service")
    hook = subprocess.run(
        ["iptables", "-w", "-C", "OUTPUT", "-m", "owner", "--uid-owner", str(uid), "-j", CHAIN],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    rules = filter_rules(host, uid, ephemeral, hook.returncode != 0)
    command = ["iptables-restore", "--wait", "--noflush"]
    subprocess.run([*command, "--test"], input=rules, text=True, check=True)
    subprocess.run(command, input=rules, text=True, check=True)


if __name__ == "__main__":
    main()

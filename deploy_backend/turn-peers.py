from ipaddress import IPv4Address, ip_address, ip_network
import re
import sys


BLOCKED_PEERS = (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
    "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16",
    "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
    "::1/128", "fc00::/7", "fe80::/10",
)


def deny_rules(relay: str, values: str) -> list[str]:
    relay_address = IPv4Address(relay)
    hosts = set()
    for value in re.split(r"[, \t]+", values.strip(" \t")):
        address = ip_address(value)
        if "%" in value:
            raise ValueError("Scoped peer addresses are not allowed")
        hosts.add(address)
    if len(hosts) < 2 or relay_address not in hosts:
        raise ValueError("TURN_DENY_IPS must list the relay and the other VPS address")
    networks = [ip_network(value) for value in BLOCKED_PEERS]
    ranges = [
        str(net.network_address) if net.num_addresses == 1 else f"{net.network_address}-{net.broadcast_address}"
        for net in networks
    ]
    return [f"denied-peer-ip={value}" for value in [*ranges, *map(str, sorted(hosts, key=lambda address: (address.version, int(address))))]]


if __name__ == "__main__":
    try:
        print(*deny_rules(sys.argv[1], sys.argv[2]), sep="\n")
    except ValueError as error:
        raise SystemExit("TURN_HOST must be an IPv4 address and TURN_DENY_IPS must list both VPS addresses") from error

import ipaddress
import json
import os
from pathlib import Path
import re
from string import Template
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit


SCOPES = {"main": 6380, "admin": 6381}
CONFIG_ROOT = Path("/etc/playtime-standby-redis")
DATA_ROOT = Path("/srv/playtime-standby-redis")
RUNTIME_UID = 12001


def primary(name, value):
    url = urlsplit(value)
    host = str(ipaddress.IPv4Address(url.hostname))
    user = unquote(url.username or "default")
    password = unquote(url.password or "")
    if url.scheme != "redis" or url.port != SCOPES[name] or url.query or url.fragment:
        raise ValueError(f"Unexpected Redis endpoint for {name}")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", user) or not re.fullmatch(r"[A-Za-z0-9_-]{24,512}", password):
        raise ValueError(f"Unsupported Redis credential format for {name}")
    route = json.loads(subprocess.check_output(["ip", "-json", "route", "get", host]))
    if len(route) != 1 or route[0].get("dev") != "ptwg0":
        raise ValueError(f"Redis primary for {name} must use the PlayTime WireGuard interface")
    source = str(ipaddress.IPv4Address(route[0].get("prefsrc")))
    return host, source, user, password


def write_config(path, contents):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as file:
        os.fchmod(file.fileno(), 0o600)
        file.write(contents)
        file.flush()
        os.fsync(file.fileno())
    os.replace(file.name, path)


def prepare_directory(path, uid):
    path.mkdir(mode=0o700, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Invalid Redis standby directory")
    os.chown(path, uid, uid)
    path.chmod(0o700)


def main():
    os.umask(0o077)
    sources = json.load(sys.stdin)
    if set(sources) != set(SCOPES):
        raise ValueError("Redis standby requires both source endpoints")
    configurations = {scope: primary(scope, sources[scope]) for scope in SCOPES}
    if len({value[:2] for value in configurations.values()}) != 1:
        raise ValueError("Both Redis endpoints must be on the same PlayTime primary")
    template = Template(Path(__file__).with_name("redis.conf.template").read_text())
    prepare_directory(CONFIG_ROOT, 0)
    prepare_directory(DATA_ROOT, 0)
    for scope, (host, source, user, password) in configurations.items():
        prepare_directory(DATA_ROOT / scope, RUNTIME_UID)
        config = template.substitute(
            REDIS_PRIMARY_HOST=host,
            REDIS_STANDBY_HOST=source,
            REDIS_PRIMARY_PORT=SCOPES[scope],
            REDIS_MASTER_USER=user,
            REDIS_MASTER_PASSWORD=password,
        )
        write_config(CONFIG_ROOT / f"{scope}.conf", config)
        print(f"Prepared private Redis standby configuration for {scope}")


if __name__ == "__main__":
    main()

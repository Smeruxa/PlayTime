import argparse
from io import BytesIO
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from cluster import load_profile, ssh_command


READ_SOURCES = """
import json
from pathlib import Path

root = Path("/etc/playtime-cluster/data")
sources = {
    "main": ("redis.env", "REDIS_URL"),
    "admin": ("admin-redis.env", "ADMIN_REDIS_URL"),
}
urls = {}
for scope, (file, expected_key) in sources.items():
    key, separator, url = (root / file).read_text().strip().partition("=")
    if key != expected_key or not separator or not url:
        raise SystemExit("Invalid Redis configuration on the primary")
    urls[scope] = url
print(json.dumps(urls))
"""

VERIFY_VERSION = (
    "version=$(docker run --rm --network none --entrypoint redis-server playtime/standby-redis:8.0.5 --version) && "
    "case \"$version\" in 'Redis server v=8.0.5 '*) printf '%s\\n' \"$version\" ;; *) exit 1 ;; esac"
)
REMOTE_ROOT = "/opt/playtime-standby-redis"


def archive():
    output = BytesIO()
    with tarfile.open(fileobj=output, mode="w") as bundle:
        for name in ("Dockerfile", "configure.py", "redis.conf.template", "playtime-standby-redis@.service"):
            bundle.add(HERE / name, arcname=name)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Install the two passive PlayTime Redis replicas")
    parser.add_argument("--profile", type=Path, default=HERE.parent / ".secrets/cluster.json")
    args = parser.parse_args()
    profile = load_profile(args.profile.resolve())
    primary = ssh_command(profile, "primary")
    secondary = ssh_command(profile, "secondary")
    prepare = (
        f"umask 077; install -d -m 700 {REMOTE_ROOT} && cd {REMOTE_ROOT} && tar -xf - && "
        "docker build --platform linux/amd64 -t playtime/standby-redis:8.0.5 . && " + VERIFY_VERSION
    )
    subprocess.run([*secondary, prepare], input=archive(), check=True)
    with subprocess.Popen([*primary, "python3 -c " + shlex.quote(READ_SOURCES)], stdout=subprocess.PIPE) as source:
        result = subprocess.run([*secondary, f"cd {REMOTE_ROOT} && python3 configure.py"], stdin=source.stdout)
        source.stdout.close()
        if source.wait() or result.returncode:
            raise SystemExit("Private Redis configuration transfer failed")
    units = "playtime-standby-redis@main.service playtime-standby-redis@admin.service"
    enable = (
        f"install -m 644 {REMOTE_ROOT}/playtime-standby-redis@.service /etc/systemd/system/ && "
        "systemd-analyze verify /etc/systemd/system/playtime-standby-redis@.service && "
        f"systemctl daemon-reload && systemctl enable {units} && systemctl restart {units}"
    )
    subprocess.run([*secondary, enable], check=True)


if __name__ == "__main__":
    main()

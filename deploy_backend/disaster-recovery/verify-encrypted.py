import argparse
import json
from pathlib import Path
import subprocess
import tarfile
from urllib.parse import urlsplit


CLUSTER_DB = "rootfs/var/lib/rancher/k3s/server/db/state.db"
CLUSTER_TOKEN = "rootfs/var/lib/rancher/k3s/server/token"
KUBERNETES = "kubernetes/playtime.json"


def inspect(archive: tarfile.TarFile, hostname: str) -> int:
    should_read = {
        CLUSTER_DB, CLUSTER_TOKEN, KUBERNETES,
        f"rootfs/etc/letsencrypt/live/{hostname}/privkey.pem",
        f"rootfs/etc/letsencrypt/live/{hostname}/cert.pem",
    }
    payloads = {}
    for item in archive:
        if item.name in should_read:
            if item.name in payloads or not item.isfile() or not 0 < item.size <= 256 * 1024 ** 2:
                raise ValueError("Unexpected encrypted recovery archive entry")
            with archive.extractfile(item) as stream:
                payloads[item.name] = stream.read()
    if set(payloads) != should_read:
        raise ValueError("Required encrypted recovery members are missing")
    if not payloads[CLUSTER_DB].startswith(b"SQLite format 3\x00") or len(payloads[CLUSTER_TOKEN]) < 20:
        raise ValueError("K3s state and token are incomplete")
    resources = json.loads(payloads[KUBERNETES])["items"]
    namespace = {obj["kind"] for obj in resources if obj["metadata"].get("namespace") == "playtime"}
    if not {"StatefulSet", "Secret", "ConfigMap", "PersistentVolumeClaim"}.issubset(namespace):
        raise ValueError("A required PlayTime Kubernetes resource kind is missing")
    certificate = subprocess.check_output(
        ["openssl", "x509", "-noout", "-pubkey"], input=payloads[f"rootfs/etc/letsencrypt/live/{hostname}/cert.pem"]
    )
    private_public = subprocess.check_output(
        ["openssl", "pkey", "-pubout"], input=payloads[f"rootfs/etc/letsencrypt/live/{hostname}/privkey.pem"]
    )
    if certificate != private_public:
        raise ValueError("The recovery TLS private key does not match its certificate")
    return len(resources)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect the encrypted recovery archive without writing plaintext data")
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--age", default="age")
    parser.add_argument("archive", help="Encrypted archive file, or - to read from standard input")
    args = parser.parse_args()
    host = urlsplit("https://" + args.hostname)
    if host.hostname != args.hostname:
        parser.error("--hostname must be a hostname only")
    command = [args.age, "--decrypt", "--identity", str(args.identity), args.archive]
    with subprocess.Popen(command, stdout=subprocess.PIPE) as decryption:
        with tarfile.open(fileobj=decryption.stdout, mode="r|gz") as archive:
            resource_count = inspect(archive, args.hostname)
        for _ in iter(lambda: decryption.stdout.read(1024 * 1024), b""):
            pass
        if decryption.wait():
            raise RuntimeError("Recovery ciphertext authentication failed")
    print(f"Verified encrypted K3s state, token, {resource_count} Kubernetes objects and matching PlayTime TLS key.")


if __name__ == "__main__":
    main()

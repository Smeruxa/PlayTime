#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${TURN_HOST:-}" ]]; then
    echo "Задайте TURN_HOST с публичным адресом TURN-сервера."
    exit 1
fi
: "${TURN_DENY_IPS:?Укажите публичные IP обеих VPS в TURN_DENY_IPS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DENIED_PEERS="$(python3 "$SCRIPT_DIR/turn-peers.py" "$TURN_HOST" "$TURN_DENY_IPS")"
TURN_REALM="${TURN_REALM:-smeruxa.ru}"
TURN_SECRET="${TURN_SECRET:-$(openssl rand -hex 24)}"
MIN_PORT=62000
MAX_PORT=62999

echo "Installing coturn..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn iptables ufw

install -d -m 700 /etc/playtime
install -d -m 755 /etc/systemd/system/coturn.service.d /usr/local/lib
install -m 755 "$SCRIPT_DIR/turn-peer-firewall.py" /usr/local/lib/playtime-turn-peer-firewall.py
install -m 644 "$SCRIPT_DIR/systemd/turn-peer-firewall.conf" /etc/systemd/system/coturn.service.d/playtime-peer-firewall.conf
(umask 077; printf '{"relay":"%s"}\n' "$TURN_HOST" > /etc/playtime/turn-peer-firewall.json)

echo "Configuring /etc/turnserver.conf..."
cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=${TURN_HOST}
external-ip=${TURN_HOST}
realm=${TURN_REALM}
server-name=${TURN_REALM}
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
user-quota=32
total-quota=256
max-bps=2000000
bps-capacity=512000000
${DENIED_PEERS}
allowed-peer-ip=${TURN_HOST}
no-tcp-relay
no-cli
no-loopback-peers
no-multicast-peers
min-port=${MIN_PORT}
max-port=${MAX_PORT}
syslog
no-stdout-log
EOF

chown root:turnserver /etc/turnserver.conf
chmod 640 /etc/turnserver.conf
install -d -m 700 /etc/playtime
(umask 077; printf 'WEBRTC_TURN_SECRET=%s\n' "$TURN_SECRET" > /etc/playtime/turn.env)

sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
grep -q 'TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn

echo "Opening firewall ports (if ufw active)..."
ufw allow 3478/udp 2>/dev/null || true
ufw allow 3478/tcp 2>/dev/null || true
ufw allow 5349/tcp 2>/dev/null || true
ufw allow "${MIN_PORT}:${MAX_PORT}/udp" 2>/dev/null || true

systemctl daemon-reload
systemctl enable coturn
systemctl restart coturn

echo ""
echo "=== TURN ready ==="
echo "WEBRTC_TURN_HOST=${TURN_HOST}:3478"
echo "Secret saved to /etc/playtime/turn.env; merge it into the API runtime and migration environments without printing it."
echo "WEBRTC_STUN_URLS=stun:${TURN_HOST}:3478"
echo ""
systemctl is-active coturn

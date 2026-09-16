#!/usr/bin/env bash
# Installe Djima comme service systemd sur un serveur Linux (deploiement sans Docker).
# A executer avec les droits root depuis la racine du projet apres "npm install".
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="${1:-djima}"
UNIT_PATH="/etc/systemd/system/djima.service"

if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/data"

cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Djima - transcodage et correction de fichiers pour playout
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/src/server.js
Restart=on-failure
Environment=PORT=4590

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now djima.service

echo "Djima installe et demarre. Verifiez avec: systemctl status djima"

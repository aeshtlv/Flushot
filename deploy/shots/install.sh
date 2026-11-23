#!/bin/bash
# Install the screenshot upload endpoint on the web server.
#
# Idempotent: running it twice changes nothing. Every file it touches is either
# copied from this directory or edited in a way it can recognise as already done.
#
# It is deliberately separate from deploy-site.sh. That script publishes the page
# from git and knows nothing about the uploader; this one sets up server software
# and runs perhaps three times in the life of the server.
#
# Usage, from the directory holding these files (run as root):
#
#   bash install.sh
#
# What it creates:
#
#   /var/lib/flushot-shots/          the pictures, owned by nginx, 0750
#   /var/www/flushot-shots/          the "link expired" page
#   /usr/local/lib/flushot/          the uploader itself
#   /etc/nginx/flushot-shots-locations.conf
#   /etc/nginx/conf.d/00-flushot-shots-zones.conf
#   systemd units: flushot-shots.service, flushot-shots-sweep.{service,timer}
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SHOTS_DIR=/var/lib/flushot-shots
STATIC_DIR=/var/www/flushot-shots
LIB_DIR=/usr/local/lib/flushot
NGINX_SITE=/etc/nginx/conf.d/flushot.ink.conf
INCLUDE_LINE='    include /etc/nginx/flushot-shots-locations.conf;'

[ "$(id -u)" = "0" ] || { echo "run as root"; exit 1; }

for file in shot-server.py expired.html nginx-locations.conf nginx-zones.conf \
            flushot-shots.service flushot-shots-sweep.service flushot-shots-sweep.timer; do
    [ -f "$HERE/$file" ] || { echo "missing $file next to this script"; exit 1; }
done

echo "==> directories"
install -d -o nginx -g nginx -m 0750 "$SHOTS_DIR"
install -d -o root -g root -m 0755 "$STATIC_DIR"
install -d -o root -g root -m 0755 "$LIB_DIR"

echo "==> files"
install -o root -g root -m 0755 "$HERE/shot-server.py" "$LIB_DIR/shot-server.py"
install -o root -g root -m 0644 "$HERE/expired.html" "$STATIC_DIR/expired.html"

echo "==> systemd units"
install -o root -g root -m 0644 "$HERE/flushot-shots.service" /etc/systemd/system/flushot-shots.service
install -o root -g root -m 0644 "$HERE/flushot-shots-sweep.service" /etc/systemd/system/flushot-shots-sweep.service
install -o root -g root -m 0644 "$HERE/flushot-shots-sweep.timer" /etc/systemd/system/flushot-shots-sweep.timer
systemctl daemon-reload
systemctl enable --now flushot-shots.service >/dev/null
systemctl enable --now flushot-shots-sweep.timer >/dev/null

echo "==> nginx"
install -o root -g root -m 0644 "$HERE/nginx-locations.conf" /etc/nginx/flushot-shots-locations.conf
# The `00-` prefix matters: nginx parses in order and the rate-limit zone has to be
# declared before the server block that uses it.
install -o root -g root -m 0644 "$HERE/nginx-zones.conf" /etc/nginx/conf.d/00-flushot-shots-zones.conf

# Either form counts as present: the plain path this script used to write, or the glob the
# repository ships. Both make nginx read the same file, and including it twice is a fatal error.
if grep -qE '^[[:space:]]*include[[:space:]]+/etc/nginx/flushot-shots-locations[^;]*;' "$NGINX_SITE"; then
    echo "    the server block already includes the upload rules"
else
    # Inserted before the access_log line, which appears exactly once in the file —
    # `flushot-security.conf` is included several times and would have been the wrong
    # anchor.
    #
    # Done with awk and not sed: the line being inserted contains slashes, and every
    # sed form that takes a replacement string with slashes needs them escaped. The
    # first version of this script put the path straight into `sed s//…/` and the
    # expression broke, leaving the include out while the script reported progress.
    cp "$NGINX_SITE" "$NGINX_SITE.bak-shots"
    if ! grep -qE '^[[:space:]]*access_log /var/log/nginx/flushot\.access\.log;' "$NGINX_SITE"; then
        echo "    cannot find where to add the include; the site config changed"
        exit 1
    fi
    awk -v line="$INCLUDE_LINE" '
        !added && /^[[:space:]]*access_log \/var\/log\/nginx\/flushot\.access\.log;/ {
            print line
            added = 1
        }
        { print }
    ' "$NGINX_SITE.bak-shots" > "$NGINX_SITE"
    if ! grep -qE '^[[:space:]]*include[[:space:]]+/etc/nginx/flushot-shots-locations[^;]*;' "$NGINX_SITE"; then
        echo "    the include was not added; restoring the backup"
        cp "$NGINX_SITE.bak-shots" "$NGINX_SITE"
        exit 1
    fi
    echo "    added the include (backup: $NGINX_SITE.bak-shots)"
fi

echo "==> checking the configuration"
nginx -t
systemctl reload nginx

echo "==> state"
systemctl is-active flushot-shots.service || true
systemctl is-active flushot-shots-sweep.timer || true
python3 "$LIB_DIR/shot-server.py" --health || true

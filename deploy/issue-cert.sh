#!/bin/bash
# Issue the Let's Encrypt certificate for flushot.ink once DNS points here.
#
# Run only after `flushot.ink` resolves to this server in *public* DNS: Let's
# Encrypt validates the domain over the internet, so it follows the registrar's
# records, not this machine's /etc/hosts. Running it early fails with a challenge
# error, which is harmless but counts against the rate limit.
#
# Why DNS-over-HTTPS instead of `getent`/`dig`: /etc/hosts on this machine maps
# flushot.ink to 127.0.0.1-style local addresses (the hostname is the domain), so
# a local lookup always "succeeds" and proves nothing.
#
# Usage: bash /root/issue-cert.sh [email]
set -euo pipefail

DOMAIN=flushot.ink
EMAIL="${1:-shatilov.a.e@mail.ru}"

PUBLIC_IP=$(curl -s --max-time 15 https://api.ipify.org || true)
# `|| true` matters: when the record is absent, grep finds nothing and exits 1,
# and with `set -e` that would kill the script before it could explain itself.
RESOLVED=$(curl -s --max-time 15 -H 'accept: application/dns-json' \
    "https://1.1.1.1/dns-query?name=$DOMAIN&type=A" \
    | tr ',' '\n' | grep -o '"data":"[0-9.]*"' | head -1 | cut -d'"' -f4 || true)

echo "this server : ${PUBLIC_IP:-unknown}"
echo "$DOMAIN     : ${RESOLVED:-unresolved} (public DNS via 1.1.1.1)"

if [ -z "$RESOLVED" ] || [ "$RESOLVED" != "$PUBLIC_IP" ]; then
    echo
    echo "STOP: $DOMAIN does not point at this server yet."
    echo "Set the A record at the registrar to $PUBLIC_IP, wait for it to"
    echo "propagate, then run this script again."
    exit 1
fi

certbot --nginx \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos \
    --email "$EMAIL" \
    --redirect \
    --keep-until-expiring

nginx -t && systemctl reload nginx
echo
certbot certificates -d "$DOMAIN" 2>/dev/null | sed -n '1,20p'

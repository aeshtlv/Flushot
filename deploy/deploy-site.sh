#!/bin/bash
# Deploy the Flushot landing page to /var/www/flushot.ink.
#
# The site is taken from the GitHub repository, not from this machine: the repo
# is the single source of truth, and a deploy should not depend on someone
# remembering which local copy was current.
#
# Layout:
#   /var/www/releases/flushot.ink-<stamp>/   one directory per deploy
#   /var/www/flushot.ink                     symlink -> current release
#
# nginx serves from the symlink. A deploy builds the new tree in a temporary
# directory, then swaps the symlink with a single atomic rename, so there is no
# moment when the site is half-written or missing. The last three releases stay
# on disk; rollback is one command (see the end of this file).
#
# Usage:
#   bash /root/deploy-site.sh              # deploy main
#   bash /root/deploy-site.sh <branch>     # deploy another branch or tag
set -euo pipefail

REPO=aeshtlv/Flushot
BRANCH="${1:-main}"
WEB=/var/www/flushot.ink
RELEASES=/var/www/releases
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$RELEASES/flushot.ink-$STAMP"
KEEP=3

echo "==> fetching $REPO@$BRANCH"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --max-time 120 \
    "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" \
    -o "$TMP/repo.tar.gz"
tar -xzf "$TMP/repo.tar.gz" -C "$TMP"
SRC=$(find "$TMP" -maxdepth 1 -type d -name 'Flushot-*' | head -1)
[ -d "$SRC/site" ] || { echo "no site/ in the archive"; exit 1; }

echo "==> staging $TARGET"
mkdir -p "$RELEASES"
cp -a "$SRC/site" "$TARGET"

# The publishing notes are for whoever edits the page, not for visitors.
rm -f "$TARGET/КАК ОПУБЛИКОВАТЬ.txt"

# Sanity: a deploy that ships an empty or truncated page must fail loudly here,
# not in a browser.
[ -s "$TARGET/index.html" ] || { echo "index.html is missing or empty"; exit 1; }
grep -q 'flushot.ink' "$TARGET/index.html" || {
    echo "index.html does not mention flushot.ink — wrong branch?"
    exit 1
}
chown -R nginx:nginx "$TARGET"
chmod -R a+rX "$TARGET"

echo "==> switching the symlink"
ln -sfn "$TARGET" "$WEB.new"
mv -T "$WEB.new" "$WEB"

# Keep a few releases for rollback, drop the rest.
ls -1dt "$RELEASES"/flushot.ink-* | tail -n +$((KEEP + 1)) | xargs -r rm -rf

COUNT=$(find "$TARGET" -type f | wc -l)
SIZE=$(du -sh "$TARGET" | cut -f1)
echo "==> live: $COUNT files, $SIZE, from $BRANCH"

curl -s -o /dev/null -w "==> local check: HTTP %{http_code}\n" \
    -H 'Host: flushot.ink' http://127.0.0.1/ || true

cat <<'EOF'

Rollback:
  ls -1dt /var/www/releases/flushot.ink-*
  ln -sfn /var/www/releases/flushot.ink-<stamp> /var/www/flushot.ink.new
  mv -T /var/www/flushot.ink.new /var/www/flushot.ink
EOF

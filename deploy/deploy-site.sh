#!/bin/bash
# Deploy the Flushot landing page to /var/www/flushot.ink.
#
# The site is taken from the GitHub repository, not from this machine: the repo
# is the single source of truth, and a deploy should not depend on someone
# remembering which local copy was current.
#
# It comes from the `site` branch, not `main`: the program repository keeps no
# landing page. This script and the nginx configs stay in `main`, because they
# are server infrastructure rather than page content.
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
#   bash /root/deploy-site.sh              # deploy the site branch
#   bash /root/deploy-site.sh <branch>     # deploy another branch or tag
set -euo pipefail

REPO=aeshtlv/Flushot
BRANCH="${1:-site}"
WEB=/var/www/flushot.ink
RELEASES=/var/www/releases
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$RELEASES/flushot.ink-$STAMP"
KEEP=3

echo "==> resolving $REPO@$BRANCH"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

resolve_sha() {
    curl -fsSL --max-time 60 "https://api.github.com/repos/$REPO/commits/$BRANCH" \
        | sed -n 's/^[[:space:]]*"sha": "\([0-9a-f]\{40\}\)",$/\1/p' \
        | head -1
}

# The branch head, resolved to a SHA first. Fetching the branch *archive* directly
# is served from a cache that lags several minutes behind a push, so a deploy run
# right after one silently installs the previous commit.
SHA=$(resolve_sha)
[ -n "$SHA" ] || { echo "could not resolve $BRANCH to a commit"; exit 1; }

# And the API itself is a few seconds behind a push. If the head still equals what
# this script last published, the usual cause is a deploy run the moment after a
# push, not a genuine "nothing changed" — so wait for the head to move before
# deciding. Twenty seconds covers the observed lag; the wait is announced, and a
# head that never moves simply resolves to the same commit and deploys as asked.
LAST_SHA_FILE=/var/lib/flushot-last-deployed
if [ -f "$LAST_SHA_FILE" ] && [ "$(cat "$LAST_SHA_FILE")" = "$SHA" ]; then
    echo "==> $BRANCH is still at $(echo "$SHA" | cut -c1-7), waiting up to 20s for a newer commit"
    for _ in $(seq 1 10); do
        sleep 2
        NEW=$(resolve_sha)
        [ -n "$NEW" ] && [ "$NEW" != "$SHA" ] || continue
        SHA="$NEW"
        echo "==> moved to $(echo "$SHA" | cut -c1-7)"
        break
    done
fi

echo "==> fetching $REPO@$BRANCH ($(echo "$SHA" | cut -c1-7))"
curl -fsSL --max-time 120 \
    "https://codeload.github.com/$REPO/tar.gz/$SHA" \
    -o "$TMP/repo.tar.gz"
tar -xzf "$TMP/repo.tar.gz" -C "$TMP"

# The archive unpacks into Flushot-<commit>, so this is proof that what is about to
# be published is the commit that was just resolved.
SRC="$TMP/Flushot-$SHA"
[ -d "$SRC/site" ] || { echo "the archive is not commit $SHA"; exit 1; }

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
mkdir -p "$(dirname "$LAST_SHA_FILE")"
echo "$SHA" > "$LAST_SHA_FILE"
echo "==> live: $COUNT files, $SIZE, from $BRANCH at $(echo "$SHA" | cut -c1-7)"

curl -s -o /dev/null -w "==> local check: HTTP %{http_code}\n" \
    -H 'Host: flushot.ink' http://127.0.0.1/ || true

cat <<'EOF'

Rollback:
  ls -1dt /var/www/releases/flushot.ink-*
  ln -sfn /var/www/releases/flushot.ink-<stamp> /var/www/flushot.ink.new
  mv -T /var/www/flushot.ink.new /var/www/flushot.ink
EOF

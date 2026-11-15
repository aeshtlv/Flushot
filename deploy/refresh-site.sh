#!/bin/bash
# Deploy the landing page only when the `site` branch has actually moved.
#
# Run from cron. `deploy-site.sh` on its own always publishes, which for an hourly
# schedule would rebuild an identical tree sixty times a day and rotate the three
# kept releases every hour. This compares the branch head with what was last
# deployed and exits quietly when they match, so the page follows `site` within the
# half hour while the server does nothing in between.
#
# The counter on the page is written by `.github/workflows/stats.yml`, which commits
# to the `site` branch once a day; this closes the last manual step in that chain.
set -euo pipefail

LAST=/var/lib/flushot-last-deployed
LOG=/var/log/flushot-refresh.log
REPO=aeshtlv/Flushot

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

SHA=$(curl -fsSL --max-time 60 "https://api.github.com/repos/$REPO/commits/site" \
    | sed -n 's/^[[:space:]]*"sha": "\([0-9a-f]\{40\}\)",$/\1/p' \
    | head -1) || true

if [ -z "${SHA:-}" ]; then
    echo "$(stamp) could not resolve site, leaving the page alone" >> "$LOG"
    exit 0
fi

if [ -f "$LAST" ] && [ "$(cat "$LAST")" = "$SHA" ]; then
    # Nothing new. Silence keeps the log readable: 48 no-op lines a day would drown
    # the entries that matter.
    exit 0
fi

echo "$(stamp) site moved to $(echo "$SHA" | cut -c1-7), deploying" >> "$LOG"
if bash /root/deploy-site.sh >> "$LOG" 2>&1; then
    echo "$(stamp) deployed $(echo "$SHA" | cut -c1-7)" >> "$LOG"
else
    echo "$(stamp) DEPLOY FAILED for $(echo "$SHA" | cut -c1-7)" >> "$LOG"
    exit 1
fi

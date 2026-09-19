#!/bin/bash
#
# Explicit, separate switch-on step — kept apart from install.sh so re-running
# install.sh (e.g. to push an updated binary) never risks flipping an
# already-provisioned robot's live mode by accident. Idempotent: safe to
# re-run at any time.
#
# Usage: ./activate.sh <robot-ip-or-host>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

HOST="${1:?usage: activate.sh <robot-ip-or-host>}"
REMOTE="root@$HOST"

ssh "${SSH_OPTS[@]}" "$REMOTE" '/userdata/valetudo/S96valetudo start'
sleep 2
ssh "${SSH_OPTS[@]}" "$REMOTE" '/userdata/valetudo/karcher-cloud-switch.sh valetudo'

echo "activated valetudo mode on $HOST — verify the map/controls work at http://$HOST"
echo "undo with: ssh $REMOTE /userdata/valetudo/karcher-cloud-switch.sh cloud"

#!/bin/sh
#
# Real boot-time logic, invoked (not sourced) by auto_reboot.sh — see that
# file's own header for why the split exists. Only acts when the last
# explicit `karcher-cloud-switch.sh` call chose valetudo mode; anything else
# (mode file absent, empty, or corrupted) leaves the robot fully stock.
#
# Deploy to /userdata/valetudo/boot-hook.sh.
#

set -u

MODE_FILE=/userdata/valetudo/mode
MODE="cloud"
[ -r "$MODE_FILE" ] && MODE="$(cat "$MODE_FILE" 2>/dev/null)"

[ "$MODE" = "valetudo" ] || exit 0

[ -x /userdata/valetudo/S96valetudo ] && /userdata/valetudo/S96valetudo start
sleep 5
[ -x /userdata/valetudo/karcher-cloud-switch.sh ] && /userdata/valetudo/karcher-cloud-switch.sh valetudo

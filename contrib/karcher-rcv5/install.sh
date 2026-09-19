#!/bin/bash
#
# Idempotent staging for a freshly-rooted RCV5: pushes the Valetudo binary,
# wrapper scripts, dev certs, and the boot trampoline. Never touches
# config.json/device-identity.json/mode if they already exist (those hold
# state this script has no business overwriting). Ends with the robot still
# in stock/cloud behavior — run activate.sh separately to switch it live.
#
# Runs on the Mac, drives the robot over ssh/scp. Usage: ./install.sh <robot-ip-or-host>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../device-originals-backup"
. "$SCRIPT_DIR/lib.sh"

HOST="${1:?usage: install.sh <robot-ip-or-host>}"
REMOTE="root@$HOST"
REMOTE_DIR=/userdata/valetudo
BINARY="$REPO_ROOT/build/armv7/valetudo"

[ -f "$BINARY" ] || { echo "ERROR: $BINARY not found — build it first" >&2; exit 1; }

report_runtime_state() {
    ssh "${SSH_OPTS[@]}" "$REMOTE" "for f in config.json device-identity.json mode; do
        if [ -f $REMOTE_DIR/\$f ]; then echo \"  \$f: present\"; else echo \"  \$f: absent\"; fi
    done"
}

echo "== Pre-flight =="
ssh "${SSH_OPTS[@]}" "$REMOTE" "command -v mkdir mv cmp cat >/dev/null" \
    || { echo "ERROR: robot is missing an expected coreutils/busybox applet" >&2; exit 1; }

AVAIL_KB=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "df /userdata | tail -1 | awk '{print \$4}'")
if [ "$AVAIL_KB" -lt 51200 ]; then
    echo "ERROR: only ${AVAIL_KB}KB free on /userdata, need at least 50MB" >&2
    exit 1
fi
echo "OK: ${AVAIL_KB}KB free on /userdata"

echo "== Pre-existing runtime state (never touched by this script) =="
report_runtime_state

ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p $REMOTE_DIR /userdata/cfg/rockchip_test"

echo "== Pushing executables =="
for name in S96valetudo karcher-cloud-switch.sh boot-hook.sh aiot-gate.sh; do
    scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/$name" "$REMOTE:$REMOTE_DIR/$name.new"
    ssh "${SSH_OPTS[@]}" "$REMOTE" "mv $REMOTE_DIR/$name.new $REMOTE_DIR/$name && chmod +x $REMOTE_DIR/$name"
done

echo "== Pushing dev certs =="
for name in server_v1.crt server.key; do
    scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/$name" "$REMOTE:$REMOTE_DIR/$name.new"
    ssh "${SSH_OPTS[@]}" "$REMOTE" "mv $REMOTE_DIR/$name.new $REMOTE_DIR/$name"
done

echo "== Pushing boot trampoline (sourced by the vendor's S99_auto_reboot) =="
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/auto_reboot.sh" "$REMOTE:/userdata/cfg/rockchip_test/auto_reboot.sh.new"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mv /userdata/cfg/rockchip_test/auto_reboot.sh.new /userdata/cfg/rockchip_test/auto_reboot.sh"
# Durable copy under /userdata/valetudo/, outside /data/cfg/ (which a GPIO recovery-key
# reset clears): aiot-gate.sh's deadline fallback restores the trampoline from here if
# a reset ever wipes the deployed copy above, without needing this laptop involved.
ssh "${SSH_OPTS[@]}" "$REMOTE" "cp /userdata/cfg/rockchip_test/auto_reboot.sh $REMOTE_DIR/auto_reboot.sh"

echo "== Pushing + verifying Valetudo binary (34MB, may take a while) =="
scp "${SSH_OPTS[@]}" "$BINARY" "$REMOTE:$REMOTE_DIR/valetudo.new"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mv $REMOTE_DIR/valetudo.new $REMOTE_DIR/valetudo && chmod +x $REMOTE_DIR/valetudo"
TMP_VERIFY="$(mktemp)"
trap 'rm -f "$TMP_VERIFY"' EXIT
scp "${SSH_OPTS[@]}" "$REMOTE:$REMOTE_DIR/valetudo" "$TMP_VERIFY"
if cmp -s "$BINARY" "$TMP_VERIFY"; then
    echo "OK: on-device binary matches $BINARY exactly"
else
    echo "ERROR: on-device binary does NOT match local build — transfer likely corrupted, re-run install.sh" >&2
    exit 1
fi

echo "== Ensuring irreplaceable backups exist on-device (robot stays fully stock — no mode change happens here) =="
ssh "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_DIR/karcher-cloud-switch.sh backup"

echo "== Pulling backups to $BACKUP_DIR (durable off-device copy, survives a factory reset) =="
mkdir -p "$BACKUP_DIR"
for name in etc-hosts.orig server.crt.orig gdroot-g2.crt.orig; do
    TMP_FETCH="$(mktemp)"
    scp "${SSH_OPTS[@]}" "$REMOTE:/userdata/$name" "$TMP_FETCH"
    if [ -f "$BACKUP_DIR/$name" ]; then
        if cmp -s "$BACKUP_DIR/$name" "$TMP_FETCH"; then
            echo "OK: $name matches existing local backup"
        else
            echo "ERROR: $name from $HOST differs from the existing local backup at $BACKUP_DIR/$name — NOT overwriting." >&2
            echo "This usually means you're pointing at a different physical unit than the one that backup came from. Review both by hand." >&2
            rm -f "$TMP_FETCH"
            exit 1
        fi
    else
        mv "$TMP_FETCH" "$BACKUP_DIR/$name"
        echo "saved: $BACKUP_DIR/$name"
    fi
    rm -f "$TMP_FETCH" 2>/dev/null || true
done

echo "== Pulling wifi-deamon.sh.orig if present (aiot-gate.sh patch's own backup) =="
if ssh "${SSH_OPTS[@]}" "$REMOTE" "[ -f /userdata/wifi-deamon.sh.orig ]"; then
    TMP_FETCH="$(mktemp)"
    scp "${SSH_OPTS[@]}" "$REMOTE:/userdata/wifi-deamon.sh.orig" "$TMP_FETCH"
    if [ -f "$BACKUP_DIR/wifi-deamon.sh.orig" ]; then
        if cmp -s "$BACKUP_DIR/wifi-deamon.sh.orig" "$TMP_FETCH"; then
            echo "OK: wifi-deamon.sh.orig matches existing local backup"
        else
            echo "ERROR: wifi-deamon.sh.orig from $HOST differs from the existing local backup at $BACKUP_DIR/wifi-deamon.sh.orig — NOT overwriting." >&2
            echo "This usually means you're pointing at a different physical unit than the one that backup came from. Review both by hand." >&2
            rm -f "$TMP_FETCH"
            exit 1
        fi
    else
        mv "$TMP_FETCH" "$BACKUP_DIR/wifi-deamon.sh.orig"
        echo "saved: $BACKUP_DIR/wifi-deamon.sh.orig"
    fi
    rm -f "$TMP_FETCH" 2>/dev/null || true
else
    echo "not yet present on-device (aiot-gate.sh patch hasn't run there yet) — nothing to pull"
fi

echo "== Post-install runtime state (should be unchanged from pre-existing) =="
report_runtime_state

echo
echo "install.sh complete. Robot is still in stock/cloud mode — nothing has been redirected."
echo "Run ./activate.sh $HOST when you're ready to switch it into valetudo mode."

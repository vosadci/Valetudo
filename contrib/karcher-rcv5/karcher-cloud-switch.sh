#!/bin/sh
# karcher-cloud-switch.sh — toggle the RCV5 between its real 3irobotix cloud and a
# local Valetudo dummycloud. Deploy to /userdata/valetudo/karcher-cloud-switch.sh
# (deliberately not under /userdata/config/, which a WiFi-reset button press wipes).
#
# The three *.orig backups this script creates (HOSTS_BACKUP/CERT_BACKUP/GDROOT_BACKUP)
# are the ONLY record of the device's original, pre-Valetudo state. They must also be
# copied off-device somewhere durable — /userdata is wiped by a factory reset
# (/oem/bin/upgrade's wipe_userdata(), see project_rcv5_factory_reset_partitions
# memory), which would make reverting to stock impossible if these were the only copy.
#
# STATUS: the cert-swap half (server.crt) is the mechanism a prior session proved live
# end-to-end (fake HTTP login + fake MQTT broker, zero real-cloud contact). The
# /etc/hosts bind-mount redirect below is NEW this session, reasoned out from static
# analysis of the extracted I3.12.90 rootfs (nsswitch.conf: "hosts: files dns" — /etc/hosts
# is consulted before DNS; busybox.config has no CONFIG_IPTABLES and no separate iptables
# binary exists, so there is no DNAT capability; CONFIG_FEATURE_MOUNT_FLAGS=y confirms
# busybox mount supports "-o bind"). It has NOT been run against the real device yet.
# An earlier draft of this script used `route add -host`, which is wrong: the kernel
# routing table has no bearing on hostname resolution — that happens in userspace via
# /etc/hosts, which lives on the read-only squashfs root and can't be edited directly,
# hence the bind-mount. Smoke-test this on the device (mode + revert) before relying on it.
#
# The gdroot-g2.crt half (RobotApp's own, separately-linked curl/OpenSSL CA trust
# bundle — a real 128-cert standard bundle despite the "gdroot" name) was added after
# live testing found map uploads silently fail without it: RobotApp performs the real
# S3 PUT itself (not aiot_client), using its own curl instance, which validates against
# this file independently of the server.crt swap above. Confirmed live 2026-09-18 (see
# project_rcv5_valetudo_step7_live_confirmed memory).
#
# Every step here is reversible: `cloud` mode restores the original hosts file, cert,
# and CA bundle, and the undo for `valetudo` mode is simply running `cloud` again.

set -eu

HOSTS_BACKUP="/userdata/etc-hosts.orig"
HOSTS_VALETUDO="/userdata/etc-hosts.valetudo"
CERT_BACKUP="/userdata/server.crt.orig"
CERT_TARGET_OEM="/oem/sysconf/server.crt"
CERT_TARGET_USERDATA="/userdata/config/server.crt"
CERT_VALETUDO="/userdata/valetudo/server_v1.crt"
GDROOT_BACKUP="/userdata/gdroot-g2.crt.orig"
GDROOT_TARGET="/oem/sysconf/gdroot-g2.crt"
# Read only by boot-hook.sh on the next boot — this script never reads it back
# for its own logic, it's still driven purely by the CLI arg below.
MODE_FILE="/userdata/valetudo/mode"

HOST_A="eu-cdndevaiot.3irobotix.net"
HOST_B="eu-gamqttaiot.3irobotix.net"
VALETUDO_IP="127.0.13.38"

restart_aiot_client() {
    killall aiot_client.bin 2>/dev/null || true
    # wifi-deamon.sh's existing supervisor relaunches it; no separate start needed.
}

restart_robotapp_stack() {
    # RobotApp needs to reload gdroot-g2.crt to pick up the CA bundle change, but
    # `killall RobotApp` alone does NOT trigger a respawn (confirmed live this
    # session) despite Monitor supposedly supervising it. `killall Monitor` does:
    # it triggers Monitor-deamon.sh's own designed self-heal path, which kills the
    # whole app stack (AuxCtrl/everest-server/RobotApp/log-server/Tesla) and
    # restarts Monitor, which relaunches everything.
    killall Monitor 2>/dev/null || true
}

# Waits (polling, not a blind sleep) for a process to reappear after a restart.
# Uses `pidof` rather than parsing `ps` output, since this session already hit
# one `ps`-related false negative ("ps was not showing all processes") while
# debugging live — not yet confirmed whether `pidof` itself is present/reliable
# on this device's busybox build, so treat this as part of what the pending
# on-device smoke test needs to confirm.
wait_for_process() {
    name="$1"
    timeout="${2:-10}"
    elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if pidof "$name" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    return 1
}

# --- Verification: confirm each change actually took effect, not just that the
# commands that should produce it exited 0. Added after this session's own
# experience with silent failures (killall RobotApp looking fine but not
# respawning; cdnDomain/id fields being silently wrong) made "the command ran"
# an unreliable signal on this device.

verify_hosts() {
    # expected="$1": the source hosts file that should now be bind-mounted live.
    # Content comparison only — no `mountpoint -q` precheck. Confirmed live
    # 2026-09-18 that `mountpoint` gives false negatives for FILE bind mounts on
    # this device (matching its documented directory-only reliability), even
    # though the bind mount itself was genuinely active (verified independently
    # via matching inode numbers between /etc/hosts and its bind-mount source).
    if ! cmp -s "$1" /etc/hosts; then
        echo "VERIFY FAILED: /etc/hosts content does not match $1" >&2
        exit 1
    fi
}

verify_cert() {
    # expected="$1": the source cert file both targets should now match exactly.
    if ! cmp -s "$1" "$CERT_TARGET_OEM"; then
        echo "VERIFY FAILED: $CERT_TARGET_OEM does not match $1" >&2
        exit 1
    fi
    if ! cmp -s "$1" "$CERT_TARGET_USERDATA"; then
        echo "VERIFY FAILED: $CERT_TARGET_USERDATA does not match $1" >&2
        exit 1
    fi
}

verify_gdroot_valetudo() {
    if ! cat "$GDROOT_BACKUP" "$CERT_VALETUDO" | cmp -s - "$GDROOT_TARGET"; then
        echo "VERIFY FAILED: $GDROOT_TARGET is not (gdroot backup + dev cert)" >&2
        exit 1
    fi
}

verify_gdroot_cloud() {
    if ! cmp -s "$GDROOT_BACKUP" "$GDROOT_TARGET"; then
        echo "VERIFY FAILED: $GDROOT_TARGET does not match $GDROOT_BACKUP" >&2
        exit 1
    fi
}

verify_processes_restarted() {
    if ! wait_for_process aiot_client.bin 10; then
        echo "VERIFY FAILED: aiot_client.bin did not respawn within 10s" >&2
        exit 1
    fi
    if ! wait_for_process RobotApp 20; then
        echo "VERIFY FAILED: RobotApp did not respawn within 20s of killall Monitor" >&2
        exit 1
    fi
}

switch_hosts() {
    # Idempotent: unconditionally strip every existing bind-mount layer before
    # adding the new one, rather than gating on `mountpoint -q` first. Found
    # live 2026-09-18: `mountpoint` is documented to be unreliable for FILE
    # bind mounts (its device/inode heuristic is built for directories), so the
    # old `if mountpoint -q ...; then umount; fi` guard was silently never
    # firing — confirmed live by 3 stacked bind-mount layers for /etc/hosts in
    # /proc/mounts, one per script run, never unmounted. Looping `umount` until
    # it fails is safe: once every bind layer we added is gone, the next
    # attempt hits plain /etc/hosts (part of the already-mounted rootfs, not
    # its own mountpoint) and fails harmlessly, ending the loop.
    while umount /etc/hosts 2>/dev/null; do
        :
    done
    mount -o bind "$1" /etc/hosts
}

ensure_backups() {
    if [ ! -f "$HOSTS_BACKUP" ]; then
        cp /etc/hosts "$HOSTS_BACKUP"
    fi
    if [ ! -f "$CERT_BACKUP" ]; then
        cp "$CERT_TARGET_OEM" "$CERT_BACKUP"
    fi
    if [ ! -f "$GDROOT_BACKUP" ]; then
        cp "$GDROOT_TARGET" "$GDROOT_BACKUP"
    fi
}

# Caches the just-verified mode so boot-hook.sh knows what to do on the next
# boot, without ever forcing a fixed mode itself (that was the bug in the
# original ad-hoc boot hook: it always re-applied valetudo mode regardless of
# what was last chosen at runtime). Never fails the calling mode_* function —
# the switch itself already happened and was verified; losing the cached
# record of that is a warning, not a failure.
persist_mode() {
    mkdir -p "$(dirname "$MODE_FILE")" 2>/dev/null || true
    printf '%s' "$1" > "$MODE_FILE.tmp" && mv "$MODE_FILE.tmp" "$MODE_FILE" \
        || echo "WARNING: switch succeeded but mode was NOT persisted to $MODE_FILE — next boot will use the previous mode" >&2
}

mode_backup() {
    ensure_backups
    echo "backups ensured under /userdata (etc-hosts.orig, server.crt.orig, gdroot-g2.crt.orig)"
}

mode_cloud() {
    if [ ! -f "$HOSTS_BACKUP" ] || [ ! -f "$CERT_BACKUP" ] || [ ! -f "$GDROOT_BACKUP" ]; then
        echo "no backup found under /userdata — nothing to restore, already stock?" >&2
        exit 1
    fi

    switch_hosts "$HOSTS_BACKUP"
    cp "$CERT_BACKUP" "$CERT_TARGET_OEM"
    cp "$CERT_BACKUP" "$CERT_TARGET_USERDATA"
    cp "$GDROOT_BACKUP" "$GDROOT_TARGET"

    verify_hosts "$HOSTS_BACKUP"
    verify_cert "$CERT_BACKUP"
    verify_gdroot_cloud

    restart_aiot_client
    restart_robotapp_stack
    verify_processes_restarted

    echo "switched to: real 3irobotix cloud (verified)"
    persist_mode "cloud"
}

mode_valetudo() {
    ensure_backups

    if [ ! -f "$HOSTS_VALETUDO" ]; then
        cp "$HOSTS_BACKUP" "$HOSTS_VALETUDO"
        printf '%s\t%s\n%s\t%s\n' "$VALETUDO_IP" "$HOST_A" "$VALETUDO_IP" "$HOST_B" >> "$HOSTS_VALETUDO"
    fi

    switch_hosts "$HOSTS_VALETUDO"
    cp "$CERT_VALETUDO" "$CERT_TARGET_OEM"
    cp "$CERT_VALETUDO" "$CERT_TARGET_USERDATA"
    # Rebuilt from the untouched backup + dev cert every time, rather than
    # appended incrementally, so repeated toggling never accumulates duplicate
    # entries in the CA bundle.
    cat "$GDROOT_BACKUP" "$CERT_VALETUDO" > "$GDROOT_TARGET"

    verify_hosts "$HOSTS_VALETUDO"
    verify_cert "$CERT_VALETUDO"
    verify_gdroot_valetudo

    restart_aiot_client
    restart_robotapp_stack
    verify_processes_restarted

    echo "switched to: local Valetudo dummycloud ($VALETUDO_IP, verified) — undo with: $0 cloud"
    persist_mode "valetudo"
}

case "${1:-}" in
    cloud) mode_cloud ;;
    valetudo) mode_valetudo ;;
    backup) mode_backup ;;
    *)
        echo "usage: $0 {cloud|valetudo|backup}" >&2
        exit 1
        ;;
esac

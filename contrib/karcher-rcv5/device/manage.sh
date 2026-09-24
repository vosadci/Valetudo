#!/bin/sh
# manage.sh — on-device entry point for someone with only SSH access to the
# robot (no laptop, no checkout of this repo, no README.md). Deploy to
# /userdata/valetudo/manage.sh.
#
# Every multi-step sequence here (activate/uninstall) is a direct mirror of
# what activate.sh/uninstall.sh do from the Mac — those scripts contain no
# Mac-only logic, they just call karcher-cloud-switch.sh/aiot-gate.sh/
# S96valetudo over ssh in order. This wraps the same calls locally, plus a
# contextual "what can I do right now" menu so the workflow knowledge that
# would otherwise only live in README.md is discoverable on-device.
#
# Usage: manage.sh {status|activate|deactivate|uninstall [--purge]|help}
#        (no args, or an unrecognized one, behaves like `help`)

set -eu

REMOTE_DIR="/userdata/valetudo"
CCS="$REMOTE_DIR/karcher-cloud-switch.sh"
AG="$REMOTE_DIR/aiot-gate.sh"
S96="$REMOTE_DIR/S96valetudo"
# Matches upgrade-firmware.sh's REMOTE_STAGE_DIR in lib.sh — can't literally
# share it (that's a Mac-side bash constant, this is a robot-side sh
# script), so if that path ever changes, change it here too.
REMOTE_STAGE_DIR="/userdata/valetudo-firmware-upgrade"

# field_of TEXT LABEL — same idiom as diagnose.sh's helper of the same
# name (tested there against real status output this session): pulls the
# value after "LABEL : " out of karcher-cloud-switch.sh's/aiot-gate.sh's
# own status text. Used here against LOCALLY captured output (no ssh, we
# already are the robot) rather than relayed text, but the parsing itself
# is identical on purpose — one proven technique, two call sites.
field_of() {
    printf '%s\n' "$1" | sed -n "s|^$2[[:space:]]*:[[:space:]]*||p" | head -1
}

# --- status / contextual menu -----------------------------------------

print_status_and_menu() {
    CCS_STATUS="$("$CCS" status 2>&1 || true)"
    AG_STATUS="$("$AG" status 2>&1 || true)"

    echo "== karcher-cloud-switch.sh status =="
    echo "$CCS_STATUS" | sed 's/^/  /'
    echo
    echo "== aiot-gate.sh status =="
    echo "$AG_STATUS" | sed 's/^/  /'
    echo
    if pidof valetudo >/dev/null 2>&1; then
        VALETUDO_RUNNING=yes
    else
        VALETUDO_RUNNING=no
    fi
    echo "== valetudo process : $([ "$VALETUDO_RUNNING" = yes ] && echo running || echo "not running") =="

    MODE="$(field_of "$CCS_STATUS" "mode file")"
    HOSTS_SOURCE="$(field_of "$CCS_STATUS" "/etc/hosts source")"
    GATE_STATE="$(field_of "$AG_STATUS" "live /oem gate")"
    AIOT_STATE="$(field_of "$AG_STATUS" "aiot_client.bin")"

    echo
    echo "== What you can do =="
    if [ "$MODE" = "valetudo" ] \
       && [ "$HOSTS_SOURCE" = "valetudo" ] \
       && [ "$GATE_STATE" = "PATCHED" ] \
       && [ "$VALETUDO_RUNNING" = yes ] \
       && [ "$AIOT_STATE" = running ]; then
        echo "Currently: valetudo mode, active and healthy."
        echo "  manage.sh deactivate   — switch back to the real Kärcher cloud"
    elif [ "$MODE" = "valetudo" ]; then
        echo "Currently: mode file says valetudo, but something doesn't match (see status"
        echo "above — compare mode file / hosts source / gate / process). This robot won't"
        echo "necessarily behave as expected."
        echo "  manage.sh activate     — re-run activation, may fix it"
        echo "  manage.sh deactivate   — switch back to the real Kärcher cloud instead"
    elif [ "$GATE_STATE" = "PATCHED" ]; then
        echo "Currently: installed, in cloud mode, previously activated at least once."
        echo "  manage.sh activate     — switch into valetudo mode"
    else
        echo "Currently: installed, not yet activated."
        echo "  manage.sh activate     — set up and switch into valetudo mode"
    fi
    echo
    echo "Always available: manage.sh status, manage.sh uninstall [--purge]"
}

# --- activate -----------------------------------------------------------

do_activate() {
    if mountpoint -q /oem 2>/dev/null; then
        echo "== /oem overlay already active =="
    else
        echo "== Arming /oem overlay =="
        "$AG" overlay on
    fi

    if mountpoint -q /oem 2>/dev/null; then
        echo "== Patching wifi-deamon.sh (idempotent) =="
        "$AG" patch
        echo "== Starting Valetudo =="
        "$S96" start
        sleep 2
        echo "== Switching to valetudo mode =="
        "$CCS" valetudo
        echo
        echo "Done. Verify at http://<this robot's IP>. Undo with: manage.sh deactivate"
    else
        echo
        echo "The /oem overlay is staged but not yet active — this robot needs a reboot"
        echo "before it can be patched (same as activate.sh's own first-run behavior)."
        echo "This script will NOT reboot the robot for you. Do exactly this, nothing else:"
        echo "  1. run 'reboot'"
        echo "  2. wait for the robot to come back"
        echo "  3. run 'manage.sh activate' again — it will finish the job from here"
        echo "(don't run 'aiot-gate.sh patch' yourself in between — it would patch the file"
        echo "but never switch the robot into valetudo mode, leaving it half-done)"
    fi
}

# --- deactivate -----------------------------------------------------------

do_deactivate() {
    "$CCS" cloud
}

# --- uninstall ------------------------------------------------------------

do_uninstall() {
    case "${1:-}" in
        "") purge=no ;;
        --purge) purge=yes ;;
        *)
            echo "ERROR: unknown option '$1' (did you mean --purge?)" >&2
            echo "usage: manage.sh uninstall [--purge]" >&2
            exit 1
            ;;
    esac

    # Stop here on failure, same as uninstall.sh — continuing (especially
    # into --purge) with the robot in an unknown cert/hosts state would
    # remove the recovery tools along with everything else.
    echo "== Switching back to stock cloud mode =="
    if ! "$CCS" cloud; then
        echo "ERROR: switch to cloud failed — check '$CCS status' by hand." >&2
        echo "Not continuing: purging now could leave this robot unrecoverable." >&2
        exit 1
    fi

    echo "== Reverting the wifi-deamon.sh aiot_client gate (if patched) =="
    if [ -x "$AG" ] && grep -q "valetudo-gate BEGIN" /oem/bin/wifi-deamon.sh 2>/dev/null; then
        "$AG" unpatch || echo "WARNING: could not revert the gate — check '$AG status' by hand" >&2
    fi

    echo "== Stopping Valetudo =="
    "$S96" stop || true

    echo "== Removing boot-autostart hook =="
    rm -f /userdata/cfg/rockchip_test/auto_reboot.sh

    if [ "$purge" = yes ]; then
        echo "== Disarming the /oem overlay =="
        # Otherwise it stays bind-mounted indefinitely and could mask a
        # future vendor OTA under it — --purge is supposed to mean "clean
        # slate", so leaving this armed would contradict that.
        if [ -x "$AG" ]; then
            "$AG" overlay off || echo "WARNING: could not disarm the overlay — check '$AG status' by hand" >&2
        fi

        echo "== Removing any staged firmware upgrade image =="
        rm -rf "$REMOTE_STAGE_DIR"

        echo "== Purging /userdata/valetudo and the derived hosts variant =="
        echo "(this deletes manage.sh itself — that's fine, it's already running)"
        rm -f /userdata/etc-hosts.valetudo
        rm -rf "$REMOTE_DIR"
        echo "purged (the three .orig backups under /userdata were NOT touched)"
    else
        echo "skipping purge (pass --purge to also remove $REMOTE_DIR)"
    fi
}

# --- dispatch ---------------------------------------------------------

case "${1:-help}" in
    status) print_status_and_menu ;;
    activate) do_activate ;;
    deactivate) do_deactivate ;;
    uninstall) shift; do_uninstall "${1:-}" ;;
    help|*) print_status_and_menu ;;
esac

#!/bin/bash
#
# Shared by install.sh/activate.sh/uninstall.sh/restore-originals.sh. Source
# with `. "$SCRIPT_DIR/lib.sh"` and pass "${SSH_OPTS[@]}" to every ssh/scp call.
#
# The robot's /root is read-only squashfs (same constraint as /etc/init.d),
# so real key-based auth can't be set up there — every connection needs the
# root password. ControlMaster multiplexing means that only has to happen
# ONCE per script run (the first ssh/scp call opens a persistent connection),
# not once per call — install.sh alone makes about ten of them.
#

CONTROL_DIR="$HOME/.ssh/controlmasters"
mkdir -p "$CONTROL_DIR"
chmod 700 "$CONTROL_DIR"

SSH_OPTS=(-o "ControlMaster=auto" -o "ControlPersist=10m" -o "ControlPath=$CONTROL_DIR/%r@%h:%p")

# Bold/colored output for the lines that matter most — final results, next
# steps, errors — so they stand out against scp/ssh's own noisy progress
# output instead of scrolling past unnoticed. Falls back to plain text when
# stdout isn't a terminal (e.g. piped to a log file).
if [ -t 1 ]; then
    BOLD=$'\033[1m'
    GREEN=$'\033[1;32m'
    YELLOW=$'\033[1;33m'
    RED=$'\033[1;31m'
    RESET=$'\033[0m'
else
    BOLD=''
    GREEN=''
    YELLOW=''
    RED=''
    RESET=''
fi

# ok: "it worked" / "here's what to do next".
ok() {
    printf '%s%s%s\n' "$BOLD$GREEN" "$*" "$RESET"
}

# warn: non-fatal but worth noticing.
warn() {
    printf '%s%s%s\n' "$BOLD$YELLOW" "$*" "$RESET" >&2
}

# err: fatal — pairs with `exit 1` at the call site, doesn't exit itself.
err() {
    printf '%s%s%s\n' "$BOLD$RED" "$*" "$RESET" >&2
}

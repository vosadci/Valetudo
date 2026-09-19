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

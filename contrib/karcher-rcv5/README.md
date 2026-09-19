# Kärcher RCV5 Valetudo provisioning

Repeatable, idempotent tooling to build a custom Valetudo vendor module for
the Kärcher RCV5 and set it up (or fully revert it) on a freshly-rooted
robot. The scripts here are tracked in git; the files they generate
(dev TLS cert/key, the off-device backup mirror, captured test maps) are
gitignored — see `.gitignore` for the exact list.

This directory does **not** cover rooting the robot itself — that's a
separate, robot-specific exploit you need root SSH access from before
starting here.

## Prerequisites

- **Root SSH access to the robot**, obtained separately (out of scope of
  this directory). Password-based: `/root` sits on read-only squashfs, so
  key-based auth can't be set up there — every script below prompts for the
  root password once per run (see "Repeated password prompts" below for why
  it's only once).
- **Node.js ≥ 20** (`node -v`) and **npm** — for building Valetudo itself.
- **Python 3** with the `cryptography` package (`pip install cryptography`)
  — for generating the dev TLS certificate.
- `ssh`/`scp` (already on macOS/Linux by default).
- The robot's current LAN IP (DHCP-assigned, can change — confirm it before
  running anything if it's been a while).

## Getting the code

Clone the fork — **not** upstream `Hypfer/Valetudo`, which has no Kärcher
module — and check out the branch with the RCV5 vendor module:

```sh
git clone git@github.com:vosadci/Valetudo.git
cd Valetudo
git checkout feature/karcher-rcv5-vendor-module
```

Run every command in the rest of this document from `contrib/karcher-rcv5/`
inside that checkout, on your Mac/PC — never on the robot — unless a step
says otherwise.

## Installing dependencies

From the repo root:

```sh
npm ci
```

This installs all three workspaces (`backend`, `frontend`, `docs`).

## Generating the dev TLS certificate

Kärcher's `aiot_client` on the robot only trusts a specific, oddly-shaped
certificate (a genuine ASN.1 v1 cert — the two-step generation below exists
because a normal v3 cert, which is what every modern TLS library emits by
default, gets rejected by its mbedTLS stack). Nothing here is extracted
from the Kärcher app; it's a self-signed cert generated fresh on your
machine, impersonating `*.3irobotix.net` purely so `aiot_client` accepts
the handshake with your local Valetudo instance instead of the real cloud.

From `contrib/karcher-rcv5/`:

```sh
python3 gen_cert.py    # writes server.key, server.crt (v3)
python3 make_v1.py     # reads those, writes server_v1.crt / server_v1.der (v1)
```

Run both from inside this directory — they read/write bare filenames
relative to the current directory, not `__dirname`. `install.sh` (below)
pushes `server_v1.crt` and `server.key` to the robot; `server.crt`/
`server_v1.der` are intermediates you can ignore afterward.

You do **not** need to extract anything from the Kärcher app for this step.
The third cert the robot needs, `gdroot-g2.crt`, is *not* generated here —
it's the robot's own real CA bundle, pulled off the device itself by
`install.sh` during its backup step.

## Building the Valetudo binary

From the repo root:

```sh
npm run build --workspace=frontend
npm run build_armv7 --workspace=backend
```

Run the frontend build first: `backend/package.json`'s `pkg` config bundles
`../frontend/build` as an asset, and `WebServer.js` serves it as the web
UI, so the armv7 build needs it to already exist. The second command
regenerates the Kärcher protobufs, then compiles the actual ~34MB static
armv7 binary via `pkg` to `build/armv7/valetudo`.

The first time you run the `pkg` step, it downloads a prebuilt Node runtime
for `node22-linuxstatic-armv7` (tens of MB) into `build_dependencies/` —
this needs network access and can take a few minutes; it looks like a hang
but isn't. Subsequent builds reuse the cached download.

Confirm the binary exists before continuing:

```sh
ls -la ../../build/armv7/valetudo
```

## Installing on the robot

Replace `<robot-ip>` below with your robot's actual LAN IP throughout (e.g.
`192.168.1.42`).

**1. Stage everything.** Pushes the Valetudo binary, wrapper scripts, dev
certs, and the boot-autostart hook; takes a backup of the robot's original
files. The robot is left **fully stock** afterward — nothing is redirected
yet.

```sh
./install.sh <robot-ip>
```

You'll be asked for the root password once (subsequent `ssh`/`scp` calls in
the same run, and any other script run within 10 minutes, reuse that
connection — see `lib.sh`). Expect output ending in:

```
install.sh complete. Robot is still in stock/cloud mode — nothing has been redirected.
Run ./activate.sh <robot-ip> when you're ready to switch it into valetudo mode.
```

Safe to re-run any time (e.g. after rebuilding the binary) — it never
touches `config.json`, `device-identity.json`, or the current mode, only the
binary/scripts/certs.

If it fails partway (e.g. dropped connection during the 34MB binary push),
just run it again.

**2. Activate.** Switches the robot's `aiot_client`/`RobotApp` onto the
local Valetudo dummycloud and persists that choice so it survives a reboot.

```sh
./activate.sh <robot-ip>
```

**3. Verify.** Open `http://<robot-ip>` (or whatever the robot's IP is)
in a browser — you should see the map and controls. If you don't, see
Troubleshooting below.

**4. Confirm it survives a reboot.** Reboot the robot (from its own button,
or `ssh root@<robot-ip> reboot`). Wait for it to fully boot, then check
the web UI again — it should come back on its own with zero manual steps.

That's it — the robot is now provisioned and will boot into Valetudo mode
every time until you explicitly switch it back.

## Day-to-day: switching modes

Once installed, toggle between the real vendor cloud and Valetudo any time,
directly on-device:

```sh
ssh root@<robot-ip> /userdata/valetudo/karcher-cloud-switch.sh cloud     # back to the real vendor app
ssh root@<robot-ip> /userdata/valetudo/karcher-cloud-switch.sh valetudo  # back to Valetudo
```

Whichever you choose is what the robot boots into from then on — see "The
mode file" below for why that's reliable across reboots.

## Uninstalling

```sh
./uninstall.sh <robot-ip>            # switch back to stock, remove the boot hook, keep the binary/certs
./uninstall.sh <robot-ip> --purge    # same, and also delete /userdata/valetudo entirely
```

Either way, the three irreplaceable backup files under `/userdata/` (see
"Irreplaceable files" below) are never touched.

## Disaster recovery

If a factory reset (or anything else) wipes `/userdata`, restore the
Mac-side backups first, then re-provision:

```sh
./restore-originals.sh <robot-ip>
./install.sh <robot-ip>
./activate.sh <robot-ip>
```

## Troubleshooting

- **`install.sh` can't reach the robot**: confirm its current IP
  (`arp -a` on the Mac, or check your router) — it's DHCP-assigned and can
  change.
- **Activated, but no map/controls in the web UI**: give it a few seconds —
  `activate.sh` has a built-in `sleep 2` before the switch, and the switch
  script itself waits up to 20s for `RobotApp` to respawn. If it's still
  broken after a minute, `ssh root@<ip> cat /etc/hosts` should show the
  `127.0.13.38` redirect lines; if it doesn't, the switch didn't actually
  take — re-run `./activate.sh <ip>`.
- **Reboot came back in stock mode when you expected valetudo mode**: check
  `ssh root@<ip> cat /userdata/valetudo/mode` — if it's missing or says
  `cloud`, `activate.sh` was never successfully run (or ran before this
  mode-file mechanism existed). Re-run `./activate.sh <ip>`.
- **Repeated password prompts**: see `lib.sh` — every script in this
  directory should only prompt once per run via SSH ControlMaster. If
  you're being prompted repeatedly within one script, something's killing
  the control socket (e.g. `~/.ssh/controlmasters/` not writable).

---

## Reference

### The mode file

`/userdata/valetudo/mode` holds exactly `cloud` or `valetudo` — written only
by `karcher-cloud-switch.sh`, after its own verify steps already passed.
Absent, empty, or anything other than the literal string `valetudo` is
treated as `cloud` (safe default: a never-activated or corrupted-state robot
always boots stock). `boot-hook.sh` reads it on every boot to decide whether
to reapply the redirect; `karcher-cloud-switch.sh` itself never reads it back.

This is what makes the setup genuinely **switchable**: manually running
`karcher-cloud-switch.sh cloud` on-device and rebooting keeps the robot
stock on the next boot too, instead of silently reverting to valetudo mode.

### Why the boot hook is two files

`/etc/init.d` is read-only squashfs on this device — genuinely unmodifiable.
The only usable hook is `/etc/init.d/S99_auto_reboot` (a Rockchip QA/
power-loss-test script), which **sources** (not executes) a file from
`/userdata/cfg/rockchip_test/auto_reboot.sh` at the end of every boot,
passing it a QA reboot counter as `$1`.

Because it's sourced into `S99_auto_reboot`'s own shell, that file must never
`set -e`, `exit`, or reference `$1`/`$@`. So it stays a permanently inert
one-liner (`auto_reboot.sh`) that just execs `boot-hook.sh` as a real
subprocess — all actual logic (mode check, starting Valetudo, reapplying the
switch) lives in `boot-hook.sh`, which is free to use normal shell
semantics. **Do not merge these back into one file** — that reintroduces a
real bug class (a stray `exit` or `set -e` taking down the vendor's own boot
script).

### Known limitations (not fixed by this tooling)

- **Brief real-cloud contact on every boot in valetudo mode.** `aiot_client`
  starts earlier in the boot sequence (via `S90robotManager`/Monitor) using
  stock `/etc/hosts`, and only gets redirected once `S99_auto_reboot` runs
  near the very end of boot. For that window, the robot genuinely reaches
  the real 3irobotix cloud. Closing this needs finding what actually
  launches `aiot_client` and hooking earlier — not attempted here.
- **Dormant clobber-guard in `S99_auto_reboot`.** If a future vendor OTA
  ever ships `/oem/rockchip_test/auto_reboot.sh`, that vendor script's own
  guard would start overwriting our `auto_reboot.sh` on every boot. No
  runtime self-check is built for this — moot as long as no vendor OTA is
  ever applied to a rooted unit.

### Irreplaceable files

`/userdata/{etc-hosts,server.crt,gdroot-g2.crt}.orig` on-device, mirrored to
`../device-originals-backup/` on the Mac, are the only record of this
robot's pre-Valetudo state. `/userdata` is wiped by a factory reset, so the
Mac-side copy is the only thing that makes `restore-originals.sh` possible
after one. No script here — including `uninstall.sh --purge` — ever deletes
either copy.

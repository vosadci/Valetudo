# Kärcher RCV5 Valetudo provisioning

Tooling to build a custom Valetudo vendor module for the Kärcher RCV5 
and set it up (or fully revert it) on a freshly-rooted robot. 
The scripts here are tracked in git; the files they generate
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
- The robot's current LAN IP (if DHCP-assigned, can change — confirm it before
  running anything if it's been a while).

## Getting the code

Clone the fork — **not** upstream `Hypfer/Valetudo`, which has no Kärcher
module:

```sh
git clone git@github.com:vosadci/Valetudo.git
cd Valetudo
```

Every command below runs on your Mac/PC — not on the robot. Each section
states explicitly which directory it runs from: the repo root for `npm`/build
commands, `contrib/karcher-rcv5/` (inside that checkout) for everything else.

## Installing dependencies

From the repo root:

```sh
npm ci
```

This installs all three workspaces (`backend`, `frontend`, `docs`).

## Generating the dev TLS certificate

Kärcher's `aiot_client` on the robot only trusts a specific, oddly-shaped
certificate (a genuine ASN.1 v1 cert — `gen_cert.py` first builds a normal
v3 cert, since that's all `cryptography` can emit, then strips the version
field from the DER by hand, because a v3 cert gets rejected by its mbedTLS
stack). Nothing here is extracted from the Kärcher app; it's a self-signed
cert generated fresh on your machine, impersonating `*.3irobotix.net`
purely so `aiot_client` accepts the handshake with your local Valetudo
instance instead of the real cloud.

From `contrib/karcher-rcv5/`:

```sh
python3 gen_cert.py
```

Safe to re-run: it's a no-op if `server.key`, `server.crt`, 
`server_v1.crt`, and `server_v1.der` already exist, and only ever writes 
all four together (via temp files + atomic rename), so an interrupted run 
can never leave a mismatched key/cert pair behind. Pass `--force` to 
regenerate deliberately. `install.sh` (below) pushes `server_v1.crt` and 
`server.key` to the robot; `server.crt`/`server_v1.der` are intermediates 
you can ignore afterward.

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

Confirm the binary exists before continuing (still from the repo root):

```sh
ls -la build/armv7/valetudo
```

## Installing on the robot

From `contrib/karcher-rcv5/`. Replace `<robot-ip>` below with your robot's
actual LAN IP throughout (e.g. `192.168.1.42`).

**1. Stage everything.** Pushes the Valetudo binary, wrapper scripts, dev
certs, and the boot-autostart hook; takes a backup of the robot's original
files. The robot is left **fully stock** afterward — nothing is redirected
yet.

```sh
./install.sh <robot-ip>
```

Before touching anything else, this checks the robot's firmware
(`/oem/sysconf/sysVersion.ini`) against the exact version this tooling was
built against (`I3.12.90`) and refuses to proceed on a mismatch, printing
both versions. This tooling — `aiot-gate.sh`'s `wifi-deamon.sh` patch above
all — is anchored to that specific firmware and will refuse or silently
misbehave on another build; a factory reset or a vendor update can revert or
change it without warning, so this is checked on every run, not just the
first.

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

The very first time you run this against a given robot (or any time after
`aiot-gate.sh overlay off` or a factory reset), it also arms the `/oem`
overlay it needs to write certs there and reboots the robot automatically —
expect this run to take a minute or two longer than usual while it waits for
the robot to come back up. Every run after that is fast, no reboot.

Before switching the robot into valetudo mode, this also patches
`wifi-deamon.sh` on the robot (`aiot-gate.sh patch`, idempotent) so
`aiot_client` can't launch at all until the local dummycloud redirect is
verified — closing the boot-time window where it could otherwise still
briefly reach the real 3irobotix cloud (`aiot_client` is launched by
`wifi-deamon.sh`'s watchdog ~6s after boot, well before `boot-hook.sh` gets a
chance to redirect it). If the robot's firmware doesn't match what this patch
was written against, `activate.sh` aborts here rather than activating with
that window silently left open.

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

From `contrib/karcher-rcv5/`:

```sh
./uninstall.sh <robot-ip>            # switch back to stock, remove the boot hook, keep the binary/certs
./uninstall.sh <robot-ip> --purge    # same, and also delete /userdata/valetudo entirely
```

Either way, the three irreplaceable backup files under `/userdata/` (see
"Irreplaceable files" below) are never touched.

## Disaster recovery

If a factory reset (or anything else) wipes `/userdata`, restore the
Mac-side backups first, then re-provision. From `contrib/karcher-rcv5/`:

```sh
./restore-originals.sh <robot-ip>
./install.sh <robot-ip>
./activate.sh <robot-ip>
```

## Recovering from a WiFi/config reset

Three different ways to trigger a reset on this robot were all live-tested 2026-09-21
and land on the same **shallow** wipe — shallower than a full `/userdata` factory
reset:

1. The Kärcher app's "reset and remove robot" action.
2. Holding both of the robot's top physical buttons together for 5+ seconds (announces
   "network and wifi configuration mode").
3. The small recessed reset button under the main cover (announces "System has been
   restored").

All three clear `/userdata/config`, `/userdata/log`, and `/userdata/cfg` (WiFi
credentials included) and drop the robot back into an unpaired, no-WiFi state — but
none of them touch `/userdata/debug_mode`. Symptom: SSH stops working (no network to
reach it over), but `adb` over the internal USB OTG port still works, and root is
intact.

To get WiFi back without going through the app's SoftAP re-pairing flow:
`wpa_supplicant` is already running (`S66_wifi` starts it at boot regardless of whether
any network is configured), so reconfigure it live over its control socket:

```sh
adb shell
wpa_cli -i wlan0 add_network                        # returns a network id, e.g. 0
wpa_cli -i wlan0 set_network 0 ssid '"YourSSID"'     # literal quotes required
wpa_cli -i wlan0 set_network 0 psk '"YourPassword"'
wpa_cli -i wlan0 enable_network 0
wpa_cli -i wlan0 select_network 0
wpa_cli -i wlan0 save_config                         # persists to /userdata/cfg/wpa_supplicant.conf
```

`dhcpcd` (`S41dhcpcd`) already runs as a persistent daemon watching every interface, so
it picks up the new link automatically — no separate DHCP step, no reboot needed. Check
with `wpa_cli -i wlan0 status` (look for `wpa_state=COMPLETED`) and `ifconfig wlan0`.

Once SSH is back, treat it like any other `/userdata` wipe — see "Disaster recovery"
above if `/userdata/valetudo` itself also needs restoring.

**`/userdata/config/wifi.conf` is a separate problem from the WiFi network itself.**
The `wpa_cli` recipe above only restores the robot's *network* connectivity (`ssid`/
`psk`). The same reset also wipes `wifi.conf`'s cloud-pairing fields — `uid`, `key`,
`district`, `http_host`, `mqtt_host` — which `aiot_client` needs to log in at all (see
"Fields now show in Valetudo" history in this repo). **`key` and `district` are
pairing-session values the cloud reissues on every fresh pairing, not fixed per-device
secrets** — live-confirmed 2026-09-21: hand-restoring them from an old backup got the
robot fully connected (login, MQTT, map/log uploads all worked), but every remote
command silently did nothing for the rest of that session, while the physical
Start button worked normally throughout. Root cause was never fully isolated (the
robot's firmware had also reverted to an older version across the same reset, which
is at least as likely an explanation as the stale pairing fields), but re-pairing
through the official Kärcher app's SoftAP flow immediately fixed it.

**If a robot recovered this way connects and uploads fine but ignores every command
from the UI while the physical button still works, don't keep debugging Valetudo —
re-pair it through the official app first and update firmware**, then re-run 
`karcher-cloud-switch.sh valetudo` (it never touches `wifi.conf`, so the fresh 
pairing carries over).

This is exactly the class of problem `install.sh`'s firmware check (see "Installing
on the robot" above) now catches immediately and by name, instead of surfacing later
as an unexplained silent command failure — re-run `install.sh` after re-pairing to
confirm the firmware is back to `I3.12.90` before assuming everything else is fine.

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

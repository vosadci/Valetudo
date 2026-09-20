# RCV5 × Valetudo capability map

What the Kärcher app exposes, Valetudo's capability taxonomy, and where the RCV5
vendor module (`backend/lib/robots/karcher/`) currently stands between them.
Update this alongside any change to capability coverage or any new protocol
finding — it's meant to stay current, not a one-off snapshot.

Protocol facts are sourced from the `karcher-rcv5-ha` repo's
`doc/PROTOCOL.md` / `doc/APP_FEATURES.md` / `doc/INVESTIGATION.md` /
`doc/LOCAL_CONTROL.md` (the authoritative wire-format reference for this
device). Citations below are file + section, not line numbers, since that
repo evolves independently of this one.

**Last updated:** 2026-09-20 (`CurrentStatisticsCapability` implemented)

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Implemented in this vendor module today |
| 🟩 | Confirmed feasible (device- or APK-verified property/command), not yet implemented |
| 🟨 | A command/property exists but is APK-derived and uncaptured on real traffic — verify before shipping |
| 🔶 | Firmware-confirmed via disassembly, but the MQTT method/payload is not yet identified |
| ⬜ | Cloud-only — no MQTT path exists |
| ❌ | Excluded — hardware/model gate, or the pipeline is closed by design |
| ❔ | No evidence either way |

## Currently implemented (9)

`KaercherBasicControlCapability`, `KaercherFanSpeedControlCapability`,
`KaercherWaterUsageControlCapability`, `KaercherOperationModeControlCapability`,
`KaercherZoneCleaningCapability`, `KaercherMapSegmentationCapability`,
`KaercherConsumableMonitoringCapability`, `KaercherAutoEmptyDockManualTriggerCapability`,
`KaercherCurrentStatisticsCapability`.

## Full map

### Core cleaning control

| Capability | Status | Detail |
|---|---|---|
| `BasicControlCapability` | ✅ | start/pause/stop/home |
| `FanSpeedControlCapability` | ✅ | `wind` presets |
| `WaterUsageControlCapability` | ✅ | `water` presets |
| `OperationModeControlCapability` | ✅ | vacuum/mop/vacuum+mop |
| `ZoneCleaningCapability` | ✅ | ships, but the coordinate transform (`set_zone_points`/`set_zone_clean`) is APK-derived and uncaptured |
| `GoToLocationCapability` | 🟨 | `set_point_clean`/`start_point_clean` in the APK command table, payload never captured. Ambiguous vs. "clean a spot" below — needs one live capture to settle whether that app feature is this or a small `ZoneCleaningCapability` rectangle |
| `ManualControlCapability` | 🔶 | **Corrected 2026-09-20** — previously marked ❌ on the strength of `set_direction` being tagged "RCV2 only" in the APK command table. That's superseded by RobotApp disassembly (`CAiotParseBuf::parseSetRemoteCtrlReq`, `SetRemoteControl` cloud op): `direction`/`ctrlValue` are parsed straight into the motion layer, independent of that APK string. Matches the app's own four-direction, hold-to-move joystick. Firmware-confirmed; MQTT method name and payload shape not yet captured |
| `HighResolutionManualControlCapability` | ❌ | the joystick is discrete 4-direction, not continuous — `ManualControlCapability` is the right shape |
| `MappingPassCapability` | ❔ | "Quick map creation" exists in the app (listed under both Map list and Functional settings — almost certainly one feature reachable two ways), but no MQTT command identified yet |
| `CleanRouteControlCapability` | 🟨 | `mop_route`/`sweep_type` are in the property stream; valid enum values never reversed |

### Map & rooms

| Capability | Status | Detail |
|---|---|---|
| `MapSegmentationCapability` | ✅ | room list + `app_segment_clean` |
| `MapResetCapability` | 🟨 | `reset_map` in the APK command table, payload uncaptured |
| `CombinedVirtualRestrictionsCapability` | 🟨 | `set_virtual_wall` + protobuf `virtual_walls` field exist — same unverified-coordinate caveat as zone cleaning |
| `MapSegmentEditCapability` (merge/split) | ⬜ | Valetudo has the capability; the RCV5 app does this via map re-upload, no MQTT primitive found |
| `MapSegmentRenameCapability` | ⬜ | same — app/cloud-side |
| `MapSegmentMaterialControlCapability` | ❔ | no per-room floor-material concept in the protocol |
| `MapAnnotationsCapability` | ❔ | no equivalent found |
| `MapSnapshotCapability` | ❔/⬜ | closest analog is `upload_by_mapid`/multi-map switching — not a snapshot-restore concept |
| `PersistentMapControlCapability` | ❔ | multi-map (`map_num`, `house_infos`) is always-on; no toggle to disable found |
| `PendingMapChangeHandlingCapability` | ❔ | no evidence found |
| *(no matching capability)* — map list: create/delete/rename/set-current | — | **Gap in Valetudo's taxonomy, not the RCV5's.** Protocol has `current_map_id`, `map_num`, `house_infos`, `set_current_map_id`; the app does delete/rename/set-current. None of Valetudo's 53 capability types model a map-list UI |

### Floor sensing / navigation behavior

| Capability | Status | Detail |
|---|---|---|
| `CarpetModeControlCapability` | 🟩 | `prop.set {"privacy":{"carpet_turbo":0\|1}}` — APK-verified (`CarpetSettingVM.java`) |
| `CarpetSensorModeControlCapability` | 🟩 | `privacy.carpet_avoid` — same source |
| `FloorMaterialDirectionAwareNavigationControlCapability` | ❌ | no equivalent; RCV5 is LiDAR SLAM |
| `CollisionAvoidantNavigationControlCapability` | ❌ | no togglable nav-style property found |
| `ObstacleAvoidanceControlCapability` | 🟩 | **Corrected 2026-09-20** — previously marked ❌ by conflating this with RVF7's Agora live-video streaming. RCV5 has its own on-device `Ai-server` component that classifies obstacles from camera frames locally (`doc/INVESTIGATION.md` §"Camera — positive APK evidence", `doc/LOCAL_CONTROL.md` process table), gated by a single flag: `prop.set {"privacy":{"ai_recognize":0\|1}}`. Structurally a plain `SimpleToggleCapability` |
| `ObstacleImagesCapability` | ❌ | not "no camera" — the pipeline is closed by design. No frame or image ever leaves the device in shipped firmware (privacy-by-design, confirmed independently at both the app layer and the firmware layer). Not reachable without firmware modification |
| `PetObstacleAvoidanceControlCapability` | ❌ | `ai_recognize`'s detected classes (shoes, socks, cable, chair, scale) don't include a pet-specific class; this is generic obstacle avoidance, not pet-specific |

### Mopping hardware

| Capability | Status | Detail |
|---|---|---|
| `MopExtensionControlCapability` | ❌ | no extendable side-mop property |
| `MopExtensionFurnitureLegHandlingControlCapability` | ❌ | same |
| `MopTwistControlCapability` | ❔ | no property found |
| `MopDockCleanManualTriggerCapability`, `MopDockDryManualTriggerCapability`, `MopDockMopAutoDryingControlCapability`, `MopDockMopDryingTimeControlCapability`, `MopDockMopWashTemperatureControlCapability` | ❔ | **hardware existence itself is unresolved.** `fault_title_587`/`fault_title_2013` strings imply a mop-wash/self-clean station concept exists in the app, but no RCV5 product-ID gate was found either way — treat as genuinely unsettled, not N/A |

### Auto-empty dock

| Capability | Status | Detail |
|---|---|---|
| `AutoEmptyDockManualTriggerCapability` | ✅ | `start_station_act` / `station_act:3`, device-confirmed |
| `AutoEmptyDockAutoEmptyDurationControlCapability` | ❔ | no config property found — cycle appears fixed |
| `AutoEmptyDockAutoEmptyIntervalControlCapability` | ❔ | no scheduled/interval auto-empty property found — manual-trigger-only dock as observed |

### Stats

| Capability | Status | Detail |
|---|---|---|
| `CurrentStatisticsCapability` | ✅ | Implemented 2026-09-20. `cleaning_time` (minutes → seconds) and `cleaning_area` (0.01 m² units → cm²). Note: `quantity` is battery level, device-confirmed — not a session count, so no `COUNT`-type datapoint exists here |
| `TotalStatisticsCapability` | ⬜ | lifetime history ("cleaning records" screen) is REST-API-only |

### Audio

| Capability | Status | Detail |
|---|---|---|
| `SpeakerVolumeControlCapability` | 🟩 | `volume` (0–100) already in the property stream |
| `VoicePackManagementCapability` | 🟩 | `voice_type` — well-understood; same command used for the MQTT-injection root exploit |
| `SpeakerTestCapability` | ❔ | no dedicated test-sound command; `find_device`'s beep is the closest thing but isn't a volume test |

### Misc

| Capability | Status | Detail |
|---|---|---|
| `LocateCapability` | 🟩 | `find_device`, APK-confirmed |
| `DoNotDisturbCapability` | 🟩 | `service.set_quiet_time` + `quiet_is_open`/`quiet_begin_time`/`quiet_end_time` — APK-verified |
| `WifiConfigurationCapability` / `WifiScanCapability` | 🟩 | not a cloud-protocol feature — Valetudo runs as root directly on the robot's Linux, so these could be implemented against the OS network stack, independent of Kärcher's cloud |
| `CameraLightControlCapability` | ❌ | no property found |
| `KeyLockCapability` | ❔ | no lock/child-lock property found |
| `DuststreamingCapability` | ❔ | no particulate-sensor stream property found |
| `QuirksCapability` | — | **the designed home for the orphans below**, not a shrug |

## Orphans — features with no dedicated Valetudo capability

These don't map 1:1 to any of the 53 capability types but are real, documented
app/protocol features. `QuirksCapability` is Valetudo's mechanism for exactly
this — vendor-specific toggles bundled into one class instead of left unimplemented:

| Feature | Protocol detail |
|---|---|
| Per-room cleaning cycles (x1/x2) *and* the global "Double cleaning" toggle | Same underlying field: `repeat` (`0`/`1`/`2` = single/double/triple) inside `set_preference`'s room-preference array. The global toggle is almost certainly the non-Customise-mode default for the same field |
| Carpet display toggle | `privacy.carpet_show` |
| Voice on/off (distinct from volume) | Likely the `sound` property (in the stream, values unconfirmed) |
| Robot leveling calibration (off-dock only) | `set_calibration`, in the APK command table |
| Schedules | **Not actually a gap** — Valetudo schedules locally in core, independent of any vendor capability |
| Firmware auto-update toggle | Not merely N/A — **turning it off matters operationally** once Valetudo is installed. A future vendor OTA would reactivate `S99_auto_reboot`'s dormant clobber-guard (see the main `README.md`'s Known Limitations) and start overwriting the boot hook |
| Upload map / cleaning records to cloud, withdraw consent | Almost certainly more fields in the same `privacy` object as `carpet_turbo`/`ai_recognize`. "Withdraw consent" ≈ `delete_device`. A single `prop.get` of the whole `privacy` object would cheaply enumerate all of it |
| Device ID / MAC / robot name / time zone | Identity fields, already available generically; time zone is N/A — Valetudo owns the system clock on-device |
| Factory reset | `reset_factory` exists; deliberately not something to expose casually |

## Already-parsed data Valetudo isn't using yet

The map protobuf carries `objects` (`AiObjectInfo`, field 15 — AI-detected
obstacle positions) and `furniture_info` (field 16 — carpet/furniture
polygons). `KaercherMapParser.js` parses neither today, but the `karcher-rcv5-ha`
HA integration already renders both in its map image. This is a port of
existing logic, not new reverse engineering — probably the highest
value-per-effort item on this whole list.

## Known documentation discrepancy (not fixed here)

`karcher-rcv5-ha`'s `doc/APP_FEATURES.md` (the command table and the "Not
applicable to RCV5" section) still says `set_direction` manual joystick
control is "RCV2 only." That's superseded by the disassembly finding above.
Not corrected there yet — that repo's doc changes are scoped explicitly by
the user, not made inline from this one.

## Ranked next capabilities (lowest effort, no new reverse engineering)

1. ~~`CurrentStatisticsCapability`~~ — done, 2026-09-20
2. `LocateCapability` — `find_device`
3. `SpeakerVolumeControlCapability` — `volume`
4. `DoNotDisturbCapability` — quiet mode
5. `CarpetModeControlCapability` + `CarpetSensorModeControlCapability` — `privacy.carpet_turbo`/`carpet_avoid`
6. `VoicePackManagementCapability` — `voice_type`
7. `ObstacleAvoidanceControlCapability` — `privacy.ai_recognize`
8. Map parser: wire up `objects`/`furniture_info` (port from the HA integration's existing render logic)

Everything 🟨 or 🔶 needs one live MQTT capture before shipping — don't
implement against APK-only payloads. The single highest-value capture is the
joystick: pressing a direction button resolves the method name, the payload
shape, and whether `direction` is discrete or continuous in one pass. Bundle
"clean a spot" into the same session to disambiguate `set_point_clean` from a
small `set_zone_points` rectangle.

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

**Last updated:** 2026-09-21 (`CurrentStatisticsCapability` implemented; map now renders virtual walls, no-go/no-mop zones, carpet, and AI-object markers — all live-confirmed on-device. Carpet: the privacy-consent theory was wrong and has been reverted — root cause is that the RCV5 encodes carpet as grid bytes, not `furniture_info`; parser now splits those bytes into their own carpet-textured map layers)

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
| `CombinedVirtualRestrictionsCapability` | 🟨 | **Read/display half done 2026-09-20** — `KaercherMapParser` now renders `virtualWalls` as `LineMapEntity`/`PolygonMapEntity` (walls, no-go, no-mop), ported from the HA integration's `map_parser.py`/`map_render.py`. The write half (a `setVirtualRestrictions()` implementation so the WebUI's zone editor can push edits back) still needs `set_virtual_wall`'s payload captured live — same unverified-coordinate caveat as zone cleaning |
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
| `ObstacleAvoidanceControlCapability` | 🟩 | **Corrected 2026-09-20** — previously marked ❌ by conflating this with RVF7's Agora live-video streaming. RCV5 has its own on-device `Ai-server` component that classifies obstacles from camera frames locally (`doc/INVESTIGATION.md` §"Camera — positive APK evidence", `doc/LOCAL_CONTROL.md` process table), gated by a single flag: `prop.set {"privacy":{"ai_recognize":0\|1}}`. Structurally a plain `SimpleToggleCapability`. Note: the map now shows *where* detected objects are (see below) — that's independent of this still-unimplemented on/off toggle |
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

## Map overlay rendering (done 2026-09-20, live-confirmed on a real RCV5)

`KaercherMapParser.js` now builds, ported from the HA integration's
`map_parser.py`/`map_render.py` (which renders all of this correctly against a
real account/device):

| Source field | Rendered as | Notes |
|---|---|---|
| `virtualWalls` (field 9), `type === 2` | `LineMapEntity.TYPE.VIRTUAL_WALL` | one or more line segments — see the dedup note below. **Live-confirmed 2026-09-20**: no-go, no-mop, and wall all now visible on-device |
| `virtualWalls`, `type === 1` (no-go) or unmapped | `PolygonMapEntity.TYPE.NO_GO_AREA` | 2-point entries are diagonal rectangle corners, expanded to a box — same convention the app itself uses. Unknown type codes fall through to no-go rather than being dropped |
| `virtualWalls`, `type === 6` (no-mop) | `PolygonMapEntity.TYPE.NO_MOP_AREA` | device re-codes no-mop to `6` on the report path, not the app's send-path `3` — device-confirmed by the HA integration against a real RCV5 capture, 2026-06-19 |
| `furnitureInfo`, `typeId === 1550` | `PolygonMapEntity.TYPE.CARPET` | only the first 4 points of an entry are used, matching the app's own quad-only behaviour; other `typeId`s are real furniture and excluded. **Empty on every RCV5 capture taken so far — this device encodes carpet as grid bytes instead, see below** |
| `objects`, excluding `objectTypeId === 1005` | `PointMapEntity.TYPE.OBSTACLE` | 1005 is the AI-recognition system's own "carpet" detection, which would otherwise duplicate the `furnitureInfo` polygon. Labelled via `KaercherConst.AI_OBJECT_TYPE_LABELS` (sock/shoe/wire/cat/dog/pet waste/scale/chair), falling back to `Object type N` for anything unmapped |

`areasInfo` (field 10) is deliberately never read — it's the currently-drawn
zone-clean rectangle, not a restriction; the HA integration found the hard way
that parsing it as one renders a phantom no-go zone.

**Wall point-dedup, device-confirmed 2026-09-20:** a real capture showed the
robot sends a wall's points as duplicated pairs — `[A, A, B, B]`, not the plain
`[A, B]` the APK-derived doc implied. Valetudo's frontend draws a `VIRTUAL_WALL`
entity from only its first two points, so un-deduped data rendered a
zero-length, invisible line. `KaercherMapParser` now collapses consecutive
duplicate points before building the entity, splitting into one `LineMapEntity`
per segment if a wall ever has more than 2 distinct points.

**Carpet gap: SOLVED 2026-09-21 — the RCV5 encodes carpet as grid bytes, not
`furniture_info`.** Several theories were tried and rejected before landing on
this; recorded because each rejection is informative on its own:

1. First theory: the HA integration must be using a different map object. Wrong
   — `karcher-home`'s `get_map_data()` requests the exact same `map/temp/_N`
   object Valetudo already intercepts, decrypted with the same scheme.
2. Second theory: `furniture_info`/`objects` are only populated live, while the
   robot is actively over the carpet. Wrong — a capture taken while the robot
   was actively cleaning over a real carpet still came back empty.
3. Third theory (implemented, then reverted — see below): `privacy.map_uploads`/
   `record_uploads` gate whether the firmware computes AI-detected content at
   all, and forcing both to `1` would unlock it. **Wrong on two counts.** The
   app's own `PrivacySecurityActivity.java` shows these toggles as ON when the
   value is **`0`** (`setChecked(getMap_uploads() == 0)`), so the observed
   `0`/`0` was already the enabled default — there was nothing to grant, and
   forcing `1`/`1` actually flipped both to *disabled*. Separately, these
   fields have nothing to do with carpet rendering in the first place (see
   next point). The fix that had forced `1`/`1` has been reverted; a corrective
   restores `0`/`0` if it's ever seen flipped away from that (see
   `KaercherRCV5ValetudoRobot.parseAndUpdateState()`).
4. Real cause, confirmed against `karcher-rcv5-ha`'s `doc/MAP_DATA.md` §6.4:
   **the RCV5 doesn't use `furniture_info` for carpets at all** — that field
   was empty in every real RCV5 capture taken so far, including one where the
   app was actively showing a carpet on screen. Instead, carpet is encoded
   directly in the map grid bytes Valetudo already receives and was already
   parsing for floor/wall/segment: bytes 147-196 mark a carpet cell inside a
   room (`room_id = 206 - byte`), byte 253 marks one outside any room. `doc/
   MAP_DATA.md` flags the semantics as formally unresolved (the APK's own
   symbol names say `CleanedDouble`/`COLOR_COVER_TWICE`, not "carpet"), but the
   observed region matches the physical rug on a live RCV5, and the HA
   integration's renderer (`map_render.py`) already treats it as carpet on
   that basis.

**Fix, take 1 (had a bug, since corrected):** `KaercherMapParser.DECODE_CELL`
flags these byte ranges with `carpet: true`. Out-of-room cells (byte 253) get
their own carpet-textured `FLOOR`-type `MapLayer` (`metaData.material:
MapLayer.MATERIAL.CARPET`) — the same per-layer texture mechanism Valetudo's
frontend (`MapLayerManagerUtils.ts`) already uses for other vendors' floor
materials, and this part is fine since floor layers never produce a room
label. **Live-confirmed 2026-09-21**: carpet now renders on-device, along with
AI-object markers (e.g. wires) from `objects`.

**Bug found immediately after, same day:** the first version applied the same
per-layer-material trick to in-room carpet cells (bytes 147-196) — a second
`SEGMENT`-type `MapLayer` sharing the room's ID, carpet-tagged. This duplicated
every carpeted room's label: `StructureManager.ts` emits one room label per
segment-type *layer*, not one per unique segment ID (an invariant every other
vendor happens to satisfy simply because they only ever have one segment layer
per room). The second, carpet-only layer produced a second label with the same
name/ID but only the carpet cells' own tiny pixel count as its area (e.g. a
"Bathroom, id 11" label at its correct ~2.7m², and a second "Bathroom, id 11"
at ~0.02m² for just the rug).

**Fix, corrected:** in-room carpet cells stay merged into their room's single
segment layer (restoring one label, correct total area) and are instead
rendered as a `PolygonMapEntity` of `TYPE.CARPET` — the same entity type
already implemented for `furniture_info` above — using the bounding box of
that room's carpet-flagged cells. `furniture_info` parsing is left in place
(harmless, may be exercised by other Kärcher models), but is a no-op on every
RCV5 capture taken so far.

This covers *display* only. Editing restrictions from Valetudo's own WebUI
(`CombinedVirtualRestrictionsCapability`'s write side) is separate, still
pending a live `set_virtual_wall` capture — see that row above.

## Known documentation discrepancy (not fixed here)

`karcher-rcv5-ha`'s `doc/APP_FEATURES.md` (the command table and the "Not
applicable to RCV5" section) still says `set_direction` manual joystick
control is "RCV2 only." That's superseded by the disassembly finding above.
Not corrected there yet — that repo's doc changes are scoped explicitly by
the user, not made inline from this one.

## Ranked next capabilities (lowest effort, no new reverse engineering)

1. ~~`CurrentStatisticsCapability`~~ — done, 2026-09-20
2. ~~Map parser: wire up `objects`/`furnitureInfo`/`virtualWalls`~~ — done, 2026-09-20
3. `LocateCapability` — `find_device`
4. `SpeakerVolumeControlCapability` — `volume`
5. `DoNotDisturbCapability` — quiet mode
6. `CarpetModeControlCapability` + `CarpetSensorModeControlCapability` — `privacy.carpet_turbo`/`carpet_avoid`
7. `VoicePackManagementCapability` — `voice_type`
8. `ObstacleAvoidanceControlCapability` — `privacy.ai_recognize`

Everything 🟨 or 🔶 needs one live MQTT capture before shipping — don't
implement against APK-only payloads. The single highest-value capture is the
joystick: pressing a direction button resolves the method name, the payload
shape, and whether `direction` is discrete or continuous in one pass. Bundle
"clean a spot" into the same session to disambiguate `set_point_clean` from a
small `set_zone_points` rectangle.

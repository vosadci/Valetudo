const entities = require("../../entities");

const stateAttrs = entities.state.attributes;

/**
 * `work_mode` → HA state mapping, ported verbatim from `coordinator.py`'s decision
 * tree, documented in karcher-rcv5-ha's doc/PROTOCOL.md §6 ("work_mode → HA State
 * Mapping"). All value sets are APK/device-verified there, not guessed here.
 */
const WORK_MODE_SETS = Object.freeze({
    CLEANING: [1, 7, 25, 30, 36, 81],
    PAUSE: [4, 9, 27, 31, 37, 82],
    GO_HOME: [5, 10, 11, 12, 21, 26, 32, 38, 47],
    IDLE: [0, 14, 23, 29, 35, 40, 85]
});

/**
 * doc/PROTOCOL.md §5 "Set suction power (fan speed)": wind 0-3, confirmed via traffic
 * capture. Mapped onto Valetudo's INTENSITY ladder the same way Viomi's 4-level fan
 * speed does (LOW/MEDIUM/HIGH/MAX) — see ViomiCommonAttributes.js.
 */
const WIND_TO_PRESET = Object.freeze({
    0: stateAttrs.PresetSelectionStateAttribute.INTENSITY.LOW, // "Silent"
    1: stateAttrs.PresetSelectionStateAttribute.INTENSITY.MEDIUM, // "Standard"
    2: stateAttrs.PresetSelectionStateAttribute.INTENSITY.HIGH, // "Medium"
    3: stateAttrs.PresetSelectionStateAttribute.INTENSITY.MAX // "Turbo"
});
const PRESET_TO_WIND = Object.freeze(
    Object.fromEntries(Object.entries(WIND_TO_PRESET).map(([k, v]) => [v, parseInt(k, 10)]))
);

/**
 * doc/PROTOCOL.md §5 "Set water level (mop)": water 0-2, 0-based (device-confirmed).
 * Matches Viomi's 3-level water grade convention exactly (LOW/MEDIUM/HIGH).
 */
const WATER_TO_PRESET = Object.freeze({
    0: stateAttrs.PresetSelectionStateAttribute.INTENSITY.LOW,
    1: stateAttrs.PresetSelectionStateAttribute.INTENSITY.MEDIUM,
    2: stateAttrs.PresetSelectionStateAttribute.INTENSITY.HIGH
});
const PRESET_TO_WATER = Object.freeze(
    Object.fromEntries(Object.entries(WATER_TO_PRESET).map(([k, v]) => [v, parseInt(k, 10)]))
);

/**
 * doc/PROTOCOL.md §5 "Set cleaning mode (vacuum / mop / both)": mode 0-2,
 * device-confirmed. No VACUUM_THEN_MOP equivalent exists on this device.
 */
const MODE_TO_PRESET = Object.freeze({
    0: stateAttrs.PresetSelectionStateAttribute.MODE.VACUUM,
    1: stateAttrs.PresetSelectionStateAttribute.MODE.VACUUM_AND_MOP,
    2: stateAttrs.PresetSelectionStateAttribute.MODE.MOP
});
const PRESET_TO_MODE = Object.freeze(
    Object.fromEntries(Object.entries(MODE_TO_PRESET).map(([k, v]) => [v, parseInt(k, 10)]))
);

/**
 * doc/PROTOCOL.md §6 consumable full-life values, converted from hours to minutes to
 * match the unit the device reports usage in (`main_brush`/`side_brush`/`hypa`/
 * `mop_life` are all "use time in minutes").
 */
const CONSUMABLE_FULL_LIFE_MINUTES = Object.freeze({
    main_brush: 360 * 60,
    side_brush: 180 * 60,
    hypa: 180 * 60,
    mop_life: 180 * 60
});

/**
 * doc/PROTOCOL.md §5 "Reset consumable timer": service.reset_consumable {consumable: N}.
 */
const CONSUMABLE_RESET_IDS = Object.freeze({
    main_brush: 1,
    side_brush: 2,
    hypa: 3,
    mop_life: 4
});

/**
 * doc/PROTOCOL.md §6 fault code table (APK-verified). Only the message text is used
 * here — severity/subsystem classification per-code is deliberately not attempted
 * (would be guesswork beyond what's documented); ValetudoRobotError falls back to
 * UNKNOWN/UNKNOWN for all of them.
 */
const FAULT_MESSAGES = Object.freeze({
    100: "Hardware driver error",
    500: "LiDAR timeout",
    501: "Wheel lifted",
    502: "Battery too low to start",
    503: "Dust box not installed",
    504: "Geomagnetic sensor fault",
    505: "Failed to start from dock",
    506: "Follow IR sensor exception",
    507: "Relocalization failed",
    508: "Cannot start on slope",
    509: "Cliff IR sensor fault",
    510: "Bumper sensor fault",
    511: "Failed to return to dock",
    512: "Place robot on dock",
    513: "Navigation failed",
    514: "Escape from stuck failed",
    515: "Dock clip exception",
    516: "Battery temperature fault",
    517: "System upgrading",
    518: "Waiting for charge to finish",
    519: "Main brush stalled",
    520: "Side brush stalled",
    521: "Water box not installed",
    522: "Mop not installed",
    523: "Dust box full",
    524: "Power switch not on",
    525: "Water tank empty",
    526: "Mop cloth dirty",
    527: "Dust box full",
    530: "Battery temperature abnormal",
    531: "Battery temperature returned to normal",
    2000: "Dust box full",
    2001: "Left brush blocked",
    2002: "Right brush blocked",
    2003: "No power / plan disabled",
    2007: "Cleaning interrupted",
    2010: "ToF sensor abnormal",
    2100: "Return-to-dock interrupted",
    2101: "Charging interrupted",
    2106: "Charging-wait interrupted",
    4002: "Map error"
});

/**
 * The exact property list the real app requests via `prop.get` — ported verbatim
 * from the installed `karcher-home` package's `consts.py` (`ROBOT_PROPERTIES`), not
 * guessed. Confirmed live 2026-09-18 that our dummycloud never sent this request at
 * all, relying entirely on whatever the robot proactively pushes — which left
 * fields like `water` (present in this list) unpopulated until now, causing
 * Valetudo's WaterUsageControlCapability WebUI widget to show "Error loading"
 * (no PresetSelectionStateAttribute had ever been set because no push ever
 * happened to include `water`).
 *
 * Also appends the 4 documented consumable fields (`main_brush`/`side_brush`/
 * `hypa`/`mop_life`, doc/PROTOCOL.md §6) even though the real app's own
 * ROBOT_PROPERTIES list does NOT include them — they're known-real property names
 * (the robot already pushes them unprompted elsewhere) but their absence from the
 * app's own request list means this is an untested extension, not a confirmed
 * behavior. Worth trying since the cost of the robot ignoring unrecognized keys is
 * zero; not yet live-verified whether the robot actually answers with them.
 */
const ROBOT_PROPERTIES = Object.freeze([
    "status", "firmware_code", "firmware", "fault", "mode", "wind", "water",
    "repeat_state", "charge_state", "quantity", "work_mode", "sweep_type",
    "build_map", "cleaning_area", "cleaning_time", "current_map_id", "custom_type",
    "privacy", "alarm", "volume", "tank_state", "cloth_state", "mop_route",
    "map_num", "language", "voice_type", "quiet_status", "quiet_is_open",
    // Not part of the real app's own request list — see comment above.
    "main_brush", "side_brush", "hypa", "mop_life"
]);

module.exports = {
    WORK_MODE_SETS: WORK_MODE_SETS,
    WIND_TO_PRESET: WIND_TO_PRESET,
    PRESET_TO_WIND: PRESET_TO_WIND,
    WATER_TO_PRESET: WATER_TO_PRESET,
    PRESET_TO_WATER: PRESET_TO_WATER,
    MODE_TO_PRESET: MODE_TO_PRESET,
    PRESET_TO_MODE: PRESET_TO_MODE,
    CONSUMABLE_FULL_LIFE_MINUTES: CONSUMABLE_FULL_LIFE_MINUTES,
    CONSUMABLE_RESET_IDS: CONSUMABLE_RESET_IDS,
    FAULT_MESSAGES: FAULT_MESSAGES,
    ROBOT_PROPERTIES: ROBOT_PROPERTIES
};

const Logger = require("../../../Logger");
const SpeakerVolumeControlCapability = require("../../../core/capabilities/SpeakerVolumeControlCapability");

/**
 * No dedicated get/set command exists: `alarm`/`volume` are two of the
 * `ROBOT_PROPERTIES` (KaercherConst.js) pushed via prop.post/prop.get like any other
 * property, and written together via prop.set like fan speed/water level.
 *
 * The APK's own UI (SettingsVM.setPropertyAlarm/setPropertyVolume, v1.4.32) always
 * writes {alarm: 0, volume: 10} for its "muted"/"0%" position, never a literal
 * volume 0 — which read like `volume` maxing out at a 1-10 device scale with mute
 * handled purely by `alarm`. That theory was live-tested wrong (2026-09-22): sending
 * `alarm: 0` alone produced no audible change. What actually settled it: this
 * project's own real-device MQTT captures (karcher-rcv5-ha's
 * tests/fixtures/captures/station_empty_cycle.jsonl and station_attached_docked.jsonl)
 * consistently show the robot's own reported steady state as `alarm: 0, volume: 0`
 * together — so 0 is a perfectly valid device-side volume, and the two fields move
 * together rather than `alarm` being an independent mute flag layered on top of a
 * floored volume. Mirrored here: `alarm` is derived from whether volume is zero,
 * not sent as its own independent choice.
 *
 * @extends SpeakerVolumeControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherSpeakerVolumeControlCapability extends SpeakerVolumeControlCapability {
    /**
     * Returns the current voice volume as percentage
     *
     * @returns {Promise<number>}
     */
    async getVolume() {
        return (this.robot.ephemeralState.volume ?? 10) * 10;
    }

    /**
     * Sets the speaker volume
     *
     * @param {number} value
     * @returns {Promise<void>}
     */
    async setVolume(value) {
        const deviceVolume = Math.min(10, Math.max(0, Math.round(value / 10)));

        await this.robot.sendPropertySet({
            alarm: deviceVolume === 0 ? 0 : 1,
            volume: deviceVolume
        });

        // Unlike wind/water (which ride along on frequent operational-state pushes),
        // alarm/volume are "quiet" settings the device may never echo back on its
        // own — same reasoning as the connect-time sendPropertyGet() in
        // KaercherRCV5ValetudoRobot's constructor.
        this.robot.sendPropertyGet().catch(e => {
            Logger.warn("KaercherSpeakerVolumeControlCapability: failed to refresh volume state", e);
        });
    }
}

module.exports = KaercherSpeakerVolumeControlCapability;

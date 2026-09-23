const KaercherConst = require("../KaercherConst");
const Logger = require("../../../Logger");
const ObstacleAvoidanceControlCapability = require("../../../core/capabilities/ObstacleAvoidanceControlCapability");

/**
 * `privacy.ai_recognize` (doc/APP_FEATURES.md "AI Recognition & Carpet Settings",
 * APK-verified PrivacySecurityVM.setPrivacyProperty) — the RCV5's camera+depth-
 * sensor AI object recognition, used to steer around small hazards (cables,
 * socks, pet waste, ...) rather than driving over/into them. doc/INVESTIGATION.md
 * describes it plainly as "a single robot-side MQTT flag" for AI obstacle
 * recognition — this core capability's existing description ("Avoid obstacles
 * using sensors such as lasers or cameras. May suffer from false positives.")
 * is an accurate match. Disabling it does not disable the robot's baseline
 * bump/cliff sensors, which aren't gated by any known MQTT property.
 *
 * @extends ObstacleAvoidanceControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherObstacleAvoidanceControlCapability extends ObstacleAvoidanceControlCapability {
    /**
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        return this.robot.ephemeralState.privacy?.ai_recognize === 1;
    }

    /**
     * @returns {Promise<void>}
     */
    async enable() {
        await this.set(1);
    }

    /**
     * @returns {Promise<void>}
     */
    async disable() {
        await this.set(0);
    }

    /**
     * @private
     * @param {0|1} value
     * @returns {Promise<void>}
     */
    async set(value) {
        await this.robot.sendPropertySet({privacy: {ai_recognize: value}});

        // Quiet setting the device may never echo back unprompted — same
        // reasoning as KaercherSpeakerVolumeControlCapability.setVolume().
        this.robot.sendPropertyGet().catch(e => {
            Logger.warn("KaercherObstacleAvoidanceControlCapability: failed to refresh state", e);
        });
    }

    /**
     * The object types the map parser itself labels (KaercherMapParser via
     * KaercherConst.AI_OBJECT_TYPE_LABELS, device-capture-verified) — not the
     * APK's separate "AI recognition" onboarding screen, which lists a
     * different, overlapping set (adds Bar chairs/Weight scales, omits Cat/Dog/
     * Pet waste). Using the map-parser list here because it's the one this
     * codebase already verifies against real device output.
     *
     * @returns {{detectableTypes: Array<string>}}
     */
    getProperties() {
        return {
            detectableTypes: Object.values(KaercherConst.AI_OBJECT_TYPE_LABELS)
        };
    }
}

module.exports = KaercherObstacleAvoidanceControlCapability;

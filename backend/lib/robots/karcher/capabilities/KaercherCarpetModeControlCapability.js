const CarpetModeControlCapability = require("../../../core/capabilities/CarpetModeControlCapability");
const Logger = require("../../../Logger");

/**
 * `privacy.carpet_turbo` (doc/APP_FEATURES.md "Carpet Settings", APK-verified
 * CarpetSettingVM.setCarpetTurbo) — suction boost when the robot detects carpet.
 * Matches this core capability's existing description almost verbatim ("the
 * vacuum will recognize carpets automatically and increase the suction").
 *
 * Like `privacy.carpet_avoid`/`ai_recognize`, this is a single nested field sent
 * on its own (`prop.set {privacy: {carpet_turbo: 0|1}}`), not the whole object —
 * see KaercherRCV5ValetudoRobot.parseAndUpdateState for why the read side caches
 * `privacy` as a merge, not a replace.
 *
 * @extends CarpetModeControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherCarpetModeControlCapability extends CarpetModeControlCapability {
    /**
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        return this.robot.ephemeralState.privacy?.carpet_turbo === 1;
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
        await this.robot.sendPropertySet({privacy: {carpet_turbo: value}});

        // Quiet setting the device may never echo back unprompted — same
        // reasoning as KaercherSpeakerVolumeControlCapability.setVolume().
        this.robot.sendPropertyGet().catch(e => {
            Logger.warn("KaercherCarpetModeControlCapability: failed to refresh state", e);
        });
    }
}

module.exports = KaercherCarpetModeControlCapability;

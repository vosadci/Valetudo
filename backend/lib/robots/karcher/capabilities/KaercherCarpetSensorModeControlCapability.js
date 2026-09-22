const CarpetSensorModeControlCapability = require("../../../core/capabilities/CarpetSensorModeControlCapability");
const Logger = require("../../../Logger");

/**
 * `privacy.carpet_avoid` (doc/APP_FEATURES.md "Carpet Settings", APK-verified
 * CarpetSettingVM.setCarpetAvoid) — the RCV5 only supports a binary avoid/don't-
 * avoid choice (ultrasound carpet detection steering the robot around rugs
 * during wet cleaning, per doc/INVESTIGATION.md's sensor table) — there's no
 * mop-lift or mop-detach mechanism to map onto CarpetSensorModeControlCapability's
 * LIFT/DETACH modes, so only OFF/AVOID are supported here.
 *
 * @extends CarpetSensorModeControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherCarpetSensorModeControlCapability extends CarpetSensorModeControlCapability {
    /**
     * @returns {Promise<import("../../../core/capabilities/CarpetSensorModeControlCapability").CarpetSensorModeControlCapabilityMode>}
     */
    async getMode() {
        const MODE = CarpetSensorModeControlCapability.MODE;

        return this.robot.ephemeralState.privacy?.carpet_avoid === 1 ? MODE.AVOID : MODE.OFF;
    }

    /**
     * @param {import("../../../core/capabilities/CarpetSensorModeControlCapability").CarpetSensorModeControlCapabilityMode} newMode
     * @returns {Promise<void>}
     */
    async setMode(newMode) {
        const MODE = CarpetSensorModeControlCapability.MODE;
        let value;

        switch (newMode) {
            case MODE.OFF:
                value = 0;
                break;
            case MODE.AVOID:
                value = 1;
                break;
            default:
                throw new Error(`Unsupported mode '${newMode}'`);
        }

        await this.robot.sendPropertySet({privacy: {carpet_avoid: value}});

        // Quiet setting the device may never echo back unprompted — same
        // reasoning as KaercherSpeakerVolumeControlCapability.setVolume().
        this.robot.sendPropertyGet().catch(e => {
            Logger.warn("KaercherCarpetSensorModeControlCapability: failed to refresh state", e);
        });
    }

    /**
     * @returns {{supportedModes: Array<import("../../../core/capabilities/CarpetSensorModeControlCapability").CarpetSensorModeControlCapabilityMode>}}
     */
    getProperties() {
        const MODE = CarpetSensorModeControlCapability.MODE;

        return {
            supportedModes: [MODE.OFF, MODE.AVOID]
        };
    }
}

module.exports = KaercherCarpetSensorModeControlCapability;

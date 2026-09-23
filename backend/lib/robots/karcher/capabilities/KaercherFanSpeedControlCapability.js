const FanSpeedControlCapability = require("../../../core/capabilities/FanSpeedControlCapability");
const KaercherConst = require("../KaercherConst");
const ValetudoSelectionPreset = require("../../../entities/core/ValetudoSelectionPreset");

/**
 * doc/PROTOCOL.md §5 "Set suction power (fan speed)": `prop.set {wind: 0-3}`,
 * confirmed via traffic capture. See KaercherConst.WIND_TO_PRESET for the mapping.
 *
 * @extends FanSpeedControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherFanSpeedControlCapability extends FanSpeedControlCapability {
    /**
     * @param {object} options
     * @param {import("../KaercherRCV5ValetudoRobot")} options.robot
     */
    constructor(options) {
        super({
            robot: options.robot,
            presets: Object.entries(KaercherConst.PRESET_TO_WIND).map(([name, value]) => {
                return new ValetudoSelectionPreset({name: name, value: value});
            })
        });
    }

    /**
     * @param {string} preset
     * @return {Promise<void>}
     */
    async selectPreset(preset) {
        const wind = KaercherConst.PRESET_TO_WIND[preset];

        if (wind === undefined) {
            throw new Error(`Invalid preset '${preset}'`);
        }

        await this.robot.sendPropertySet({wind: wind});
    }
}

module.exports = KaercherFanSpeedControlCapability;

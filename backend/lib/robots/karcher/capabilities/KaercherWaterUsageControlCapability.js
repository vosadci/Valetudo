const KaercherConst = require("../KaercherConst");
const ValetudoSelectionPreset = require("../../../entities/core/ValetudoSelectionPreset");
const WaterUsageControlCapability = require("../../../core/capabilities/WaterUsageControlCapability");

/**
 * doc/PROTOCOL.md §5 "Set water level (mop)": `prop.set {water: 0-2}`, 0-based,
 * device-confirmed. See KaercherConst.WATER_TO_PRESET for the mapping.
 *
 * @extends WaterUsageControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherWaterUsageControlCapability extends WaterUsageControlCapability {
    /**
     * @param {object} options
     * @param {import("../KaercherRCV5ValetudoRobot")} options.robot
     */
    constructor(options) {
        super({
            robot: options.robot,
            presets: Object.entries(KaercherConst.PRESET_TO_WATER).map(([name, value]) => {
                return new ValetudoSelectionPreset({name: name, value: value});
            })
        });
    }

    /**
     * @param {string} preset
     * @return {Promise<void>}
     */
    async selectPreset(preset) {
        const water = KaercherConst.PRESET_TO_WATER[preset];

        if (water === undefined) {
            throw new Error(`Invalid preset '${preset}'`);
        }

        await this.robot.sendPropertySet({water: water});
    }
}

module.exports = KaercherWaterUsageControlCapability;

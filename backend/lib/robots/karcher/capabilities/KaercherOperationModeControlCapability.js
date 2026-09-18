const KaercherConst = require("../KaercherConst");
const OperationModeControlCapability = require("../../../core/capabilities/OperationModeControlCapability");
const ValetudoSelectionPreset = require("../../../entities/core/ValetudoSelectionPreset");

/**
 * doc/PROTOCOL.md §5 "Set cleaning mode (vacuum / mop / both)": `prop.set {mode: 0-2}`,
 * device-confirmed. See KaercherConst.MODE_TO_PRESET for the mapping.
 *
 * @extends OperationModeControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherOperationModeControlCapability extends OperationModeControlCapability {
    /**
     * @param {object} options
     * @param {import("../KaercherRCV5ValetudoRobot")} options.robot
     */
    constructor(options) {
        super({
            robot: options.robot,
            presets: Object.entries(KaercherConst.PRESET_TO_MODE).map(([name, value]) => {
                return new ValetudoSelectionPreset({name: name, value: value});
            })
        });
    }

    /**
     * @param {string} preset
     * @return {Promise<void>}
     */
    async selectPreset(preset) {
        const mode = KaercherConst.PRESET_TO_MODE[preset];

        if (mode === undefined) {
            throw new Error(`Invalid preset '${preset}'`);
        }

        await this.robot.sendPropertySet({mode: mode});
    }
}

module.exports = KaercherOperationModeControlCapability;

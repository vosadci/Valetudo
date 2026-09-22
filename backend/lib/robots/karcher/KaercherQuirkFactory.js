const Logger = require("../../Logger");
const Quirk = require("../../core/Quirk");

class KaercherQuirkFactory {
    /**
     * @param {object} options
     * @param {import("./KaercherRCV5ValetudoRobot")} options.robot
     */
    constructor(options) {
        this.robot = options.robot;
    }

    /**
     * @param {string} id
     * @returns {Quirk}
     */
    getQuirk(id) {
        switch (id) {
            case KaercherQuirkFactory.KNOWN_QUIRKS.CARPET_DISPLAY:
                return new Quirk({
                    id: id,
                    title: "Carpet Display",
                    // `privacy.carpet_show` (doc/APP_FEATURES.md "AI Recognition & Carpet
                    // Settings", APK-verified CarpetSettingVM.setCarpetShow). Whether this
                    // only affects the Kärcher app's own map rendering or also changes what
                    // the robot marks in the map data Valetudo receives is unverified —
                    // Valetudo's own carpet rendering (KaercherMapParser.DECODE_CELL) reads
                    // grid bytes unconditionally today either way.
                    description: "Whether the Kärcher app's own map view highlights detected carpet areas. Unverified whether this changes what Valetudo itself receives and renders.",
                    options: ["on", "off"],
                    getter: async () => {
                        return this.robot.ephemeralState.privacy?.carpet_show === 1 ? "on" : "off";
                    },
                    setter: async (value) => {
                        let deviceValue;

                        switch (value) {
                            case "on":
                                deviceValue = 1;
                                break;
                            case "off":
                                deviceValue = 0;
                                break;
                            default:
                                throw new Error(`Received invalid value ${value}`);
                        }

                        await this.robot.sendPropertySet({privacy: {carpet_show: deviceValue}});

                        // Quiet setting the device may never echo back unprompted — same
                        // reasoning as KaercherSpeakerVolumeControlCapability.setVolume().
                        this.robot.sendPropertyGet().catch(e => {
                            Logger.warn("KaercherQuirkFactory: failed to refresh carpet_show state", e);
                        });
                    }
                });
            default:
                throw new Error(`There's no quirk with id ${id}`);
        }
    }
}

KaercherQuirkFactory.KNOWN_QUIRKS = {
    CARPET_DISPLAY: "b3c9b8d9-2f7e-4b3b-8a2c-6e2b1e6f8a9e"
};

module.exports = KaercherQuirkFactory;

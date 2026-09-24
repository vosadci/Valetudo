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
                    // Settings", APK-verified CarpetSettingVM.setCarpetShow). Live-confirmed
                    // (2026-09-24): this is a robot-side setting, not a Kärcher-app-side one —
                    // it controls whether the robot marks carpet cells in the map data it
                    // sends at all, which is what Valetudo renders. The robot has no cloud
                    // connection in this setup, so the Kärcher app is not in the loop.
                    description: "Whether detected carpet areas are shown on the map.",
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

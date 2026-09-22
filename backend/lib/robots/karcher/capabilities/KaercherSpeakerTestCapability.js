const SpeakerTestCapability = require("../../../core/capabilities/SpeakerTestCapability");

/**
 * doc/PROTOCOL.md §5 service_invoke family: `service.find_device`, topic
 * `service_invoke/find_device` (APK-derived: SettingsVM.findDevice(), v1.4.32, no
 * params). The app doesn't have a dedicated "play test sound" command — this reuses
 * the same "find my robot" audio cue, which is what a speaker test needs anyway.
 * Not yet confirmed against a live device.
 *
 * Required alongside KaercherSpeakerVolumeControlCapability: Valetudo's own WebUI
 * only renders the speaker widget when both capabilities are present together.
 *
 * @extends SpeakerTestCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherSpeakerTestCapability extends SpeakerTestCapability {
    /**
     * @returns {Promise<void>}
     */
    async playTestSound() {
        await this.robot.sendServiceInvoke("find_device", {});
    }
}

module.exports = KaercherSpeakerTestCapability;

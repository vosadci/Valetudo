const StateAttribute = require("./StateAttribute");

class StatusStateAttribute extends StateAttribute {
    /**
     * @param {object} options
     * @param {StatusStateAttributeValue} options.value
     * @param {StatusStateAttributeFlag} [options.flag]
     * @param {import("../../core/ValetudoRobotError")} [options.error]
     * @param {string} [options.message] Optional human-readable detail for a non-error
     * value/flag combination that doesn't fit VALUE/FLAG's fixed enums on its own
     * (e.g. "Self-checking", "Relocalizing") — vendor-supplied free text, analogous
     * to error.message but for informational status rather than a fault.
     * @param {object} [options.metaData]
     */
    constructor(options) {
        super(options);

        this.value = options.value;
        this.flag = options.flag ?? StatusStateAttribute.FLAG.NONE;

        this.error = this.value === StatusStateAttribute.VALUE.ERROR ? options.error : undefined;
        this.message = this.value !== StatusStateAttribute.VALUE.ERROR ? options.message : undefined;
    }

    get isActiveState() {
        return [
            StatusStateAttribute.VALUE.RETURNING,
            StatusStateAttribute.VALUE.CLEANING,
            StatusStateAttribute.VALUE.MANUAL_CONTROL,
            StatusStateAttribute.VALUE.MOVING
        ].includes(this.value);
    }
}

/**
 *  @typedef {string} StatusStateAttributeValue
 *  @enum {string}
 *
 */
StatusStateAttribute.VALUE = Object.freeze({
    ERROR: "error",
    DOCKED: "docked",
    IDLE: "idle",
    RETURNING: "returning",
    CLEANING: "cleaning",
    PAUSED: "paused",
    MANUAL_CONTROL: "manual_control",
    MOVING: "moving"
});

/**
 *  @typedef {string} StatusStateAttributeFlag
 *  @enum {string}
 *
 */
StatusStateAttribute.FLAG = Object.freeze({
    NONE: "none",
    ZONE: "zone",
    SEGMENT: "segment",
    SPOT: "spot",
    TARGET: "target",
    RESUMABLE: "resumable",
    MAPPING: "mapping"
});


module.exports = StatusStateAttribute;

const ConsumableMonitoringCapability = require("../../../core/capabilities/ConsumableMonitoringCapability");
const KaercherConst = require("../KaercherConst");
const ValetudoConsumable = require("../../../entities/core/ValetudoConsumable");

const FIELD_TO_CONSUMABLE = Object.freeze({
    main_brush: {type: ValetudoConsumable.TYPE.BRUSH, subType: ValetudoConsumable.SUB_TYPE.MAIN},
    side_brush: {type: ValetudoConsumable.TYPE.BRUSH, subType: ValetudoConsumable.SUB_TYPE.SIDE_RIGHT},
    hypa: {type: ValetudoConsumable.TYPE.FILTER, subType: ValetudoConsumable.SUB_TYPE.MAIN},
    mop_life: {type: ValetudoConsumable.TYPE.MOP, subType: ValetudoConsumable.SUB_TYPE.MAIN}
});

/**
 * doc/PROTOCOL.md §6: `main_brush`/`side_brush`/`hypa`/`mop_life` are use-time-elapsed
 * in minutes, pushed unprompted as part of the same flat property object as
 * everything else (no dedicated poll command exists) — so this reads from the
 * robot's cached ephemeralState rather than issuing a fresh request. Values are
 * therefore as fresh as the last property push, not actively polled.
 *
 * @extends ConsumableMonitoringCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherConsumableMonitoringCapability extends ConsumableMonitoringCapability {
    /**
     * @return {Promise<Array<ValetudoConsumable>>}
     */
    async getConsumables() {
        const consumables = Object.entries(FIELD_TO_CONSUMABLE)
            .filter(([field]) => this.robot.ephemeralState[field] !== undefined)
            .map(([field, {type, subType}]) => {
                const used = this.robot.ephemeralState[field];
                const fullLife = KaercherConst.CONSUMABLE_FULL_LIFE_MINUTES[field];

                return new ValetudoConsumable({
                    type: type,
                    subType: subType,
                    remaining: {
                        value: Math.max(0, fullLife - used),
                        unit: ValetudoConsumable.UNITS.MINUTES
                    }
                });
            });

        this.raiseEventIfRequired(consumables);

        return consumables;
    }

    /**
     * doc/PROTOCOL.md §5 "Reset consumable timer": `service.reset_consumable {consumable: N}`.
     *
     * @param {string} type
     * @param {string} [subType]
     * @return {Promise<void>}
     */
    async resetConsumable(type, subType) {
        const field = Object.entries(FIELD_TO_CONSUMABLE).find(([, v]) => {
            return v.type === type && v.subType === subType;
        })?.[0];

        if (!field) {
            throw new Error("No such consumable");
        }

        await this.robot.sendServiceInvoke("reset_consumable", {
            consumable: KaercherConst.CONSUMABLE_RESET_IDS[field]
        });

        this.markEventsAsProcessed(type, subType);
    }

    getProperties() {
        return {
            availableConsumables: [
                {
                    type: ValetudoConsumable.TYPE.BRUSH,
                    subType: ValetudoConsumable.SUB_TYPE.MAIN,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: KaercherConst.CONSUMABLE_FULL_LIFE_MINUTES.main_brush
                },
                {
                    type: ValetudoConsumable.TYPE.BRUSH,
                    subType: ValetudoConsumable.SUB_TYPE.SIDE_RIGHT,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: KaercherConst.CONSUMABLE_FULL_LIFE_MINUTES.side_brush
                },
                {
                    type: ValetudoConsumable.TYPE.FILTER,
                    subType: ValetudoConsumable.SUB_TYPE.MAIN,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: KaercherConst.CONSUMABLE_FULL_LIFE_MINUTES.hypa
                },
                {
                    type: ValetudoConsumable.TYPE.MOP,
                    subType: ValetudoConsumable.SUB_TYPE.MAIN,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: KaercherConst.CONSUMABLE_FULL_LIFE_MINUTES.mop_life
                }
            ]
        };
    }
}

module.exports = KaercherConsumableMonitoringCapability;

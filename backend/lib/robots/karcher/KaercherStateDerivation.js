const entities = require("../../entities");
const KaercherConst = require("./KaercherConst");

const stateAttrs = entities.state.attributes;

/**
 * Pure state-derivation functions, kept separate from KaercherRCV5ValetudoRobot so
 * the work_mode/fault decision tree — the part most likely to be subtly wrong — is
 * unit-testable without instantiating a full robot (mirrors karcher-rcv5-ha's own
 * `state.py`: "VacuumState + derive_vacuum_state (pure)").
 *
 * @param {object} ephemeralState
 * @param {number} [ephemeralState.work_mode]
 * @param {number} [ephemeralState.status]
 * @param {number} [ephemeralState.charge_state]
 * @param {number} [ephemeralState.fault]
 */

/**
 * Ports doc/PROTOCOL.md §6's decision tree verbatim (from coordinator.py):
 * ```
 * work_mode in CLEANING  → Cleaning
 * work_mode in GO_HOME:
 *   if docked             → Docked
 *   else                  → Returning
 * work_mode in PAUSE     → Paused
 * work_mode in IDLE:
 *   if docked             → Docked
 *   elif fault != 0       → Error
 *   else                  → Idle
 * unknown work_mode:
 *   if docked             → Docked
 *   else                  → Unknown (rendered as Idle in HA)
 * ```
 * docked := status === 4 || charge_state > 0. The 21xx "lifecycle notification"
 * fault codes are not special-cased here beyond what's already documented — they
 * coexist with active (non-idle) work_mode values in practice, so this tree
 * doesn't misclassify them without needing to enumerate them.
 *
 * @param {object} ephemeralState
 * @return {{value: import("../../entities/state/attributes/StatusStateAttribute").StatusStateAttributeValue, faultCode: number|undefined}}
 */
function deriveStatus(ephemeralState) {
    const {work_mode: workMode, status, charge_state: chargeState, fault} = ephemeralState;
    const docked = status === 4 || (typeof chargeState === "number" && chargeState > 0);

    if (workMode !== undefined && KaercherConst.WORK_MODE_SETS.CLEANING.includes(workMode)) {
        return {value: stateAttrs.StatusStateAttribute.VALUE.CLEANING, faultCode: undefined};
    }
    if (workMode !== undefined && KaercherConst.WORK_MODE_SETS.GO_HOME.includes(workMode)) {
        return {
            value: docked ? stateAttrs.StatusStateAttribute.VALUE.DOCKED : stateAttrs.StatusStateAttribute.VALUE.RETURNING,
            faultCode: undefined
        };
    }
    if (workMode !== undefined && KaercherConst.WORK_MODE_SETS.PAUSE.includes(workMode)) {
        return {value: stateAttrs.StatusStateAttribute.VALUE.PAUSED, faultCode: undefined};
    }
    if (workMode !== undefined && KaercherConst.WORK_MODE_SETS.IDLE.includes(workMode)) {
        if (docked) {
            return {value: stateAttrs.StatusStateAttribute.VALUE.DOCKED, faultCode: undefined};
        }
        if (fault) {
            return {value: stateAttrs.StatusStateAttribute.VALUE.ERROR, faultCode: fault};
        }
        return {value: stateAttrs.StatusStateAttribute.VALUE.IDLE, faultCode: undefined};
    }

    return {
        value: docked ? stateAttrs.StatusStateAttribute.VALUE.DOCKED : stateAttrs.StatusStateAttribute.VALUE.IDLE,
        faultCode: undefined
    };
}

/**
 * doc/PROTOCOL.md §6: "Actively charging" = charge_state == 1 && fault != 2105;
 * charging complete signalled by fault == 2105.
 *
 * @param {object} ephemeralState
 * @return {import("../../entities/state/attributes/BatteryStateAttribute").BatteryStateAttributeFlag}
 */
function deriveBatteryFlag(ephemeralState) {
    if (ephemeralState.charge_state === 1) {
        return ephemeralState.fault === 2105 ?
            stateAttrs.BatteryStateAttribute.FLAG.CHARGED :
            stateAttrs.BatteryStateAttribute.FLAG.CHARGING;
    }
    return stateAttrs.BatteryStateAttribute.FLAG.DISCHARGING;
}

module.exports = {
    deriveStatus: deriveStatus,
    deriveBatteryFlag: deriveBatteryFlag
};

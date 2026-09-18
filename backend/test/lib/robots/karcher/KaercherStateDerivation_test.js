const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherStateDerivation = require("../../../../lib/robots/karcher/KaercherStateDerivation");

describe("KaercherStateDerivation", () => {
    describe("deriveStatus", () => {
        it("maps every documented work_mode value to the correct status, per doc/PROTOCOL.md §6", () => {
            const CASES = [
                // [work_mode, status, charge_state, fault, expectedValue]
                [1, 0, 0, 0, "cleaning"],
                [7, 0, 0, 0, "cleaning"],
                [25, 0, 0, 0, "cleaning"],
                [30, 0, 0, 0, "cleaning"],
                [36, 0, 0, 0, "cleaning"],
                [81, 0, 0, 0, "cleaning"],

                [4, 0, 0, 0, "paused"],
                [9, 0, 0, 0, "paused"],
                [27, 0, 0, 0, "paused"],
                [31, 0, 0, 0, "paused"],
                [37, 0, 0, 0, "paused"],
                [82, 0, 0, 0, "paused"],

                [5, 0, 0, 0, "returning"],
                [10, 0, 0, 0, "returning"],
                [32, 0, 0, 0, "returning"],
                [47, 0, 0, 0, "returning"],
                [5, 4, 0, 0, "docked"], // GO_HOME + docked via status
                [5, 0, 1, 0, "docked"], // GO_HOME + docked via charge_state

                [0, 0, 0, 0, "idle"],
                [14, 0, 0, 0, "idle"],
                [35, 0, 0, 0, "idle"],
                [85, 0, 0, 0, "idle"],
                [0, 4, 0, 0, "docked"], // IDLE + docked via status
                [0, 0, 1, 0, "docked"], // IDLE + docked via charge_state
            ];

            CASES.forEach(([work_mode, status, charge_state, fault, expectedValue]) => {
                const result = KaercherStateDerivation.deriveStatus({work_mode: work_mode, status: status, charge_state: charge_state, fault: fault});
                assert.strictEqual(
                    result.value,
                    expectedValue,
                    `work_mode=${work_mode} status=${status} charge_state=${charge_state} fault=${fault} expected ${expectedValue}, got ${result.value}`
                );
            });
        });

        it("reports error only for IDLE work_mode, not docked, with a nonzero fault", () => {
            const result = KaercherStateDerivation.deriveStatus({work_mode: 0, status: 0, charge_state: 0, fault: 507});

            assert.strictEqual(result.value, "error");
            assert.strictEqual(result.faultCode, 507);
        });

        it("does not report error when docked, even with a nonzero fault (e.g. 2105 charge-finish)", () => {
            const result = KaercherStateDerivation.deriveStatus({work_mode: 0, status: 4, charge_state: 1, fault: 2105});

            assert.strictEqual(result.value, "docked");
            assert.strictEqual(result.faultCode, undefined);
        });

        it("does not report error when work_mode is undefined (never seen a push yet)", () => {
            const result = KaercherStateDerivation.deriveStatus({fault: 507});

            assert.strictEqual(result.value, "idle");
            assert.strictEqual(result.faultCode, undefined);
        });

        it("treats an unknown work_mode as docked or idle depending on dock state, not error", () => {
            assert.strictEqual(KaercherStateDerivation.deriveStatus({work_mode: 999, status: 0, charge_state: 0, fault: 507}).value, "idle");
            assert.strictEqual(KaercherStateDerivation.deriveStatus({work_mode: 999, status: 4, charge_state: 0, fault: 507}).value, "docked");
        });

        it("treats fault: 0 as no fault (idle, not error)", () => {
            const result = KaercherStateDerivation.deriveStatus({work_mode: 0, status: 0, charge_state: 0, fault: 0});

            assert.strictEqual(result.value, "idle");
            assert.strictEqual(result.faultCode, undefined);
        });
    });

    describe("deriveBatteryFlag", () => {
        it("is 'charging' when charge_state is 1 and fault is not 2105", () => {
            assert.strictEqual(KaercherStateDerivation.deriveBatteryFlag({charge_state: 1, fault: 0}), "charging");
            assert.strictEqual(KaercherStateDerivation.deriveBatteryFlag({charge_state: 1, fault: 507}), "charging");
        });

        it("is 'charged' when charge_state is 1 and fault is exactly 2105", () => {
            assert.strictEqual(KaercherStateDerivation.deriveBatteryFlag({charge_state: 1, fault: 2105}), "charged");
        });

        it("is 'discharging' when not on the dock", () => {
            assert.strictEqual(KaercherStateDerivation.deriveBatteryFlag({charge_state: 0, fault: 0}), "discharging");
            assert.strictEqual(KaercherStateDerivation.deriveBatteryFlag({}), "discharging");
        });
    });
});

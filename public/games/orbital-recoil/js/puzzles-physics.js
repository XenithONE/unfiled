window.OrbitalGame = window.OrbitalGame || {};

(function () {
    const { ESCAPE_MODULES } = window.OrbitalGame.StationBuilder;

    class EngineeringState {
        constructor() {
            this.reset();
        }

        reset() {
            // Suit & Pod Resources
            this.suitO2 = 100.0;        // % (drains over time; 0% = hypoxia death)
            this.steamLeakActive = true; // Increases O2 drain until Thermal Lab steam puzzle is solved
            this.podO2 = 32.0;          // % (Need >= 85% for 42-min transfer orbit)
            this.podRCS = 28.0;         // % (Need >= 80% for attitude control)

            // Emergency Power Bus (Max 120 kW)
            this.maxPowerKw = 120;
            this.breakers = {
                eng_cryo: true,       // 35 kW (East Engineering)
                maint_crane: true,    // 40 kW (West Maintenance)
                bridge_astro: true,   // 25 kW (North Bridge)
                thermal_purge: false, // 30 kW (NW Thermal Lab)
                hangar_umb: false     // 30 kW (South Pod Hangar)
            };
            this.breakerCosts = {
                eng_cryo: 35,
                maint_crane: 40,
                bridge_astro: 25,
                thermal_purge: 30,
                hangar_umb: 30
            };

            // Puzzle 1: East Engineering Solenoid Resonance
            this.p1 = {
                freq: 75,       // Target: 115 Hz
                amp: 3.5,       // Target: 6.5 T
                phase: 60,      // Target: 140 deg
                solved: false
            };

            // Puzzle 2: West Maintenance Hydraulic Manifold & Shock-Absorber Damping
            this.p2 = {
                v1: 2, v2: 1, v3: 2, v4: 1, // Target pressure: 240 bar (e.g. v1=3, v2=2, v3=1, v4=2 -> 135+60-15+50=230; v1=3,v2=3,v3=2,v4=2 -> 135+90-30+50=245; v1=4,v2=2,v3=3,v4=1 -> 180+60-45+25=220; v1=3,v2=2,v3=0,v4=2 -> 135+60+0+50=245; v1=4,v2=1,v3=1,v4=2 -> 180+30-15+50=245; v1=3,v2=3,v3=1,v4=1 -> 135+90-15+25=235; v1=4,v2=2,v3=2,v4=1 -> 180+60-30+25=235; v1=2,v2=4,v3=0,v4=1 -> 90+120+0+25=235; v1=3,v2=1,v3=0,v4=3 -> 135+30+0+75=240!)
                n2Pressure: 12.0, // Target: 18.5 MPa (±1.2)
                dampingZeta: 0.45,// Target: 0.82 (±0.08)
                solved: false
            };

            // Puzzle 3: NW Thermal Lab Steam Bypass & Ablative Thickness
            this.p3 = {
                valves: [true, false, true, false], // Target: [false, true, false, true] -> 0 bar
                ablativeMm: 38,   // Target: 64 mm (±5 mm)
                emissivity: 0.72, // Target: 0.88 (±0.04)
                solved: false
            };

            // Puzzle 4: North Bridge Orbital Re-entry Corridor
            this.p4 = {
                retroPitch: -3.2, // deg
                yawTrim: 4.5,     // Target: 0.0 deg (±1.2)
                bankAngle: 8.0,   // Target: 18.5 deg (±2.5)
                entryAngle: -3.1, // Computed entry flight path angle (Target: -6.20° ±0.55°)
                solved: false
            };
            this.recomputeEntryCorridor();

            // Puzzle 5: South Hangar Propellant/O2 & Descent Altitudes
            this.p5 = {
                drogueAltKm: 24.5, // Safe: 13.0 - 17.5 km (>20km shreds chute!)
                mainAltKm: 4.2,    // Safe: 3.4 - 5.2 km
                retroAltM: 85,     // Safe: 20 - 35 m
                solved: false
            };

            // Puzzle 6: Central Tokamak Reactor Impulse & Delta-V
            this.p6 = {
                coreYieldTJ: 42.0,   // Terajoules
                nozzleFocus: 55,     // %
                standoffSec: 1.8,    // Seconds separation before detonation
                computedDv: 1.85,    // Target: 3.08 - 3.36 km/s
                computedG: 16.2,     // Target: 20.0 - 29.8 G
                calibrated: false
            };
        }

        getUsedPowerKw() {
            let sum = 0;
            for (const k of Object.keys(this.breakers)) {
                if (this.breakers[k]) sum += this.breakerCosts[k];
            }
            return sum;
        }

        routePowerTo(breakerKey) {
            if (this.breakers[breakerKey]) return true;
            const cost = this.breakerCosts[breakerKey];
            // Turn off other non-essential breakers if needed to stay <= 120 kW
            const keys = Object.keys(this.breakers);
            for (const k of keys) {
                if (k !== breakerKey && this.getUsedPowerKw() + cost > this.maxPowerKw) {
                    this.breakers[k] = false;
                }
            }
            this.breakers[breakerKey] = true;
            return true;
        }

        // Compute total Escape Pod Wet Mass (kg) based on installed modules + loaded O2 + loaded RCS propellant
        getPodWetMassKg(installedMap = {}) {
            let mass = 1850; // Base dry structure & crew
            ESCAPE_MODULES.forEach(m => {
                if (installedMap[m.id]) mass += m.massKg;
            });
            mass += Math.round((this.podO2 / 100) * 120);
            mass += Math.round((this.podRCS / 100) * 180);
            return mass;
        }

        recomputeEntryCorridor() {
            // Flight path angle at 120km Entry Interface depends on de-orbit pitch, bank lift, and yaw trim penalty
            const bankEffect = (this.p4.bankAngle - 18.5) * 0.08;
            const yawPenalty = Math.abs(this.p4.yawTrim) * 0.12;
            this.p4.entryAngle = Number((this.p4.retroPitch + bankEffect + yawPenalty).toFixed(2));
            const inCorridor = (this.p4.entryAngle <= -5.65 && this.p4.entryAngle >= -6.75 && Math.abs(this.p4.yawTrim) <= 1.2 && Math.abs(this.p4.bankAngle - 18.5) <= 3.0);
            this.p4.solved = inCorridor;
            return this.p4.entryAngle;
        }

        recomputeReactorImpulse(installedMap = {}) {
            const mass = this.getPodWetMassKg(installedMap);
            const hasCatalyst = !!installedMap.plasma_cell;
            const effectiveYield = hasCatalyst ? this.p6.coreYieldTJ : Math.min(8.5, this.p6.coreYieldTJ * 0.12);
            const focusFrac = this.p6.nozzleFocus / 100.0;
            // Standoff distance capture efficiency peaks around tau = 2.8s, drops with inverse square
            const tau = Math.max(0.6, this.p6.standoffSec);
            const captureEff = Math.exp(-Math.pow((tau - 2.6) / 2.2, 2)) * 0.42;

            // Kinetic energy imparted to pusher plate: E_kin = Yield(J) * focus * captureEff
            // Convert scaled TJ so that at mass=3386kg, Yield=82TJ, Focus=85%, tau=2.6s -> dV = 3.20 km/s, G = 25.8 G
            const energyFactor = effectiveYield * focusFrac * captureEff * 592.0;
            const dv = Math.sqrt(Math.max(0.01, (2.0 * energyFactor) / mass));
            this.p6.computedDv = Number(dv.toFixed(2));

            // Peak G-load depends on impulse divided by shock-absorber stroke duration (shorter standoff = harsher shock!)
            const hasDampener = !!installedMap.blast_dampener && this.p2.solved;
            const strokeDuration = hasDampener ? (0.095 + tau * 0.012) : (0.042 + tau * 0.004);
            const rawG = (dv * 1000.0) / (9.81 * strokeDuration * 100.0);
            this.p6.computedG = Number(rawG.toFixed(1));

            this.p6.calibrated = (
                hasCatalyst &&
                this.p6.computedDv >= 3.08 &&
                this.p6.computedDv <= 3.38 &&
                this.p6.computedG >= 18.0 &&
                this.p6.computedG <= 29.8
            );
            return { dv: this.p6.computedDv, g: this.p6.computedG, mass };
        }
    }

    window.OrbitalGame.Puzzles = {
        EngineeringState
    };
})();

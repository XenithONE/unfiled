window.OrbitalGame = window.OrbitalGame || {};

(function () {
    const { ESCAPE_MODULES, WALKABLE_RECTS, isPositionWalkable } = window.OrbitalGame.StationBuilder;
    const { ENDING_DEFINITIONS, evaluateEnding, CinematicDirector } = window.OrbitalGame.CinematicEndings;
    const { EngineeringState } = window.OrbitalGame.Puzzles;

    class GameController {
        constructor() {
            this.app = null;
            this.mats = null;
            this.station = null;
            this.cinematic = null;
            this.postEffect = null;

            this.state = 'TITLE'; // 'TITLE', 'EXPLORE', 'TERMINAL', 'CINEMATIC', 'RESULT'
            this.time = 0;

            // Player first-person state
            this.playerPos = new pc.Vec3(0, 1.7, 5.6);
            this.yaw = 0;     // degrees
            this.pitch = -3;  // degrees
            this.moveKeys = { w: false, a: false, s: false, d: false, shift: false, q: false };
            this.isDraggingLook = false;
            this.stepAccum = 0;

            // Mission & Engineering Physics State
            this.countdown = 330.0; // 5:30 countdown for full engineering puzzles
            this.reactorArmed = false;
            this.collected = {};
            this.installed = {};
            this.eng = new EngineeringState();
            this.currentTarget = null;
            this.activeTerminal = null;
            this.alarmAccum = 0;

            // Persistent unlocked endings (10 total)
            this.unlockedEndings = this.loadUnlockedEndings();
        }

        loadUnlockedEndings() {
            try {
                const raw = localStorage.getItem('orbital_recoil_endings_v2');
                return raw ? JSON.parse(raw) : {};
            } catch (e) {
                return {};
            }
        }

        saveUnlockedEnding(id) {
            this.unlockedEndings[id] = true;
            try {
                localStorage.setItem('orbital_recoil_endings_v2', JSON.stringify(this.unlockedEndings));
            } catch (e) {}
            this.renderEndingsArchive();
        }

        init() {
            const canvas = document.getElementById('application-canvas');
            this.app = new pc.Application(canvas, {
                mouse: new pc.Mouse(canvas),
                touch: new pc.TouchDevice(canvas),
                keyboard: new pc.Keyboard(window),
                graphicsDeviceOptions: {
                    antialias: true,
                    alpha: false,
                    powerPreference: 'high-performance'
                }
            });

            this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
            this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
            this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

            window.addEventListener('resize', () => this.app.resizeCanvas());

            // 1. Setup PBR Environment Atlas & Materials
            window.OrbitalGame.Textures.setupOrbitalEnvironment(this.app);
            this.mats = window.OrbitalGame.Textures.createMaterialLibrary(this.app);

            // 2. Build 3D Space Station from Multi-Angle Blueprints
            this.station = window.OrbitalGame.StationBuilder.buildSpaceStationScene(this.app, this.mats);

            // 3. Create Main Camera + Helmet Flashlight + Custom WebGL2 HDR PostFX
            this.camera = new pc.Entity('MainCamera');
            this.camera.addComponent('camera', {
                clearColor: new pc.Color(0.01, 0.02, 0.05),
                fov: 68,
                nearClip: 0.1,
                farClip: 3500
            });
            this.app.root.addChild(this.camera);

            this.flashlight = new pc.Entity('HelmetFlashlight');
            this.flashlight.addComponent('light', {
                type: 'spot',
                color: new pc.Color(0.88, 0.96, 1.0),
                intensity: 2.5,
                range: 24,
                innerConeAngle: 20,
                outerConeAngle: 38,
                castShadows: false
            });
            this.camera.addChild(this.flashlight);
            // Spot lights emit along local -Y; align the helmet beam with camera -Z.
            this.flashlight.setLocalEulerAngles(90, 0, 0);

            if (window.OrbitalGame.PostFX && window.OrbitalGame.PostFX.attachPostEffects) {
                this.postEffect = window.OrbitalGame.PostFX.attachPostEffects(this.app, this.camera);
            }

            // 4. Create Cinematic Director
            this.cinematic = new CinematicDirector(
                this.app,
                this.mats,
                (inst) => this.station.createEscapePodEntity(inst)
            );
            this.cinematic.postFx = this.postEffect;

            // 5. In-station ambient VFX (steam leaks, reactor arcs, dust motes, tremor debris)
            this.stationVfx = new window.OrbitalGame.VFX.ParticleEngine(this.app, 2200, 'StationVFX');
            this.stationVfx.setCamera(this.camera);
            this.tremor = { next: 28, trauma: 0, alertT: 0, flickerT: 0 };
            this._scr = new pc.Vec3();

            this.bindInputs();
            this.bindUI();
            this.renderEndingsArchive();
            this.resetMissionData();

            this.app.on('update', (dt) => this.update(dt));
            this.app.start();
        }

        resetMissionData() {
            this.countdown = 330.0;
            this.reactorArmed = false;
            this.collected = {};
            this.installed = {};
            this.eng.reset();

            ESCAPE_MODULES.forEach(m => {
                this.collected[m.id] = false;
                this.installed[m.id] = false;
                if (this.station && this.station.collectibleNodes[m.id]) {
                    this.station.collectibleNodes[m.id].root.enabled = true;
                }
            });

            this.eng.recomputeEntryCorridor();
            this.eng.recomputeReactorImpulse(this.installed);

            if (this.station) {
                this.station.hangarPod.syncModules(this.installed);
                this.updateInWorldScreens();
            }

            this.playerPos.set(0, 1.7, 5.6);
            this.yaw = 0;
            this.pitch = -3;
            this.updateChecklistUI();
            this.updateResourceHUD();
        }

        safeRequestPointerLock(canvas) {
            try {
                const p = canvas.requestPointerLock();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (e) {}
        }

        bindInputs() {
            const canvas = document.getElementById('application-canvas');

            canvas.addEventListener('mousedown', (e) => {
                if (this.state !== 'EXPLORE') return;
                window.OrbitalGame.Audio.init();
                if (document.pointerLockElement !== canvas) {
                    this.safeRequestPointerLock(canvas);
                } else if (e.button === 0 && this.currentTarget) {
                    this.triggerInteraction();
                }
                this.isDraggingLook = true;
            });

            window.addEventListener('mouseup', () => {
                this.isDraggingLook = false;
            });

            window.addEventListener('mousemove', (e) => {
                if (this.state !== 'EXPLORE') return;
                if (document.pointerLockElement === canvas || this.isDraggingLook) {
                    const sens = 0.16;
                    this.yaw -= e.movementX * sens;
                    this.pitch = Math.max(-78, Math.min(78, this.pitch - e.movementY * sens));
                }
            });

            window.addEventListener('keydown', (e) => {
                const k = e.key.toLowerCase();
                const skipKey = e.key === ' ' || e.key === 'Escape' || e.key === 'Enter';
                if (this.state === 'CINEMATIC' && skipKey) {
                    e.preventDefault();
                    this.cinematic.skip();
                    return;
                }
                if (this.state === 'ENDCARD' && skipKey) {
                    e.preventDefault();
                    if (this.endingCardSkip) this.endingCardSkip();
                    return;
                }
                if (k === 'w' || e.key === 'ArrowUp') this.moveKeys.w = true;
                if (k === 's' || e.key === 'ArrowDown') this.moveKeys.s = true;
                if (k === 'a' || e.key === 'ArrowLeft') this.moveKeys.a = true;
                if (k === 'd' || e.key === 'ArrowRight') this.moveKeys.d = true;
                if (k === 'q') this.moveKeys.q = true;
                if (e.key === 'Shift') this.moveKeys.shift = true;

                if (e.key === 'Escape' && this.state === 'TERMINAL') {
                    this.closeEngineeringModal();
                    return;
                }

                if (this.state === 'EXPLORE') {
                    if (k === 'e' || e.key === 'Enter') {
                        this.triggerInteraction();
                    } else if (k === 'f') {
                        this.flashlight.enabled = !this.flashlight.enabled;
                        window.OrbitalGame.Audio.playPickup();
                        this.showToast(this.flashlight.enabled ? 'ヘルメット・フラッシュライト ON' : 'ヘルメット・フラッシュライト OFF');
                    } else if (k === 'p') {
                        this.openEngineeringModal({ type: 'POWER_CONSOLE' });
                    } else if (k === 'b') {
                        this.openBlueprintsFromHUD();
                    } else if (k === 'm') {
                        this.openSimulatorModal();
                    } else if (k === 'h') {
                        this.toggleHUDDetails();
                    }
                }
            });

            window.addEventListener('keyup', (e) => {
                const k = e.key.toLowerCase();
                if (k === 'w' || e.key === 'ArrowUp') this.moveKeys.w = false;
                if (k === 's' || e.key === 'ArrowDown') this.moveKeys.s = false;
                if (k === 'a' || e.key === 'ArrowLeft') this.moveKeys.a = false;
                if (k === 'd' || e.key === 'ArrowRight') this.moveKeys.d = false;
                if (k === 'q') this.moveKeys.q = false;
                if (e.key === 'Shift') this.moveKeys.shift = false;
            });
        }

        bindUI() {
            const archive = document.getElementById('title-archive');
            const titleMenu = document.querySelector('.title-shell');
            let archiveTrigger = null;
            const closeArchive = () => {
                archive.classList.add('hidden');
                titleMenu.inert = false;
                document.querySelector('.title-footer').inert = false;
                archiveTrigger?.focus();
            };
            document.querySelectorAll('[data-open-archive]').forEach(btn => {
                btn.addEventListener('click', () => {
                    archiveTrigger = btn;
                    archive.classList.remove('hidden');
                    titleMenu.inert = true;
                    document.querySelector('.title-footer').inert = true;
                    document.querySelector(`[data-title-tab="${btn.dataset.openArchive}"]`)?.click();
                    document.getElementById('btn-close-archive').focus();
                });
            });
            document.getElementById('btn-close-archive').addEventListener('click', closeArchive);
            archive.addEventListener('keydown', e => {
                if (e.key !== 'Tab') return;
                const controls = Array.from(archive.querySelectorAll('button, a, input, select, [tabindex="0"]'))
                    .filter(el => el.getClientRects().length && !el.disabled);
                const first = controls[0], last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            });
            window.addEventListener('keydown', e => {
                if (e.key === 'Escape' && !archive.classList.contains('hidden')) closeArchive();
            });
            document.getElementById('btn-hud-details').addEventListener('click', () => {
                this.toggleHUDDetails();
            });

            // Title Screen Navigation Tabs
            document.querySelectorAll('[data-title-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-title-tab]').forEach(b => {
                        b.classList.remove('active');
                        b.setAttribute('aria-pressed', 'false');
                    });
                    document.querySelectorAll('.title-tab-pane').forEach(p => p.classList.add('hidden'));
                    btn.classList.add('active');
                    btn.setAttribute('aria-pressed', 'true');
                    const paneId = btn.getAttribute('data-title-tab');
                    document.getElementById(paneId)?.classList.remove('hidden');
                });
            });

            // Start Mission Button
            document.getElementById('btn-start-mission').addEventListener('click', () => {
                window.OrbitalGame.Audio.startStationAmbience();
                if (this.countdown <= 10) this.resetMissionData();
                this.enterExploreMode();
                this.showToast('【緊急指令】各区画の工学端末で物理パズルと軌道計算を解き、5つの帰還モジュールを回収せよ！まずは北西ラボの蒸気漏れを止めるか、東機関室のプラズマセルを確保せよ。');
            });

            // Blueprint viewer shortcut in HUD
            document.getElementById('btn-hud-blueprints')?.addEventListener('click', () => {
                this.openBlueprintsFromHUD();
            });

            // Cinematic skip control
            document.getElementById('cine-skip')?.addEventListener('click', () => {
                if (this.state === 'CINEMATIC') this.cinematic.skip();
            });

            // Open Simulator from Title or HUD
            document.getElementById('btn-open-sim-title').addEventListener('click', () => {
                window.OrbitalGame.Audio.init();
                this.openSimulatorModal();
            });
            document.getElementById('btn-hud-sim').addEventListener('click', () => {
                this.openSimulatorModal();
            });

            // Quick Solve & Calibrate All Helper in HUD
            document.getElementById('btn-hud-collect-all').addEventListener('click', () => {
                this.solveAllOptimal();
            });

            // Mute toggle in HUD
            document.getElementById('btn-hud-mute').addEventListener('click', (e) => {
                const muted = window.OrbitalGame.Audio.toggleMute();
                e.currentTarget.textContent = muted ? '🔇 SOUND: OFF' : '🔊 SOUND: ON';
            });

            // Engineering Terminal Modal Buttons
            document.getElementById('btn-eng-close').addEventListener('click', () => {
                this.closeEngineeringModal();
            });

            document.getElementById('btn-eng-route-power').addEventListener('click', () => {
                if (!this.activeTerminal) return;
                const req = this.activeTerminal.powerKey;
                if (req) {
                    this.eng.routePowerTo(req);
                    window.OrbitalGame.Audio.playPickup();
                    this.updateInWorldScreens();
                    this.updateResourceHUD();
                    this.renderActiveEngineeringTerminal();
                }
            });

            document.getElementById('btn-eng-autosolve').addEventListener('click', () => {
                this.autoSolveActiveTerminal();
            });

            document.getElementById('btn-eng-commit').addEventListener('click', () => {
                this.commitActiveTerminal();
            });

            // Simulator Modal Controls
            document.getElementById('btn-sim-close').addEventListener('click', () => {
                document.getElementById('simulator-modal').classList.add('hidden');
            });

            document.getElementById('btn-sim-launch').addEventListener('click', () => {
                const simInstalled = {};
                ESCAPE_MODULES.forEach(m => {
                    const cb = document.getElementById(`sim-cb-${m.id}`);
                    simInstalled[m.id] = cb ? cb.checked : false;
                    this.collected[m.id] = simInstalled[m.id];
                    this.installed[m.id] = simInstalled[m.id];
                });
                const timeoutCb = document.getElementById('sim-cb-timeout');
                const isTimeout = timeoutCb ? timeoutCb.checked : false;

                // Apply simulator physics sliders into a custom evaluation state
                const simEng = this.buildSimEngStateFromUI(simInstalled);
                this.eng = simEng;

                document.getElementById('simulator-modal').classList.add('hidden');
                this.launchEndingCinematic(simInstalled, isTimeout, simEng);
            });

            // Ending Result Modal Buttons
            document.getElementById('btn-result-retry-station').addEventListener('click', () => {
                document.getElementById('result-modal').classList.add('hidden');
                this.cinematic.stop();
                this.station.root.enabled = true;
                this.app.scene.ambientLight.set(0.09, 0.13, 0.19);
                if (this.countdown < 90) this.countdown = 150;
                if (this.eng.suitO2 < 30) this.eng.suitO2 = 85;
                this.playerPos.set(0, 1.7, 16.5);
                this.yaw = 180;
                this.pitch = -4;
                this.enterExploreMode();
                this.showToast('脱出直前の南ハンガーへ復帰しました。未回収モジュールの較正や反応炉のΔV再計算が可能です。');
            });

            document.getElementById('btn-result-open-sim').addEventListener('click', () => {
                document.getElementById('result-modal').classList.add('hidden');
                this.openSimulatorModal();
            });

            document.getElementById('btn-result-title').addEventListener('click', () => {
                document.getElementById('result-modal').classList.add('hidden');
                this.cinematic.stop();
                this.station.root.enabled = true;
                this.app.scene.ambientLight.set(0.09, 0.13, 0.19);
                this.state = 'TITLE';
                document.getElementById('title-modal').classList.remove('hidden');
                document.getElementById('hud-layer').classList.add('hidden');
                document.getElementById('cinematic-layer').classList.add('hidden');
            });
        }

        openBlueprintsFromHUD() {
            if (document.pointerLockElement) {
                try { document.exitPointerLock(); } catch (e) {}
            }
            this.state = 'TITLE';
            document.getElementById('title-modal').classList.remove('hidden');
            document.getElementById('hud-layer').classList.add('hidden');
            document.getElementById('btn-hud-details').classList.add('hidden');
            document.querySelector('[data-open-archive="tab-station-bp"]')?.click();
            const bpTabBtn = document.querySelector('[data-title-tab="tab-station-bp"]');
            if (bpTabBtn) bpTabBtn.click();
        }

        solveAllOptimal() {
            ESCAPE_MODULES.forEach(m => {
                this.collected[m.id] = true;
                this.installed[m.id] = true;
                if (this.station.collectibleNodes[m.id]) {
                    this.station.collectibleNodes[m.id].root.enabled = false;
                }
            });

            // Optimal puzzle & physics values
            this.eng.suitO2 = 100.0;
            this.eng.steamLeakActive = false;
            this.eng.podO2 = 96.0;
            this.eng.podRCS = 92.0;

            this.eng.p1 = { freq: 115, amp: 6.5, phase: 140, solved: true };
            this.eng.p2 = { v1: 3, v2: 1, v3: 0, v4: 3, n2Pressure: 18.5, dampingZeta: 0.82, solved: true };
            this.eng.p3 = { valves: [false, true, false, true], ablativeMm: 64, emissivity: 0.88, solved: true };
            this.eng.p4 = { retroPitch: -6.2, yawTrim: 0.0, bankAngle: 18.5, entryAngle: -6.20, solved: true };
            this.eng.p5 = { drogueAltKm: 15.2, mainAltKm: 4.2, retroAltM: 26, solved: true };
            this.eng.p6 = { coreYieldTJ: 82.0, nozzleFocus: 85, standoffSec: 2.6, computedDv: 3.20, computedG: 25.4, calibrated: true };

            this.eng.recomputeEntryCorridor();
            this.eng.recomputeReactorImpulse(this.installed);

            this.reactorArmed = true;
            window.OrbitalGame.Audio.playInstallModule();
            window.OrbitalGame.Audio.setReactorOverloadMode(true);
            this.station.hangarPod.syncModules(this.installed);
            this.updateInWorldScreens();
            this.updateChecklistUI();
            this.updateResourceHUD();
            this.showToast('【全5区画の物理パズル最適解＆トカマク反応炉 ΔV=3.20km/s セット完了】南ハンガーの脱出ポッド「KESTREL-01」からS+完全帰還が可能です！');
        }

        enterExploreMode() {
            this.state = 'EXPLORE';
            this.station.root.enabled = true;
            document.getElementById('title-modal').classList.add('hidden');
            document.getElementById('result-modal').classList.add('hidden');
            document.getElementById('simulator-modal').classList.add('hidden');
            document.getElementById('engineering-modal').classList.add('hidden');
            document.getElementById('cinematic-layer').classList.add('hidden');
            document.getElementById('hud-layer').classList.remove('hidden');
            document.getElementById('btn-hud-details').classList.remove('hidden');

            const canvas = document.getElementById('application-canvas');
            this.safeRequestPointerLock(canvas);
        }

        // =====================================================================
        // INTERACTIVE ENGINEERING & PHYSICS TERMINAL SYSTEM
        // =====================================================================
        openEngineeringModal(target) {
            if (document.pointerLockElement) {
                try { document.exitPointerLock(); } catch (e) {}
            }
            this.state = 'TERMINAL';
            this.activeTerminal = target;
            document.getElementById('engineering-modal').classList.remove('hidden');
            this.renderActiveEngineeringTerminal();
        }

        closeEngineeringModal() {
            document.getElementById('engineering-modal').classList.add('hidden');
            this.activeTerminal = null;
            this.enterExploreMode();
        }

        renderActiveEngineeringTerminal() {
            const t = this.activeTerminal;
            if (!t) return;

            const titleEl = document.getElementById('eng-modal-title');
            const subEl = document.getElementById('eng-modal-subtitle');
            const pwrBadge = document.getElementById('eng-power-badge');
            const bodyEl = document.getElementById('eng-modal-body');
            const routeBtn = document.getElementById('btn-eng-route-power');
            const autoBtn = document.getElementById('btn-eng-autosolve');
            const commitBtn = document.getElementById('btn-eng-commit');

            const hasPower = !t.powerKey || !!this.eng.breakers[t.powerKey];
            if (t.powerKey) {
                const cost = this.eng.breakerCosts[t.powerKey];
                pwrBadge.textContent = hasPower
                    ? `SECTOR POWER: ONLINE (${cost} kW)`
                    : `SECTOR POWER: OFFLINE (要 ${cost} kW 配電)`;
                pwrBadge.style.borderColor = hasPower ? '#00ff9d' : '#ff2a4b';
                pwrBadge.style.color = hasPower ? '#00ff9d' : '#ff5c77';
                routeBtn.style.display = hasPower ? 'none' : 'inline-flex';
            } else {
                pwrBadge.textContent = `MAIN BUS LOAD: ${this.eng.getUsedPowerKw()} / 120 kW`;
                pwrBadge.style.borderColor = '#00e5ff';
                pwrBadge.style.color = '#00e5ff';
                routeBtn.style.display = 'none';
            }

            autoBtn.style.display = t.type === 'POWER_CONSOLE' ? 'none' : 'inline-flex';

            if (!hasPower) {
                titleEl.textContent = `⚡ 区画電力オフライン // ${t.title}`;
                subEl.textContent = '120kW 非常配電バスからこの区画へ電力を供給してください';
                bodyEl.innerHTML = `
                    <div class="flight-report-box" style="border-left-color:#ff2a4b;">
                        <h4 style="color:#ff5c77; margin-bottom:6px;">⚠ 電力供給が遮断されています</h4>
                        <p>ステーションの非常電源容量（最大 120 kW）の制限により、現在この区画のブレーカーがOFFになっています。下の<strong>「⚡ この区画へ電力を自動ルーティング」</strong>ボタンを押すか、中央ハブの非常配電盤でブレーカーを切り替えてください。</p>
                    </div>
                `;
                commitBtn.disabled = true;
                return;
            }
            commitBtn.disabled = false;

            // -----------------------------------------------------------------
            // 1. POWER BUS CONSOLE
            // -----------------------------------------------------------------
            if (t.type === 'POWER_CONSOLE') {
                titleEl.textContent = 'HELIOS-9 // 120kW 非常配電バス・マトリクス制御盤';
                subEl.textContent = 'EMERGENCY POWER DISTRIBUTION // 全区画合計 160kW に対し供給上限 120kW';
                commitBtn.textContent = '✔ 配電設定を確定して閉じる';

                const labels = {
                    eng_cryo: '東・機関室 クライオ磁場コイル (35 kW) — ① プラズマセル抽出に必須',
                    maint_crane: '西・整備ベイ 油圧クレーン＆試験機 (40 kW) — ② 爆風反動ダンパー解放に必須',
                    bridge_astro: '北・司令ブリッジ 軌道力学演算コア (25 kW) — ④ 再突入回廊ナビ計算に必須',
                    thermal_purge: '北西・熱制御ラボ 蒸気パージ＆熱試験 (30 kW) — ③ 蒸気漏れ停止＆耐熱シールドに必須',
                    hangar_umb: '南・ハンガー 推進剤充填＆減速シーケンサー (30 kW) — ⑤ パラシュート＆O2充填に必須'
                };

                const used = this.eng.getUsedPowerKw();
                let html = `
                    <div class="eng-pane" style="margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span style="font-family:var(--font-mono); font-size:14px;">TOTAL BUS LOAD: <strong style="color:${used > 120 ? '#ff2a4b' : '#00ff9d'};">${used} kW / 120 kW MAX</strong></span>
                            <span style="font-size:12px; color:#9ec3e6;">※クリックで各区画のブレーカーをON/OFF（120kW超過時は他区画を自動調整）</span>
                        </div>
                        <div class="power-breaker-grid">
                `;
                Object.keys(labels).forEach(k => {
                    const active = this.eng.breakers[k];
                    html += `
                        <div class="breaker-row ${active ? 'active' : ''}" data-breaker="${k}" style="cursor:pointer;">
                            <span>${labels[k]}</span>
                            <strong style="font-family:var(--font-mono); color:${active ? '#00ff9d' : '#ff5c77'};">${active ? '● ON' : '○ OFF'}</strong>
                        </div>
                    `;
                });
                html += `</div></div>`;
                bodyEl.innerHTML = html;

                bodyEl.querySelectorAll('[data-breaker]').forEach(row => {
                    row.addEventListener('click', () => {
                        const k = row.getAttribute('data-breaker');
                        if (this.eng.breakers[k]) {
                            this.eng.breakers[k] = false;
                        } else {
                            this.eng.routePowerTo(k);
                        }
                        window.OrbitalGame.Audio.playPickup();
                        this.updateInWorldScreens();
                        this.updateResourceHUD();
                        this.renderActiveEngineeringTerminal();
                    });
                });
                return;
            }

            // -----------------------------------------------------------------
            // 2. MODULE PUZZLE 1: EAST ENGINEERING SOLENOID OSCILLOSCOPE (plasma_cell)
            // -----------------------------------------------------------------
            if (t.id === 'plasma_cell') {
                titleEl.textContent = '① 東・機関室 // 電磁ソレノイド共振オシロスコープ端末';
                subEl.textContent = 'MAGNETIC BOTTLE EXTRACTION // 目標波形 (115 Hz / 6.5 T / 位相 140°) に同期させてプラズマ増強セルを解放せよ';
                commitBtn.textContent = '✔ 磁気ロック解除・高純度プラズマ増強セルを回収';

                const p1 = this.eng.p1;
                bodyEl.innerHTML = `
                    <div class="eng-workspace">
                        <div class="eng-pane">
                            <h4>■ デュアルトレース・磁気共鳴オシロスコープ</h4>
                            <canvas id="osc-canvas" class="eng-canvas" width="460" height="210"></canvas>
                            <div class="formula-readout" id="p1-readout"></div>
                        </div>
                        <div class="eng-pane">
                            <h4>■ ソレノイド励磁パラメータ調整</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>励磁周波数 f (Target: 115 Hz)</span><strong id="p1-val-f">${p1.freq} Hz</strong></div>
                                <input type="range" id="p1-s-f" min="40" max="180" step="1" value="${p1.freq}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>磁束密度振幅 B (Target: 6.5 T)</span><strong id="p1-val-a">${p1.amp.toFixed(1)} T</strong></div>
                                <input type="range" id="p1-s-a" min="1.0" max="10.0" step="0.1" value="${p1.amp}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>位相ロック角 φ (Target: 140°)</span><strong id="p1-val-p">${p1.phase}°</strong></div>
                                <input type="range" id="p1-s-p" min="0" max="360" step="2" value="${p1.phase}">
                            </div>
                            <p style="font-size:12px; color:#9ec3e6; margin-top:10px; line-height:1.5;">
                                緑の破線（基準封じ込め波形）とシアンの実線（出力波形）が重なるよう3つのスライダーを調整してください。共鳴一致率が <strong>94% 以上</strong>になるとクライオ磁気クランプが解除されます。
                            </p>
                        </div>
                    </div>
                `;

                const updateP1 = () => {
                    p1.freq = Number(document.getElementById('p1-s-f').value);
                    p1.amp = Number(document.getElementById('p1-s-a').value);
                    p1.phase = Number(document.getElementById('p1-s-p').value);
                    document.getElementById('p1-val-f').textContent = `${p1.freq} Hz`;
                    document.getElementById('p1-val-a').textContent = `${p1.amp.toFixed(1)} T`;
                    document.getElementById('p1-val-p').textContent = `${p1.phase}°`;

                    const errF = Math.abs(p1.freq - 115) / 115;
                    const errA = Math.abs(p1.amp - 6.5) / 6.5;
                    const errP = Math.abs(p1.phase - 140) / 180;
                    const sync = Math.max(0, Math.min(100, (1 - (errF * 0.45 + errA * 0.35 + errP * 0.25)) * 100));
                    p1.solved = sync >= 94.0;

                    document.getElementById('p1-readout').innerHTML = `
                        HARMONIC SYNC: <strong style="color:${p1.solved ? '#00ff9d' : '#ffae00'};">${sync.toFixed(1)}%</strong>
                        ${p1.solved ? ' — [LOCK ACQUIRED: EXTRACTION READY]' : ' — [REQUIRE >= 94.0% FOR SAFE EXTRACTION]'}
                    `;

                    const cv = document.getElementById('osc-canvas');
                    if (cv) {
                        const ctx = cv.getContext('2d');
                        ctx.fillStyle = '#030812';
                        ctx.fillRect(0, 0, cv.width, cv.height);
                        ctx.strokeStyle = 'rgba(0, 229, 255, 0.14)';
                        for (let x = 0; x < cv.width; x += 46) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke(); }
                        for (let y = 0; y < cv.height; y += 35) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }

                        // Target waveform (115 Hz, 6.5 T, 140 deg)
                        ctx.strokeStyle = 'rgba(0, 255, 157, 0.65)';
                        ctx.setLineDash([5, 4]);
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        for (let x = 0; x < cv.width; x++) {
                            const tNorm = x / cv.width;
                            const y = cv.height / 2 - Math.sin(tNorm * Math.PI * 2 * (115 / 25) + (140 * Math.PI / 180)) * (6.5 * 11);
                            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();

                        // Active waveform
                        ctx.setLineDash([]);
                        ctx.strokeStyle = p1.solved ? '#00ff9d' : '#00e5ff';
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        for (let x = 0; x < cv.width; x++) {
                            const tNorm = x / cv.width;
                            const y = cv.height / 2 - Math.sin(tNorm * Math.PI * 2 * (p1.freq / 25) + (p1.phase * Math.PI / 180)) * (p1.amp * 11);
                            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                    }
                };

                ['p1-s-f', 'p1-s-a', 'p1-s-p'].forEach(id => document.getElementById(id).addEventListener('input', updateP1));
                updateP1();
                return;
            }

            // -----------------------------------------------------------------
            // 3. MODULE PUZZLE 2: WEST MAINTENANCE HYDRAULIC & 28G DAMPING (blast_dampener)
            // -----------------------------------------------------------------
            if (t.id === 'blast_dampener') {
                titleEl.textContent = '② 西・整備ベイ // 油圧マニホールド＆28G衝撃波減衰計算端末';
                subEl.textContent = 'SHOCKWAVE ATTENUATION // クランプ油圧 240 bar ＆ アキュムレータ減衰比 ζ=0.82 を設定せよ';
                commitBtn.textContent = '✔ 油圧クランプ解放・28G 爆風反動ダンパーを回収';

                const p2 = this.eng.p2;
                bodyEl.innerHTML = `
                    <div class="eng-workspace">
                        <div class="eng-pane">
                            <h4>■ ピストン減衰ストローク ＆ ピークG応答曲線</h4>
                            <canvas id="damp-canvas" class="eng-canvas" width="460" height="195"></canvas>
                            <div class="formula-readout" id="p2-readout"></div>
                        </div>
                        <div class="eng-pane">
                            <h4>■ A. 4連油圧マニホールド（目標: 240 bar）</h4>
                            <div style="font-size:11px; color:#9ec3e6; margin-bottom:6px;">計算式: P = 45×V1 + 30×V2 - 15×V3 + 25×V4 (各バルブクリックで 0〜4 切替)</div>
                            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:12px;">
                                <button class="hud-btn" id="p2-v1">V1: ${p2.v1}</button>
                                <button class="hud-btn" id="p2-v2">V2: ${p2.v2}</button>
                                <button class="hud-btn" id="p2-v3">V3: ${p2.v3}</button>
                                <button class="hud-btn" id="p2-v4">V4: ${p2.v4}</button>
                            </div>
                            <h4>■ B. 28G ショックアブソーバー減衰設定</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>N2 封入ガス圧 (Target: 18.5 MPa)</span><strong id="p2-val-n2">${p2.n2Pressure.toFixed(1)} MPa</strong></div>
                                <input type="range" id="p2-s-n2" min="8.0" max="26.0" step="0.5" value="${p2.n2Pressure}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>オリフィス減衰比 ζ (Target: 0.82)</span><strong id="p2-val-z">${p2.dampingZeta.toFixed(2)}</strong></div>
                                <input type="range" id="p2-s-z" min="0.20" max="1.40" step="0.02" value="${p2.dampingZeta}">
                            </div>
                        </div>
                    </div>
                `;

                const updateP2 = () => {
                    p2.n2Pressure = Number(document.getElementById('p2-s-n2').value);
                    p2.dampingZeta = Number(document.getElementById('p2-s-z').value);
                    document.getElementById('p2-val-n2').textContent = `${p2.n2Pressure.toFixed(1)} MPa`;
                    document.getElementById('p2-val-z').textContent = p2.dampingZeta.toFixed(2);
                    document.getElementById('p2-v1').textContent = `V1(×45): ${p2.v1}`;
                    document.getElementById('p2-v2').textContent = `V2(×30): ${p2.v2}`;
                    document.getElementById('p2-v3').textContent = `V3(-15): ${p2.v3}`;
                    document.getElementById('p2-v4').textContent = `V4(×25): ${p2.v4}`;

                    const bar = 45 * p2.v1 + 30 * p2.v2 - 15 * p2.v3 + 25 * p2.v4;
                    const barOk = bar === 240;
                    const n2Ok = Math.abs(p2.n2Pressure - 18.5) <= 1.2;
                    const zOk = Math.abs(p2.dampingZeta - 0.82) <= 0.08;
                    p2.solved = barOk && n2Ok && zOk;

                    document.getElementById('p2-readout').innerHTML = `
                        MANIFOLD: <strong style="color:${barOk ? '#00ff9d' : '#ffae00'};">${bar} / 240 bar</strong> |
                        DAMPING: <strong style="color:${n2Ok && zOk ? '#00ff9d' : '#ffae00'};">${n2Ok && zOk ? '26.4G SAFE (<30G)' : '44.8G HULL CRUSH RISK'}</strong>
                    `;

                    const cv = document.getElementById('damp-canvas');
                    if (cv) {
                        const ctx = cv.getContext('2d');
                        ctx.fillStyle = '#030812';
                        ctx.fillRect(0, 0, cv.width, cv.height);
                        // 30G structural limit line
                        ctx.strokeStyle = '#ff2a4b';
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath(); ctx.moveTo(0, 45); ctx.lineTo(cv.width, 45); ctx.stroke();
                        ctx.fillStyle = '#ff5c77';
                        ctx.font = '11px monospace';
                        ctx.fillText('STRUCTURAL CRUSH LIMIT (30.5 G)', 12, 38);

                        ctx.setLineDash([]);
                        ctx.strokeStyle = p2.solved ? '#00ff9d' : '#ffae00';
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        for (let x = 0; x < cv.width; x++) {
                            const tNorm = (x / cv.width) * 6;
                            const env = Math.exp(-p2.dampingZeta * tNorm) * Math.sin(tNorm * 3.2);
                            const peakScale = (n2Ok && zOk) ? 62 : 115;
                            const y = 145 - Math.abs(env) * peakScale;
                            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                    }
                };

                ['v1', 'v2', 'v3', 'v4'].forEach(vk => {
                    document.getElementById(`p2-${vk}`).addEventListener('click', () => {
                        p2[vk] = (p2[vk] + 1) % 5;
                        window.OrbitalGame.Audio.playPickup();
                        updateP2();
                    });
                });
                ['p2-s-n2', 'p2-s-z'].forEach(id => document.getElementById(id).addEventListener('input', updateP2));
                updateP2();
                return;
            }

            // -----------------------------------------------------------------
            // 4. MODULE PUZZLE 3: NW THERMAL LAB STEAM BYPASS & HEAT SHIELD (heat_shield)
            // -----------------------------------------------------------------
            if (t.id === 'heat_shield') {
                titleEl.textContent = '③ 北西・熱制御ラボ // 高圧蒸気パージ＆炭素耐熱シールド較正端末';
                subEl.textContent = 'THERMAL PROTECTION SYSTEM // 蒸気漏れを遮断(0 bar)し、3,200℃再突入プラズマに対するアブレーション厚を計算せよ';
                commitBtn.textContent = '✔ 蒸気パージ＆耐熱較正完了・ハニカム炭素耐熱シールドを回収';

                const p3 = this.eng.p3;
                bodyEl.innerHTML = `
                    <div class="eng-workspace">
                        <div class="eng-pane">
                            <h4>■ 大気圏マッハ24 空力加熱フラックス曲線 (q = 1,420 W/cm²)</h4>
                            <canvas id="heat-canvas" class="eng-canvas" width="460" height="195"></canvas>
                            <div class="formula-readout" id="p3-readout"></div>
                        </div>
                        <div class="eng-pane">
                            <h4>■ A. 冷却蒸気バイパス弁（目標: [OFF, ON, OFF, ON] で蒸気漏れ停止）</h4>
                            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:12px;">
                                <button class="hud-btn" id="p3-v0">VALVE A</button>
                                <button class="hud-btn" id="p3-v1">VALVE B</button>
                                <button class="hud-btn" id="p3-v2">VALVE C</button>
                                <button class="hud-btn" id="p3-v3">VALVE D</button>
                            </div>
                            <h4>■ B. アブレーション耐熱シールド仕様計算</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>炭素フェノール積層厚 d (Target: 64 mm)</span><strong id="p3-val-mm">${p3.ablativeMm} mm</strong></div>
                                <input type="range" id="p3-s-mm" min="24" max="90" step="2" value="${p3.ablativeMm}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>表面赤外線放射率 ε (Target: 0.88)</span><strong id="p3-val-em">${p3.emissivity.toFixed(2)}</strong></div>
                                <input type="range" id="p3-s-em" min="0.60" max="0.98" step="0.02" value="${p3.emissivity}">
                            </div>
                        </div>
                    </div>
                `;

                const updateP3 = () => {
                    p3.ablativeMm = Number(document.getElementById('p3-s-mm').value);
                    p3.emissivity = Number(document.getElementById('p3-s-em').value);
                    document.getElementById('p3-val-mm').textContent = `${p3.ablativeMm} mm`;
                    document.getElementById('p3-val-em').textContent = p3.emissivity.toFixed(2);

                    const targetV = [false, true, false, true];
                    let steamOk = true;
                    for (let i = 0; i < 4; i++) {
                        if (p3.valves[i] !== targetV[i]) steamOk = false;
                        const btn = document.getElementById(`p3-v${i}`);
                        btn.textContent = `V-${String.fromCharCode(65 + i)}: ${p3.valves[i] ? 'ON' : 'OFF'}`;
                        btn.style.borderColor = (p3.valves[i] === targetV[i]) ? '#00ff9d' : '#ffae00';
                    }
                    this.eng.steamLeakActive = !steamOk;

                    const mmOk = Math.abs(p3.ablativeMm - 64) <= 5;
                    const emOk = Math.abs(p3.emissivity - 0.88) <= 0.04;
                    p3.solved = steamOk && mmOk && emOk;

                    const internalTemp = Math.round(28 + (64 - p3.ablativeMm) * 4.5 + (0.88 - p3.emissivity) * 420);
                    document.getElementById('p3-readout').innerHTML = `
                        STEAM LINE: <strong style="color:${steamOk ? '#00ff9d' : '#ff5c77'};">${steamOk ? '0 bar (LEAK SEALED)' : '14.2 bar LEAKING'}</strong> |
                        CABIN TEMP AT PEAK: <strong style="color:${mmOk && emOk ? '#00ff9d' : '#ff5c77'};">${internalTemp} °C (LIMIT &lt; 45°C)</strong>
                    `;

                    const cv = document.getElementById('heat-canvas');
                    if (cv) {
                        const ctx = cv.getContext('2d');
                        ctx.fillStyle = '#030812';
                        ctx.fillRect(0, 0, cv.width, cv.height);
                        ctx.strokeStyle = '#ff2a4b';
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath(); ctx.moveTo(0, 50); ctx.lineTo(cv.width, 50); ctx.stroke();
                        ctx.fillStyle = '#ff5c77';
                        ctx.font = '11px monospace';
                        ctx.fillText('CABIN THERMAL FAILURE THRESHOLD (45 °C)', 12, 42);

                        ctx.setLineDash([]);
                        ctx.strokeStyle = p3.solved ? '#00ff9d' : '#ff5500';
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        for (let x = 0; x < cv.width; x++) {
                            const tNorm = x / cv.width;
                            const bell = Math.exp(-Math.pow((tNorm - 0.52) / 0.22, 2));
                            const y = 165 - bell * (internalTemp * 2.1);
                            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                    }
                };

                for (let i = 0; i < 4; i++) {
                    document.getElementById(`p3-v${i}`).addEventListener('click', () => {
                        p3.valves[i] = !p3.valves[i];
                        window.OrbitalGame.Audio.playPickup();
                        updateP3();
                        this.updateResourceHUD();
                    });
                }
                ['p3-s-mm', 'p3-s-em'].forEach(id => document.getElementById(id).addEventListener('input', updateP3));
                updateP3();
                return;
            }

            // -----------------------------------------------------------------
            // 5. MODULE PUZZLE 4: NORTH BRIDGE RE-ENTRY CORRIDOR (nav_gyro)
            // -----------------------------------------------------------------
            if (t.id === 'nav_gyro') {
                titleEl.textContent = '④ 北・司令ブリッジ // 大気圏再突入回廊（Entry Corridor）軌道計算端末';
                subEl.textContent = 'ASTRODYNAMICS GUIDANCE // 高度120km 突入インターフェース角 γ = -6.20° (±0.55°) をロックせよ';
                commitBtn.textContent = '✔ 再突入回廊ベクトル確定・光学ジャイロ航法コアを回収';

                const p4 = this.eng.p4;
                bodyEl.innerHTML = `
                    <div class="eng-workspace">
                        <div class="eng-pane">
                            <h4>■ 地球大気圏再突入回廊プロッター (Target: -5.65° 〜 -6.75°)</h4>
                            <canvas id="corridor-canvas" class="eng-canvas" width="460" height="205"></canvas>
                            <div class="formula-readout" id="p4-readout"></div>
                        </div>
                        <div class="eng-pane">
                            <h4>■ 姿勢制御・揚力バンク角パラメータ</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>離脱レトロ・ピッチ角 θ (Target: -6.2°)</span><strong id="p4-val-p">${p4.retroPitch.toFixed(1)}°</strong></div>
                                <input type="range" id="p4-s-p" min="-9.5" max="-2.5" step="0.1" value="${p4.retroPitch}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>ヨー軸ドリフト補正 ψ (Target: 0.0°)</span><strong id="p4-val-y">${p4.yawTrim.toFixed(1)}°</strong></div>
                                <input type="range" id="p4-s-y" min="-8.0" max="8.0" step="0.5" value="${p4.yawTrim}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>カプセル揚力バンク角 φ (Target: 18.5°)</span><strong id="p4-val-b">${p4.bankAngle.toFixed(1)}°</strong></div>
                                <input type="range" id="p4-s-b" min="0.0" max="40.0" step="0.5" value="${p4.bankAngle}">
                            </div>
                            <p style="font-size:12px; color:#9ec3e6; margin-top:8px;">
                                進入角が <strong>-5.3° より浅い</strong>と大気圏上層で水切りスキップして深宇宙へ喪失（END 03）、<strong>-7.2° より急</strong>だと高熱プラズマで空中分解（END 04）します。
                            </p>
                        </div>
                    </div>
                `;

                const updateP4 = () => {
                    p4.retroPitch = Number(document.getElementById('p4-s-p').value);
                    p4.yawTrim = Number(document.getElementById('p4-s-y').value);
                    p4.bankAngle = Number(document.getElementById('p4-s-b').value);
                    document.getElementById('p4-val-p').textContent = `${p4.retroPitch.toFixed(1)}°`;
                    document.getElementById('p4-val-y').textContent = `${p4.yawTrim.toFixed(1)}°`;
                    document.getElementById('p4-val-b').textContent = `${p4.bankAngle.toFixed(1)}°`;

                    const gamma = this.eng.recomputeEntryCorridor();
                    this.updateResourceHUD();

                    document.getElementById('p4-readout').innerHTML = `
                        COMPUTED ENTRY ANGLE γ_e: <strong style="color:${p4.solved ? '#00ff9d' : '#ffae00'};">${gamma.toFixed(2)}°</strong>
                        | YAW DRIFT: <strong>${p4.yawTrim.toFixed(1)}°</strong>
                        ${p4.solved ? ' — [CORRIDOR LOCKED]' : ' — [OUT OF SAFE CORRIDOR]'}
                    `;

                    const cv = document.getElementById('corridor-canvas');
                    if (cv) {
                        const ctx = cv.getContext('2d');
                        ctx.fillStyle = '#030812';
                        ctx.fillRect(0, 0, cv.width, cv.height);

                        // Draw Earth limb & atmosphere band
                        ctx.fillStyle = 'rgba(0, 140, 255, 0.18)';
                        ctx.beginPath(); ctx.arc(390, 260, 170, Math.PI, Math.PI * 1.55); ctx.fill();
                        ctx.fillStyle = '#0b2c52';
                        ctx.beginPath(); ctx.arc(390, 260, 130, Math.PI, Math.PI * 1.55); ctx.fill();

                        // Safe corridor wedge
                        ctx.fillStyle = 'rgba(0, 255, 157, 0.16)';
                        ctx.beginPath();
                        ctx.moveTo(40, 35);
                        ctx.lineTo(360, 115);
                        ctx.lineTo(360, 155);
                        ctx.closePath();
                        ctx.fill();

                        // Trajectory curve based on gamma
                        ctx.strokeStyle = p4.solved ? '#00ff9d' : (gamma > -5.3 ? '#ffae00' : '#ff2a4b');
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        ctx.moveTo(40, 35);
                        const endY = 135 + (-6.2 - gamma) * 28;
                        if (gamma > -5.3) {
                            // Skip off curve
                            ctx.quadraticCurveTo(220, 95, 430, 25);
                        } else {
                            ctx.lineTo(360, Math.max(40, Math.min(195, endY)));
                        }
                        ctx.stroke();

                        ctx.fillStyle = '#9ec3e6';
                        ctx.font = '11px monospace';
                        ctx.fillText('SKIP-OFF ZONE (> -5.3°)', 250, 35);
                        ctx.fillStyle = '#00ff9d';
                        ctx.fillText('SAFE CORRIDOR (-6.20°)', 235, 136);
                        ctx.fillStyle = '#ff5c77';
                        ctx.fillText('BURN-UP ZONE (< -7.2°)', 240, 190);
                    }
                };

                ['p4-s-p', 'p4-s-y', 'p4-s-b'].forEach(id => document.getElementById(id).addEventListener('input', updateP4));
                updateP4();
                return;
            }

            // -----------------------------------------------------------------
            // 6. MODULE PUZZLE 5: SOUTH HANGAR PROPELLANT/O2 & DESCENT SEQUENCER (retro_chute)
            // -----------------------------------------------------------------
            if (t.id === 'retro_chute') {
                titleEl.textContent = '⑤ 南・ハンガー // 推進剤・酸素充填 ＆ 3段減速シーケンサー端末';
                subEl.textContent = 'DESCENT & LIFE SUPPORT // O2・RCS推進剤を充填し、パラシュート開傘高度と逆噴射高度を設定せよ';
                commitBtn.textContent = '✔ 生命維持充填＆減速シーケンス確定・パラシュート＆逆噴射を回収';

                const p5 = this.eng.p5;
                bodyEl.innerHTML = `
                    <div class="eng-workspace">
                        <div class="eng-pane">
                            <h4>■ A. 脱出ポッド生命維持酸素 ＆ RCSヒドラジン充填</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>ポッド生命維持 O2 タンク (最低 80% / 推奨 96%)</span><strong id="p5-val-o2">${this.eng.podO2.toFixed(0)}%</strong></div>
                                <input type="range" id="p5-s-o2" min="20" max="100" step="2" value="${this.eng.podO2}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>姿勢制御 RCS 推進剤 N2H4 (最低 75% / 推奨 92%)</span><strong id="p5-val-rcs">${this.eng.podRCS.toFixed(0)}%</strong></div>
                                <input type="range" id="p5-s-rcs" min="20" max="100" step="2" value="${this.eng.podRCS}">
                            </div>
                            <div class="formula-readout" id="p5-mass-readout" style="margin-top:12px;"></div>
                            <p style="font-size:11px; color:#9ec3e6; margin-top:8px;">
                                ※O2とRCSを充填するとポッド総質量（Wet Mass）が増加します。充填後に中央ハブの反応炉で総質量に対する爆縮出力（ΔV=3.20km/s）を最終確認してください。
                            </p>
                        </div>
                        <div class="eng-pane">
                            <h4>■ B. 大気圏3段減速シーケンス高度設定</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>第1段 ドローグ開傘高度 (適正 13.0〜17.5 km)</span><strong id="p5-val-dr">${p5.drogueAltKm.toFixed(1)} km</strong></div>
                                <input type="range" id="p5-s-dr" min="5.0" max="28.0" step="0.5" value="${p5.drogueAltKm}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>第2段 メインシュート3基開傘高度 (適正 3.4〜5.2 km)</span><strong id="p5-val-mn">${p5.mainAltKm.toFixed(1)} km</strong></div>
                                <input type="range" id="p5-s-mn" min="1.0" max="9.0" step="0.2" value="${p5.mainAltKm}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>第3段 固体逆噴射ロケット点火高度 (適正 20〜35 m)</span><strong id="p5-val-rt">${p5.retroAltM} m</strong></div>
                                <input type="range" id="p5-s-rt" min="0" max="95" step="1" value="${p5.retroAltM}">
                            </div>
                            <div class="formula-readout" id="p5-seq-readout"></div>
                        </div>
                    </div>
                `;

                const updateP5 = () => {
                    this.eng.podO2 = Number(document.getElementById('p5-s-o2').value);
                    this.eng.podRCS = Number(document.getElementById('p5-s-rcs').value);
                    p5.drogueAltKm = Number(document.getElementById('p5-s-dr').value);
                    p5.mainAltKm = Number(document.getElementById('p5-s-mn').value);
                    p5.retroAltM = Number(document.getElementById('p5-s-rt').value);

                    document.getElementById('p5-val-o2').textContent = `${this.eng.podO2.toFixed(0)}%`;
                    document.getElementById('p5-val-rcs').textContent = `${this.eng.podRCS.toFixed(0)}%`;
                    document.getElementById('p5-val-dr').textContent = `${p5.drogueAltKm.toFixed(1)} km`;
                    document.getElementById('p5-val-mn').textContent = `${p5.mainAltKm.toFixed(1)} km`;
                    document.getElementById('p5-val-rt').textContent = `${p5.retroAltM} m`;

                    const lifeOk = this.eng.podO2 >= 80 && this.eng.podRCS >= 75;
                    const drOk = p5.drogueAltKm >= 13.0 && p5.drogueAltKm <= 17.5;
                    const mnOk = p5.mainAltKm >= 3.4 && p5.mainAltKm <= 5.2;
                    const rtOk = p5.retroAltM >= 20 && p5.retroAltM <= 35;
                    p5.solved = lifeOk && drOk && mnOk && rtOk;

                    const effMap = { ...this.installed, retro_chute: true };
                    const wetMass = this.eng.getPodWetMassKg(effMap);
                    this.eng.recomputeReactorImpulse(effMap);
                    this.updateResourceHUD();

                    document.getElementById('p5-mass-readout').innerHTML = `
                        LIFE SUPPORT: <strong style="color:${lifeOk ? '#00ff9d' : '#ff5c77'};">${lifeOk ? 'NOMINAL' : 'HYPOXIA / ATTITUDE LOSS RISK'}</strong> |
                        UPDATED POD WET MASS: <strong>${wetMass.toLocaleString()} kg</strong>
                    `;

                    let warn = 'ALL 3 STAGES CALIBRATED FOR 6.4 m/s SPLASHDOWN';
                    if (p5.drogueAltKm > 19.5) warn = '⚠ DANGER: DROGUE > 19.5km WILL SHRED AT MACH 4.5 (END 06)!';
                    else if (!drOk || !mnOk) warn = '⚠ DANGER: PARACHUTE ALTITUDE OUT OF ENVELOPE (END 05)!';
                    else if (!rtOk) warn = '⚠ DANGER: RETRO IGNITION ALTITUDE MISFIRE (END 07)!';

                    document.getElementById('p5-seq-readout').innerHTML = `
                        <span style="color:${p5.solved ? '#00ff9d' : '#ffae00'}; font-weight:700;">${warn}</span>
                    `;
                };

                ['p5-s-o2', 'p5-s-rcs', 'p5-s-dr', 'p5-s-mn', 'p5-s-rt'].forEach(id => {
                    document.getElementById(id).addEventListener('input', updateP5);
                });
                updateP5();
                return;
            }

            // -----------------------------------------------------------------
            // 7. CENTRAL TOKAMAK REACTOR IMPULSE & DELTA-V CALCULATOR (REACTOR_CONSOLE)
            // -----------------------------------------------------------------
            if (t.type === 'REACTOR_CONSOLE') {
                titleEl.textContent = '⑥ 中央ハブ // トカマク対消滅反応炉 [TR-1] 臨界爆縮インパルス計算盤';
                subEl.textContent = 'OPERATION BLAST-SAIL // ポッド総質量に対して ΔV = 3.20 km/s (3.08〜3.38)・衝撃 30G未満 を導出せよ';
                commitBtn.textContent = '💥 臨界爆縮パラメータをロックして自爆シーケンス起動！';

                const p6 = this.eng.p6;
                const effMap = {};
                ESCAPE_MODULES.forEach(m => { effMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]); });

                bodyEl.innerHTML = `
                    <div class="eng-workspace">
                        <div class="eng-pane">
                            <h4>■ 爆縮反動 ΔV vs ピーク衝撃 G フェーズ空間プロッター</h4>
                            <canvas id="reactor-canvas" class="eng-canvas" width="460" height="205"></canvas>
                            <div class="formula-readout" id="p6-readout"></div>
                        </div>
                        <div class="eng-pane">
                            <h4>■ 指向性爆縮エネルギー＆離脱タイミング調整</h4>
                            <div class="slider-group">
                                <div class="slider-header"><span>対消滅コア起爆出力 E_core (推奨: ~82.0 TJ)</span><strong id="p6-val-e">${p6.coreYieldTJ.toFixed(1)} TJ</strong></div>
                                <input type="range" id="p6-s-e" min="18.0" max="120.0" step="1.0" value="${p6.coreYieldTJ}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>磁気ブラストノズル収束率 η (推奨: ~85%)</span><strong id="p6-val-n">${p6.nozzleFocus}%</strong></div>
                                <input type="range" id="p6-s-n" min="35" max="100" step="1" value="${p6.nozzleFocus}">
                            </div>
                            <div class="slider-group">
                                <div class="slider-header"><span>ポッド分離後・起爆ディレイ τ (推奨: 2.6 s)</span><strong id="p6-val-t">${p6.standoffSec.toFixed(1)} s</strong></div>
                                <input type="range" id="p6-s-t" min="0.8" max="4.8" step="0.1" value="${p6.standoffSec}">
                            </div>
                            <p style="font-size:12px; color:#9ec3e6; margin-top:8px;">
                                離脱ディレイ τ が短すぎると衝撃波が近すぎて <strong>30.5G を超え軌道上圧壊（END 02）</strong>、出力が足りないと <strong>ΔV &lt; 3.05 km/s で地球へ届かず軌道漂流（END 01）</strong>になります。
                            </p>
                        </div>
                    </div>
                `;

                const updateP6 = () => {
                    p6.coreYieldTJ = Number(document.getElementById('p6-s-e').value);
                    p6.nozzleFocus = Number(document.getElementById('p6-s-n').value);
                    p6.standoffSec = Number(document.getElementById('p6-s-t').value);
                    document.getElementById('p6-val-e').textContent = `${p6.coreYieldTJ.toFixed(1)} TJ`;
                    document.getElementById('p6-val-n').textContent = `${p6.nozzleFocus}%`;
                    document.getElementById('p6-val-t').textContent = `${p6.standoffSec.toFixed(1)} s`;

                    const res = this.eng.recomputeReactorImpulse(effMap);
                    this.updateResourceHUD();

                    const dvOk = res.dv >= 3.08 && res.dv <= 3.38;
                    const gOk = res.g >= 18.0 && res.g <= 29.8;

                    document.getElementById('p6-readout').innerHTML = `
                        POD MASS: <strong>${res.mass} kg</strong> |
                        ΔV: <strong style="color:${dvOk ? '#00ff9d' : '#ffae00'};">${res.dv.toFixed(2)} km/s</strong> |
                        PEAK SHOCK: <strong style="color:${gOk ? '#00ff9d' : '#ff2a4b'};">${res.g.toFixed(1)} G</strong>
                    `;

                    const cv = document.getElementById('reactor-canvas');
                    if (cv) {
                        const ctx = cv.getContext('2d');
                        ctx.fillStyle = '#030812';
                        ctx.fillRect(0, 0, cv.width, cv.height);

                        // Safe target box: dV in [3.08, 3.38], G in [18, 29.8]
                        const mapX = (dv) => ((dv - 1.0) / 3.2) * cv.width;
                        const mapY = (g) => cv.height - ((g - 8.0) / 40.0) * cv.height;

                        // Red G-overload zone (>30.5G)
                        const yCrush = mapY(30.5);
                        ctx.fillStyle = 'rgba(255, 42, 75, 0.16)';
                        ctx.fillRect(0, 0, cv.width, yCrush);
                        ctx.strokeStyle = '#ff2a4b';
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath(); ctx.moveTo(0, yCrush); ctx.lineTo(cv.width, yCrush); ctx.stroke();

                        // Target window box
                        const rx1 = mapX(3.08);
                        const rx2 = mapX(3.38);
                        const ry1 = mapY(29.8);
                        const ry2 = mapY(18.0);
                        ctx.setLineDash([]);
                        ctx.fillStyle = 'rgba(0, 255, 157, 0.2)';
                        ctx.strokeStyle = '#00ff9d';
                        ctx.lineWidth = 2;
                        ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
                        ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);

                        // Current operating point
                        const cx = Math.max(8, Math.min(cv.width - 8, mapX(res.dv)));
                        const cy = Math.max(8, Math.min(cv.height - 8, mapY(res.g)));
                        ctx.fillStyle = (dvOk && gOk) ? '#00ff9d' : '#ffae00';
                        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
                        ctx.strokeStyle = '#fff';
                        ctx.stroke();

                        ctx.fillStyle = '#ff5c77';
                        ctx.font = '11px monospace';
                        ctx.fillText('HULL CRUSH ZONE (> 30.5 G)', 12, yCrush - 6);
                        ctx.fillStyle = '#00ff9d';
                        ctx.fillText('TARGET WINDOW (3.20 km/s)', rx1 - 20, ry2 + 15);
                    }
                };

                ['p6-s-e', 'p6-s-n', 'p6-s-t'].forEach(id => document.getElementById(id).addEventListener('input', updateP6));
                updateP6();
                return;
            }
        }

        autoSolveActiveTerminal() {
            const t = this.activeTerminal;
            if (!t) return;
            if (t.powerKey && !this.eng.breakers[t.powerKey]) {
                this.eng.routePowerTo(t.powerKey);
            }

            if (t.id === 'plasma_cell') {
                this.eng.p1 = { freq: 115, amp: 6.5, phase: 140, solved: true };
            } else if (t.id === 'blast_dampener') {
                this.eng.p2 = { v1: 3, v2: 1, v3: 0, v4: 3, n2Pressure: 18.5, dampingZeta: 0.82, solved: true };
            } else if (t.id === 'heat_shield') {
                this.eng.p3 = { valves: [false, true, false, true], ablativeMm: 64, emissivity: 0.88, solved: true };
                this.eng.steamLeakActive = false;
            } else if (t.id === 'nav_gyro') {
                this.eng.p4 = { retroPitch: -6.2, yawTrim: 0.0, bankAngle: 18.5, entryAngle: -6.20, solved: true };
                this.eng.recomputeEntryCorridor();
            } else if (t.id === 'retro_chute') {
                this.eng.podO2 = 96.0;
                this.eng.podRCS = 92.0;
                this.eng.p5 = { drogueAltKm: 15.2, mainAltKm: 4.2, retroAltM: 26, solved: true };
            } else if (t.type === 'REACTOR_CONSOLE') {
                this.eng.p6.coreYieldTJ = 82.0;
                this.eng.p6.nozzleFocus = 85;
                this.eng.p6.standoffSec = 2.6;
                const effMap = {};
                ESCAPE_MODULES.forEach(m => { effMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]); });
                this.eng.recomputeReactorImpulse(effMap);
            }

            window.OrbitalGame.Audio.playPickup();
            this.renderActiveEngineeringTerminal();
            this.updateResourceHUD();
        }

        commitActiveTerminal() {
            const t = this.activeTerminal;
            if (!t) return;

            if (t.type === 'POWER_CONSOLE') {
                window.OrbitalGame.Audio.playInstallModule();
                this.closeEngineeringModal();
                this.showToast(`【非常配電バス更新】現在の消費電力: ${this.eng.getUsedPowerKw()} / 120 kW`);
                return;
            }

            if (t.type === 'MODULE') {
                // Allow collecting the module; if puzzle wasn't fully solved, warn player or mark collected
                if (t.id === 'plasma_cell' && !this.eng.p1.solved) {
                    this.showToast('⚠ ソレノイド共鳴率が 94% 未満です！波形を重ねるか「💡 AI最適解を自動計算」を使用してください。');
                    window.OrbitalGame.Audio.playAlarmPulse();
                    return;
                }
                this.collected[t.id] = true;
                this.installed[t.id] = true;
                if (this.station.collectibleNodes[t.id]) {
                    this.station.collectibleNodes[t.id].root.enabled = false;
                }
                this.station.hangarPod.syncModules(this.installed);
                this.eng.recomputeReactorImpulse(this.installed);
                window.OrbitalGame.Audio.playInstallModule();
                this.updateInWorldScreens();
                this.updateChecklistUI();
                this.updateResourceHUD();

                const modMeta = ESCAPE_MODULES.find(m => m.id === t.id);
                const total = ESCAPE_MODULES.filter(m => this.installed[m.id]).length;
                this.closeEngineeringModal();
                this.showToast(`【物理較正＆モジュール装着完了】「${modMeta.name}」をポッドへロック！（装備数: ${total}/5 | 総質量: ${this.eng.getPodWetMassKg(this.installed)} kg）`);
                return;
            }

            if (t.type === 'REACTOR_CONSOLE') {
                this.reactorArmed = true;
                const effMap = {};
                ESCAPE_MODULES.forEach(m => { effMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]); });
                const res = this.eng.recomputeReactorImpulse(effMap);
                window.OrbitalGame.Audio.playInstallModule();
                window.OrbitalGame.Audio.setReactorOverloadMode(true);
                this.updateInWorldScreens();
                this.updateChecklistUI();
                this.updateResourceHUD();
                this.closeEngineeringModal();
                this.showToast(`【臨界爆縮シーケンス起動】予測 ΔV = ${res.dv.toFixed(2)} km/s・最大衝撃 ${res.g.toFixed(1)}G でセット完了！南ハンガーの脱出ポッドへ急げ！`);
            }
        }

        // =====================================================================
        // 10-ENDING SIMULATOR MODAL
        // =====================================================================
        buildSimEngStateFromUI(simInstalled) {
            const simEng = new EngineeringState();
            simEng.p1.solved = !!simInstalled.plasma_cell;
            simEng.p2.solved = !!simInstalled.blast_dampener;
            simEng.p3.solved = !!simInstalled.heat_shield;
            simEng.p4.solved = !!simInstalled.nav_gyro;
            simEng.p5.solved = !!simInstalled.retro_chute;

            const dv = Number(document.getElementById('sim-slider-dv')?.value || 3.20);
            const g = Number(document.getElementById('sim-slider-g')?.value || 25.4);
            const gamma = Number(document.getElementById('sim-slider-gamma')?.value || -6.20);
            const drogue = Number(document.getElementById('sim-slider-drogue')?.value || 15.2);
            const retro = Number(document.getElementById('sim-slider-retro')?.value || 26);
            const o2 = Number(document.getElementById('sim-slider-o2')?.value || 96);

            simEng.podO2 = o2;
            simEng.podRCS = o2;
            simEng.p4.entryAngle = gamma;
            simEng.p4.yawTrim = 0;
            simEng.p4.bankAngle = 18.5;
            simEng.p5.drogueAltKm = drogue;
            simEng.p5.mainAltKm = drogue < 9.0 ? 1.5 : 4.2;
            simEng.p5.retroAltM = retro;

            // Override recompute functions so simulator sliders directly control physics values
            simEng.recomputeReactorImpulse = () => {
                simEng.p6.computedDv = dv;
                simEng.p6.computedG = g;
                return { dv, g, mass: simEng.getPodWetMassKg(simInstalled) };
            };
            simEng.recomputeEntryCorridor = () => {
                simEng.p4.entryAngle = gamma;
                return gamma;
            };
            return simEng;
        }

        openSimulatorModal() {
            if (document.pointerLockElement) {
                try { document.exitPointerLock(); } catch (e) {}
            }
            const container = document.getElementById('sim-toggle-container');
            container.innerHTML = '';

            ESCAPE_MODULES.forEach(m => {
                const checked = this.installed[m.id] || this.collected[m.id];
                const card = document.createElement('label');
                card.className = 'sim-toggle-card';
                card.innerHTML = `
                    <input type="checkbox" id="sim-cb-${m.id}" ${checked ? 'checked' : ''}>
                    <div>
                        <div style="font-weight:700; color:#00f0ff; font-size:13px;">${m.name} (${m.massKg}kg)</div>
                        <div style="font-size:11px; color:#b4cde6; margin-top:3px;">${m.missingRisk}</div>
                    </div>
                `;
                container.appendChild(card);
            });

            const timeoutCard = document.createElement('label');
            timeoutCard.className = 'sim-toggle-card';
            timeoutCard.style.borderColor = 'rgba(255, 42, 75, 0.45)';
            timeoutCard.innerHTML = `
                <input type="checkbox" id="sim-cb-timeout">
                <div>
                    <div style="font-weight:700; color:#ff5c77; font-size:13px;">【END 09 再現】脱出前に時間切れ／スーツO2枯渇で炉心爆縮</div>
                    <div style="font-size:11px; color:#b4cde6; margin-top:3px;">チェックを入れると、ポッド発射前にステーションが超臨界爆発するエンディングを再生します。</div>
                </div>
            `;
            container.appendChild(timeoutCard);

            const setSliders = (dv, g, gamma, drogue, retro, o2) => {
                const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
                setV('sim-slider-dv', dv);
                setV('sim-slider-g', g);
                setV('sim-slider-gamma', gamma);
                setV('sim-slider-drogue', drogue);
                setV('sim-slider-retro', retro);
                setV('sim-slider-o2', o2);
            };

            // Initialize sliders from current game state if all modules are ready, else default optimal
            setSliders(
                this.eng.p6.computedDv || 3.20,
                this.eng.p6.computedG || 25.4,
                this.eng.p4.entryAngle || -6.20,
                this.eng.p5.drogueAltKm || 15.2,
                this.eng.p5.retroAltM || 26,
                this.eng.podO2 || 96
            );

            const updateSimPreview = () => {
                const map = {};
                ESCAPE_MODULES.forEach(m => {
                    const el = document.getElementById(`sim-cb-${m.id}`);
                    map[m.id] = el ? el.checked : false;
                });
                const isTO = document.getElementById('sim-cb-timeout')?.checked;

                document.getElementById('sim-val-dv').textContent = `${Number(document.getElementById('sim-slider-dv').value).toFixed(2)} km/s`;
                document.getElementById('sim-val-g').textContent = `${Number(document.getElementById('sim-slider-g').value).toFixed(1)} G`;
                document.getElementById('sim-val-gamma').textContent = `${Number(document.getElementById('sim-slider-gamma').value).toFixed(2)}°`;
                document.getElementById('sim-val-drogue').textContent = `${Number(document.getElementById('sim-slider-drogue').value).toFixed(1)} km`;
                document.getElementById('sim-val-retro').textContent = `${Number(document.getElementById('sim-slider-retro').value)} m`;
                document.getElementById('sim-val-o2').textContent = `${Number(document.getElementById('sim-slider-o2').value)}%`;

                const simEng = this.buildSimEngStateFromUI(map);
                const predicted = evaluateEnding(map, isTO, simEng);
                const prevEl = document.getElementById('sim-predicted-ending');
                if (prevEl) {
                    prevEl.innerHTML = `<span style="color:${predicted.rankColor}; font-weight:800;">[${predicted.code}] ${predicted.title}</span> — ${predicted.subtitle}`;
                }
            };

            container.querySelectorAll('input').forEach(inp => inp.addEventListener('change', updateSimPreview));
            ['sim-slider-dv', 'sim-slider-g', 'sim-slider-gamma', 'sim-slider-drogue', 'sim-slider-retro', 'sim-slider-o2'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updateSimPreview);
            });

            // 1-Click Preset Buttons for all 10 Endings
            document.querySelectorAll('[data-sim-preset]').forEach(btn => {
                btn.onclick = () => {
                    const preset = btn.getAttribute('data-sim-preset');
                    const setAll = (val) => ESCAPE_MODULES.forEach(m => {
                        const cb = document.getElementById(`sim-cb-${m.id}`);
                        if (cb) cb.checked = val;
                    });
                    const toCb = document.getElementById('sim-cb-timeout');
                    if (toCb) toCb.checked = false;
                    setAll(true);
                    setSliders(3.20, 25.4, -6.20, 15.2, 26, 96);

                    if (preset === 'TRUE') {
                        // Optimal
                    } else if (preset === 'WEAK_DV') {
                        setSliders(2.15, 16.0, -6.20, 15.2, 26, 96);
                    } else if (preset === 'OVER_G') {
                        setSliders(3.25, 42.5, -6.20, 15.2, 26, 96);
                    } else if (preset === 'SKIP_OFF') {
                        setSliders(3.20, 25.4, -4.10, 15.2, 26, 96);
                    } else if (preset === 'BURN_UP') {
                        setSliders(3.20, 25.4, -8.40, 15.2, 26, 96);
                    } else if (preset === 'GROUND_CRASH') {
                        document.getElementById('sim-cb-retro_chute').checked = false;
                    } else if (preset === 'CHUTE_SHRED') {
                        setSliders(3.20, 25.4, -6.20, 24.5, 26, 96);
                    } else if (preset === 'RETRO_ERROR') {
                        setSliders(3.20, 25.4, -6.20, 15.2, 82, 96);
                    } else if (preset === 'HYPOXIA') {
                        setSliders(3.20, 25.4, -6.20, 15.2, 26, 42);
                    } else if (preset === 'TIMEOUT') {
                        if (toCb) toCb.checked = true;
                    }
                    updateSimPreview();
                };
            });

            updateSimPreview();
            document.getElementById('simulator-modal').classList.remove('hidden');
        }

        // =====================================================================
        // HUD, MINIMAP & WORLD SCREEN UPDATES
        // =====================================================================
        getCurrentZoneName(x, z) {
            for (const r of WALKABLE_RECTS) {
                if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
                    return r.name;
                }
            }
            return '宇宙ステーション HELIOS-9';
        }

        updateResourceHUD() {
            const effMap = {};
            ESCAPE_MODULES.forEach(m => { effMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]); });

            const mass = this.eng.getPodWetMassKg(effMap);
            const massEl = document.getElementById('hud-mass-val');
            if (massEl) massEl.textContent = `${mass.toLocaleString()} kg`;

            const steamBadge = document.getElementById('hud-steam-badge');
            if (steamBadge) {
                steamBadge.textContent = this.eng.steamLeakActive ? '⚠ STEAM LEAK (O2 DRAIN x2)' : '✔ STEAM SEALED (NOMINAL)';
                steamBadge.style.color = this.eng.steamLeakActive ? '#ff5c77' : '#00ff9d';
            }

            // Suit O2 bar
            const sO2 = Math.max(0, Math.min(100, this.eng.suitO2));
            const barSuit = document.getElementById('bar-suit-o2');
            const valSuit = document.getElementById('val-suit-o2');
            if (barSuit) {
                barSuit.style.width = `${sO2}%`;
                barSuit.style.background = sO2 < 30 ? '#ff2a4b' : '#00f0ff';
            }
            if (valSuit) valSuit.textContent = `${Math.round(sO2)}%`;

            // Pod O2 bar
            const pO2 = this.eng.podO2;
            const barPodO2 = document.getElementById('bar-pod-o2');
            const valPodO2 = document.getElementById('val-pod-o2');
            if (barPodO2) {
                barPodO2.style.width = `${pO2}%`;
                barPodO2.style.background = pO2 >= 80 ? '#00ff9d' : '#ffae00';
            }
            if (valPodO2) valPodO2.textContent = `${Math.round(pO2)}%`;

            // Pod RCS bar
            const pRCS = this.eng.podRCS;
            const barRCS = document.getElementById('bar-pod-rcs');
            const valRCS = document.getElementById('val-pod-rcs');
            if (barRCS) {
                barRCS.style.width = `${pRCS}%`;
                barRCS.style.background = pRCS >= 75 ? '#00ff9d' : '#ffae00';
            }
            if (valRCS) valRCS.textContent = `${Math.round(pRCS)}%`;

            // Power Bus bar
            const usedKw = this.eng.getUsedPowerKw();
            const barPwr = document.getElementById('bar-pwr-bus');
            const valPwr = document.getElementById('val-pwr-bus');
            if (barPwr) barPwr.style.width = `${Math.min(100, (usedKw / 120) * 100)}%`;
            if (valPwr) valPwr.textContent = `${usedKw}/120kW`;

            // Physics Telemetry Readouts
            const dvEl = document.getElementById('hud-dv-val');
            const gEl = document.getElementById('hud-g-val');
            const gmEl = document.getElementById('hud-gamma-val');
            if (dvEl) {
                const dv = this.eng.p6.computedDv;
                dvEl.textContent = `${dv.toFixed(2)} km/s`;
                dvEl.style.color = (dv >= 3.08 && dv <= 3.38) ? '#00ff9d' : '#ffae00';
            }
            if (gEl) {
                const g = this.eng.p6.computedG;
                gEl.textContent = `${g.toFixed(1)} G`;
                gEl.style.color = (g <= 29.8 && this.eng.p2.solved) ? '#00ff9d' : '#ff2a4b';
            }
            if (gmEl) {
                const gm = this.eng.p4.entryAngle;
                gmEl.textContent = `${gm.toFixed(2)}°`;
                gmEl.style.color = (gm <= -5.65 && gm >= -6.75) ? '#00ff9d' : '#ffae00';
            }
        }

        updateInWorldScreens() {
            if (!this.station) return;
            const effMap = {};
            ESCAPE_MODULES.forEach(m => { effMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]); });
            const count = Object.values(effMap).filter(Boolean).length;
            const mass = this.eng.getPodWetMassKg(effMap);

            this.station.reactorScreenMat.updateScreen(
                this.reactorArmed ? '!! TOKAMAK OVERLOAD ARMED !!' : 'TOKAMAK CORE [TR-1] // IMPULSE CALC',
                [
                    `POD WET MASS : ${mass} kg | CATALYST: ${effMap.plasma_cell ? 'OK' : 'MISSING'}`,
                    `COMPUTED dV  : ${this.eng.p6.computedDv.toFixed(2)} km/s (TARGET 3.20)`,
                    `PEAK SHOCK G : ${this.eng.p6.computedG.toFixed(1)} G (LIMIT <30.0G)`,
                    'PRESS [E] TO OPEN IMPULSE CALCULATOR'
                ],
                this.reactorArmed ? '#ff2a4b' : '#00f0ff'
            );

            if (this.station.powerScreenMat) {
                const b = this.eng.breakers;
                this.station.powerScreenMat.updateScreen(
                    `POWER BUS MATRIX // ${this.eng.getUsedPowerKw()} / 120 kW`,
                    [
                        `ENG CRYO (35kW): ${b.eng_cryo ? 'ON ' : 'OFF'} | MAINT (40kW): ${b.maint_crane ? 'ON' : 'OFF'}`,
                        `BRIDGE   (25kW): ${b.bridge_astro ? 'ON ' : 'OFF'} | THERM (30kW): ${b.thermal_purge ? 'ON' : 'OFF'}`,
                        `HANGAR   (30kW): ${b.hangar_umb ? 'ON ' : 'OFF'}`,
                        'PRESS [E] OR [P] TO ROUTE POWER'
                    ],
                    '#ffae00'
                );
            }

            this.station.podScreenMat.updateScreen(
                'KESTREL-01 // FLIGHT & BLUEPRINT CAD',
                [
                    `INSTALLED MODULES: ${count} / 5 | MASS: ${mass} kg`,
                    `POD O2: ${Math.round(this.eng.podO2)}% | RCS: ${Math.round(this.eng.podRCS)}%`,
                    `ENTRY CORRIDOR: ${this.eng.p4.entryAngle.toFixed(2)} deg`,
                    'PRESS [E] FOR 10-ENDING SIMULATOR'
                ],
                count === 5 ? '#00ff9d' : '#ffae00'
            );
        }

        updateChecklistUI() {
            const listEl = document.getElementById('hud-checklist');
            if (!listEl) return;
            listEl.innerHTML = '';

            const effectiveMap = {};
            let readyTotal = 0;

            ESCAPE_MODULES.forEach(m => {
                const isInst = !!(this.installed[m.id] || this.collected[m.id]);
                effectiveMap[m.id] = isInst;
                if (isInst) readyTotal++;

                const li = document.createElement('li');
                li.className = 'checklist-item' + (isInst ? ' installed' : '');
                li.innerHTML = `
                    <span>${m.name}</span>
                    <span class="item-badge">${isInst ? '較正・装着済' : '未較正'}</span>
                `;
                listEl.appendChild(li);
            });

            // 6th checklist item: Tokamak Reactor Impulse Calibration
            this.eng.recomputeReactorImpulse(effectiveMap);
            const reactorOk = this.eng.p6.calibrated && this.reactorArmed;
            if (reactorOk) readyTotal++;

            const rLi = document.createElement('li');
            rLi.className = 'checklist-item' + (reactorOk ? ' installed' : (this.reactorArmed ? ' collected' : ''));
            rLi.innerHTML = `
                <span>⑥ 中央反応炉 ΔV=3.20km/s 臨界計算</span>
                <span class="item-badge">${reactorOk ? 'ロック済' : (this.reactorArmed ? '要再計算' : '未起動')}</span>
            `;
            listEl.appendChild(rLi);

            const readyBadge = document.getElementById('hud-ready-count');
            if (readyBadge) readyBadge.textContent = `${readyTotal} / 6 READY`;

            const predicted = evaluateEnding(effectiveMap, false, this.eng);
            const outcomeEl = document.getElementById('predicted-outcome-text');
            if (outcomeEl) {
                outcomeEl.textContent = `[${predicted.code.split('//')[1].trim()}] ${predicted.title}`;
                outcomeEl.style.color = predicted.rankColor;
            }
        }

        checkInteractables() {
            const camPos = this.camera.getPosition();
            const camFwd = this.camera.forward;
            let bestTarget = null;
            let bestScore = 999;

            const powerMap = {
                plasma_cell: 'eng_cryo',
                blast_dampener: 'maint_crane',
                heat_shield: 'thermal_purge',
                nav_gyro: 'bridge_astro',
                retro_chute: 'hangar_umb'
            };

            // 1. Check 5 Engineering Module Terminals
            for (const m of ESCAPE_MODULES) {
                if (this.collected[m.id] || this.installed[m.id]) continue;
                const pos = new pc.Vec3(m.pos[0], m.pos[1], m.pos[2]);
                const toItem = new pc.Vec3().sub2(pos, camPos);
                const dist = toItem.length();
                if (dist < 4.0) {
                    toItem.normalize();
                    const dot = camFwd.dot(toItem);
                    if (dot > 0.58 && dist < bestScore) {
                        bestScore = dist;
                        const pKey = powerMap[m.id];
                        const pOnline = this.eng.breakers[pKey];
                        bestTarget = {
                            type: 'MODULE',
                            id: m.id,
                            powerKey: pKey,
                            title: `【工学演算＆帰還パーツ】${m.name}`,
                            desc: `${m.puzzleName} — ${m.desc}`,
                            actionLabel: pOnline
                                ? '[E] 工学キャリブレーション端末を開いて回収'
                                : '[E] 端末を開く（区画電力を自動ルーティング可能）'
                        };
                    }
                }
            }

            // 2. Central Tokamak Reactor Impulse Console [0, 1.2, -3.45]
            {
                const rPos = new pc.Vec3(0, 1.2, -3.45);
                const toR = new pc.Vec3().sub2(rPos, camPos);
                const dist = toR.length();
                if (dist < 3.8 && camFwd.dot(toR.clone().normalize()) > 0.58 && dist < bestScore) {
                    bestScore = dist;
                    bestTarget = {
                        type: 'REACTOR_CONSOLE',
                        title: '⑥ 中央トカマク反応炉 [TR-1] 臨界爆縮インパルス計算盤',
                        desc: `現在のポッド総質量に対する獲得減速量 ΔV=${this.eng.p6.computedDv.toFixed(2)}km/s・最大衝撃 ${this.eng.p6.computedG.toFixed(1)}G。起爆出力と離脱ディレイを計算します。`,
                        actionLabel: '[E] 反応炉 ΔV・衝撃G 計算ターミナルを開く'
                    };
                }
            }

            // 3. Emergency Power Bus Console [3.3, 1.2, -1.2]
            {
                const pPos = new pc.Vec3(3.3, 1.2, -1.2);
                const toP = new pc.Vec3().sub2(pPos, camPos);
                const dist = toP.length();
                if (dist < 3.6 && camFwd.dot(toP.clone().normalize()) > 0.58 && dist < bestScore) {
                    bestScore = dist;
                    bestTarget = {
                        type: 'POWER_CONSOLE',
                        title: `120kW 非常配電バス制御盤（現在 ${this.eng.getUsedPowerKw()}/120kW）`,
                        desc: '東機関室・西整備ベイ・北ブリッジ・北西熱ラボ・南ハンガーへの非常電力供給（上限120kW）を切り替えます。',
                        actionLabel: '[E] 非常配電バス・マトリクスを開く'
                    };
                }
            }

            // 4. Emergency O2 Refill Manifolds ([3.8, 1.2, -3.4] Central Hub & [-4.2, 1.2, -20.2] North Bridge)
            for (const oCoords of [[3.8, 1.2, -3.4], [-4.2, 1.2, -20.2]]) {
                const oPos = new pc.Vec3(oCoords[0], oCoords[1], oCoords[2]);
                const toO = new pc.Vec3().sub2(oPos, camPos);
                const dist = toO.length();
                if (dist < 3.6 && camFwd.dot(toO.clone().normalize()) > 0.56 && dist < bestScore) {
                    bestScore = dist;
                    bestTarget = {
                        type: 'O2_STATION',
                        title: '高圧酸素リザーバー＆ポッド推進剤マニホールド',
                        desc: 'EVAスーツの酸素を100%へ急速充填し、南ハンガーの脱出ポッドへ予備酸素・RCS推進剤を送気します。',
                        actionLabel: '[E] EVAスーツ酸素を100%へ急速充填'
                    };
                }
            }

            // 5. Pod Diagnostic & Blueprint Console [-3.2, 1.2, 18.5]
            {
                const pPos = new pc.Vec3(-3.2, 1.2, 18.5);
                const toP = new pc.Vec3().sub2(pPos, camPos);
                const dist = toP.length();
                if (dist < 3.6 && camFwd.dot(toP.clone().normalize()) > 0.58 && dist < bestScore) {
                    bestScore = dist;
                    bestTarget = {
                        type: 'POD_CONSOLE',
                        title: '脱出ポッド整備・全10種エンディング分岐シミュレーター端末',
                        desc: '装着モジュールや物理パラメータ（ΔV・衝撃G・進入角・開傘高度・O2残量）を自在に変更して全10種の3Dエンディングを検証できます。',
                        actionLabel: '[E] 10種エンディング＆物理シミュレーターを開く'
                    };
                }
            }

            // 6. Escape Pod Boarding Hatch [0, 1.4, 19.2]
            {
                const hPos = new pc.Vec3(0, 1.4, 19.2);
                const toH = new pc.Vec3().sub2(hPos, camPos);
                const dist = toH.length();
                if (dist < 4.3 && camFwd.dot(toH.clone().normalize()) > 0.52 && dist < bestScore) {
                    bestScore = dist;
                    const effMap = {};
                    ESCAPE_MODULES.forEach(m => { effMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]); });
                    const readyCount = Object.values(effMap).filter(Boolean).length;
                    const predicted = evaluateEnding(effMap, false, this.eng);

                    bestTarget = {
                        type: 'POD_LAUNCH',
                        title: `脱出ポッド「KESTREL-01」搭乗ハッチ（装備: ${readyCount}/5 | ΔV: ${this.eng.p6.computedDv.toFixed(2)}km/s）`,
                        desc: `現在発射した場合の物理演算予測：『[${predicted.code.split('//')[1].trim()}] ${predicted.title}』`,
                        actionLabel: '[E] 脱出ポッドに搭乗してステーション爆破・地球へ発射！'
                    };
                }
            }

            this.currentTarget = bestTarget;
            const reticle = document.getElementById('reticle');
            const promptBox = document.getElementById('interact-prompt');

            if (bestTarget) {
                reticle.classList.add('active');
                promptBox.classList.remove('hidden');
                document.getElementById('prompt-title').textContent = bestTarget.title;
                document.getElementById('prompt-desc').textContent = bestTarget.desc;
                document.getElementById('prompt-key').textContent = bestTarget.actionLabel;
            } else {
                reticle.classList.remove('active');
                promptBox.classList.add('hidden');
            }
        }

        triggerInteraction() {
            if (!this.currentTarget) return;
            const t = this.currentTarget;

            if (t.type === 'MODULE' || t.type === 'REACTOR_CONSOLE' || t.type === 'POWER_CONSOLE') {
                window.OrbitalGame.Audio.playPickup();
                this.openEngineeringModal(t);
            } else if (t.type === 'O2_STATION') {
                this.eng.suitO2 = 100.0;
                this.eng.podO2 = Math.min(100, Math.max(this.eng.podO2, 92));
                this.eng.podRCS = Math.min(100, Math.max(this.eng.podRCS, 88));
                window.OrbitalGame.Audio.playInstallModule();
                this.updateResourceHUD();
                this.updateChecklistUI();
                this.showToast('【酸素・推進剤マニホールド充填完了】EVAスーツ酸素 100%、ポッドO2 92%・RCS 88% へ加圧しました！');
            } else if (t.type === 'POD_CONSOLE') {
                window.OrbitalGame.Audio.playInstallModule();
                this.openSimulatorModal();
            } else if (t.type === 'POD_LAUNCH') {
                const launchMap = {};
                ESCAPE_MODULES.forEach(m => {
                    launchMap[m.id] = !!(this.installed[m.id] || this.collected[m.id]);
                    this.installed[m.id] = launchMap[m.id];
                });
                window.OrbitalGame.Audio.playInstallModule();
                this.launchEndingCinematic(launchMap, false, this.eng);
            }
        }

        launchEndingCinematic(installedMap, isTimeout = false, engState = this.eng) {
            if (document.pointerLockElement) {
                try { document.exitPointerLock(); } catch (e) {}
            }
            this.state = 'CINEMATIC';
            this.station.root.enabled = false;
            this.flashlight.enabled = false;
            if (this.postEffect) {
                this.postEffect.hypoxiaAmount = 0.0;
                this.postEffect.shakeAmount = 0.0;
            }

            document.getElementById('title-modal').classList.add('hidden');
            document.getElementById('hud-layer').classList.add('hidden');
            document.getElementById('engineering-modal').classList.add('hidden');
            document.getElementById('result-modal').classList.add('hidden');
            document.getElementById('cinematic-layer').classList.remove('hidden');

            this.cinematic.start(installedMap, isTimeout, this.camera, (endingObj) => {
                this.presentEndingCard(endingObj, () => {
                    this.showEndingResultModal(endingObj, installedMap, isTimeout, engState);
                });
            }, engState);
            this.stationVfx.clear();
            this.stationVfx.entity.enabled = false;
        }

        presentEndingCard(endingObj, then) {
            const card = document.getElementById('ending-card');
            document.getElementById('cinematic-layer').classList.add('hidden');
            if (!card) { then(); return; }
            this.state = 'ENDCARD';
            document.getElementById('ending-card-code').textContent = endingObj.code;
            document.getElementById('ending-card-title').textContent = endingObj.title;
            document.getElementById('ending-card-rank').textContent = endingObj.rank;
            card.style.setProperty('--card-color', endingObj.rankColor);
            card.classList.remove('hidden');
            let done = false;
            let timer = null;
            const go = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                card.removeEventListener('click', go);
                card.classList.add('hidden');
                this.endingCardSkip = null;
                then();
            };
            card.addEventListener('click', go);
            timer = setTimeout(go, 5200);
            this.endingCardSkip = go;
        }

        showEndingResultModal(endingObj, installedMap, isTimeout, engState = this.eng) {
            this.state = 'RESULT';
            this.saveUnlockedEnding(endingObj.id);
            document.getElementById('cinematic-layer').classList.add('hidden');

            const rankEl = document.getElementById('res-rank-badge');
            rankEl.textContent = `${endingObj.code} — ${endingObj.rank}`;
            rankEl.style.background = `${endingObj.rankColor}22`;
            rankEl.style.color = endingObj.rankColor;
            rankEl.style.border = `1px solid ${endingObj.rankColor}`;

            const titleEl = document.getElementById('res-title');
            titleEl.textContent = endingObj.title;
            titleEl.style.color = endingObj.rankColor;

            document.getElementById('res-subtitle').textContent = endingObj.subtitle;
            document.getElementById('res-report').textContent = endingObj.report;

            const physSummary = document.getElementById('res-physics-summary');
            if (physSummary && engState) {
                const mass = engState.getPodWetMassKg(installedMap);
                physSummary.innerHTML = `
                    TELEMETRY SUMMARY // 総質量: <strong>${mass} kg</strong> |
                    獲得ΔV: <strong>${engState.p6.computedDv.toFixed(2)} km/s</strong> |
                    最大衝撃: <strong>${engState.p6.computedG.toFixed(1)} G</strong> |
                    再突入角 γ: <strong>${engState.p4.entryAngle.toFixed(2)}°</strong> |
                    ドローグ高度: <strong>${engState.p5.drogueAltKm.toFixed(1)} km</strong> |
                    逆噴射高度: <strong>${engState.p5.retroAltM} m</strong> |
                    ポッドO2/RCS: <strong>${Math.round(engState.podO2)}% / ${Math.round(engState.podRCS)}%</strong>
                `;
            }

            const modSummary = document.getElementById('res-modules-grid');
            modSummary.innerHTML = '';
            ESCAPE_MODULES.forEach(m => {
                const ok = !isTimeout && !!installedMap[m.id];
                const d = document.createElement('div');
                d.className = 'ending-slot ' + (ok ? 'unlocked' : '');
                d.style.borderColor = ok ? 'rgba(0,255,157,0.4)' : 'rgba(255,42,75,0.4)';
                d.innerHTML = `
                    <span>${m.name}</span>
                    <span style="font-family:var(--font-mono); color:${ok ? '#00ff9d' : '#ff4d6a'}; font-weight:700;">
                        ${ok ? '✔ ONLINE' : '✖ MISSING'}
                    </span>
                `;
                modSummary.appendChild(d);
            });

            document.getElementById('result-modal').classList.remove('hidden');
        }

        renderEndingsArchive() {
            const containers = document.querySelectorAll('.endings-archive-list');
            const allEndings = [
                ENDING_DEFINITIONS.WEAK_BLAST_DRIFT,
                ENDING_DEFINITIONS.SHOCKWAVE_CRUSH,
                ENDING_DEFINITIONS.ORBIT_SKIP_LOST,
                ENDING_DEFINITIONS.ATMOS_BURNUP,
                ENDING_DEFINITIONS.GROUND_CRASH,
                ENDING_DEFINITIONS.SUPERSONIC_CHUTE_SHRED,
                ENDING_DEFINITIONS.RETRO_TIMING_CRASH,
                ENDING_DEFINITIONS.HYPOXIA_IN_ORBIT,
                ENDING_DEFINITIONS.STATION_MELTDOWN_TIMEOUT,
                ENDING_DEFINITIONS.EARTH_RETURN_SUCCESS
            ];
            const unlockedCount = allEndings.filter(e => this.unlockedEndings[e.id]).length;

            document.querySelectorAll('.endings-count-label').forEach(el => {
                el.textContent = `エンディング回収率: ${unlockedCount} / ${allEndings.length}`;
            });

            containers.forEach(container => {
                container.innerHTML = '';
                allEndings.forEach(e => {
                    const isUnl = !!this.unlockedEndings[e.id];
                    const row = document.createElement('div');
                    row.className = 'ending-slot' + (isUnl ? ' unlocked' : '');
                    row.innerHTML = `
                        <span><strong>${e.code.split('//')[1].trim()}</strong> : ${isUnl ? e.title : '？？？ [未到達の物理結末]'}</span>
                        <span style="font-family:var(--font-mono); font-size:11px; color:${isUnl ? e.rankColor : '#6c849e'};">
                            ${isUnl ? 'UNLOCKED' : 'LOCKED'}
                        </span>
                    `;
                    container.appendChild(row);
                });
            });
        }

        showToast(msg) {
            const el = document.getElementById('hud-toast');
            if (el) {
                el.textContent = msg;
                const panel = el.closest('.message-log-box');
                panel.classList.remove('toast-idle');
                clearTimeout(this.toastTimer);
                this.toastTimer = setTimeout(() => panel.classList.add('toast-idle'), 14000);
            }
        }

        toggleHUDDetails() {
            const hud = document.getElementById('hud-layer');
            hud.classList.toggle('hud-compact');
            const expanded = !hud.classList.contains('hud-compact');
            document.getElementById('btn-hud-details').setAttribute('aria-expanded', String(expanded));
            if (expanded && document.pointerLockElement) {
                try { document.exitPointerLock(); } catch (e) {}
            }
        }

        drawMinimap() {
            const canvas = document.getElementById('minimap-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const cx = w / 2;
            const cy = h / 2;
            const scale = 3.5;

            ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
            ctx.lineWidth = 1;
            [28, 56, 84].forEach(r => {
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
            });

            ctx.fillStyle = 'rgba(0, 190, 255, 0.14)';
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
            WALKABLE_RECTS.forEach(r => {
                const rx = cx + r.minX * scale;
                const ry = cy + r.minZ * scale;
                const rw = (r.maxX - r.minX) * scale;
                const rh = (r.maxZ - r.minZ) * scale;
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeRect(rx, ry, rw, rh);
            });

            // Central Tokamak Reactor
            ctx.fillStyle = this.reactorArmed ? '#ff2a4b' : '#00f0ff';
            ctx.beginPath();
            ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
            ctx.fill();

            // Escape Pod KESTREL-01 in South Hangar [0, 21]
            ctx.fillStyle = '#00ff9d';
            ctx.beginPath();
            ctx.arc(cx, cy + 21.0 * scale, 6.5, 0, Math.PI * 2);
            ctx.fill();

            // Uncollected module beacons
            ESCAPE_MODULES.forEach(m => {
                if (this.collected[m.id] || this.installed[m.id]) return;
                const mx = cx + m.pos[0] * scale;
                const my = cy + m.pos[2] * scale;
                ctx.fillStyle = `rgb(${Math.floor(m.color[0] * 255)}, ${Math.floor(m.color[1] * 255)}, ${Math.floor(m.color[2] * 255)})`;
                ctx.beginPath();
                ctx.arc(mx, my, 4.2 + Math.sin(this.time * 6) * 1.3, 0, Math.PI * 2);
                ctx.fill();
            });

            // Player Position & View Cone
            const px = cx + this.playerPos.x * scale;
            const py = cy + this.playerPos.z * scale;
            const yawRad = (this.yaw * Math.PI) / 180;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.arc(px, py, 20, -yawRad - Math.PI / 2 - 0.45, -yawRad - Math.PI / 2 + 0.45);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(px, py, 3.8, 0, Math.PI * 2);
            ctx.fill();
        }

        // =====================================================================
        // OBJECTIVE WAYPOINT
        // =====================================================================
        getCurrentObjective() {
            const p = this.playerPos;
            const near = (list) => {
                let best = null, bd = 1e9;
                list.forEach(o => {
                    const d = Math.hypot(o.pos[0] - p.x, o.pos[2] - p.z);
                    if (d < bd) { bd = d; best = o; }
                });
                return best;
            };
            if (this.eng.suitO2 < 30) {
                return near([
                    { pos: [3.8, 1.4, -3.4], name: 'O₂ REFILL // 酸素充填', color: '#ff4d6a' },
                    { pos: [-4.2, 1.4, -20.2], name: 'O₂ REFILL // 酸素充填', color: '#ff4d6a' }
                ]);
            }
            const pending = ESCAPE_MODULES.filter(m => !this.collected[m.id] && !this.installed[m.id])
                .map(m => ({ pos: [m.pos[0], 1.5, m.pos[2]], name: (m.engName || m.name), color: '#ffae00' }));
            if (pending.length) return near(pending);
            if (!this.eng.p6.calibrated) return { pos: [0, 1.4, -3.45], name: 'TR-1 ΔV CALCULATOR // 反応炉計算盤', color: '#00f0ff' };
            return { pos: [0, 1.6, 19.2], name: 'KESTREL-01 HATCH // 脱出ポッド', color: '#00ff9d' };
        }

        updateObjectiveMarker() {
            const el = document.getElementById('objective-marker');
            if (!el) return;
            const obj = this.getCurrentObjective();
            const camPos = this.camera.getPosition();
            const dx = obj.pos[0] - camPos.x, dy = obj.pos[1] - camPos.y, dz = obj.pos[2] - camPos.z;
            const dist = Math.hypot(dx, dy, dz);
            if (!obj || dist < 2.4) { el.classList.add('hidden'); return; }
            el.classList.remove('hidden');
            const inv = 1 / dist;
            const dir = new pc.Vec3(dx * inv, dy * inv, dz * inv);
            const w = window.innerWidth, h = window.innerHeight;
            let x, y, off = false;
            if (this.camera.forward.dot(dir) > 0.08) {
                this.camera.camera.worldToScreen(new pc.Vec3(obj.pos[0], obj.pos[1], obj.pos[2]), this._scr);
                x = this._scr.x; y = this._scr.y;
                if (x < 50 || x > w - 50 || y < 60 || y > h - 60) off = true;
            } else {
                off = true;
            }
            if (off) {
                const rx = this.camera.right.dot(dir), uy = this.camera.up.dot(dir);
                const a = Math.atan2(-uy, rx);
                const c = Math.cos(a), s = Math.sin(a);
                const mx = w / 2 - 70, my = h / 2 - 90;
                const k = Math.min(mx / Math.max(Math.abs(c), 1e-4), my / Math.max(Math.abs(s), 1e-4));
                x = w / 2 + c * k; y = h / 2 + s * k;
            }
            el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
            el.classList.toggle('offscreen', off);
            el.style.setProperty('--obj-color', obj.color);
            const nameEl = document.getElementById('objective-name');
            const distEl = document.getElementById('objective-dist');
            if (nameEl && nameEl.textContent !== obj.name) nameEl.textContent = obj.name;
            if (distEl) distEl.textContent = `${dist.toFixed(1)} m`;
        }

        // =====================================================================
        // STRUCTURAL TREMORS & STATION AMBIENCE
        // =====================================================================
        triggerTremor(intensity) {
            const V = window.OrbitalGame.VFX;
            const T = this.tremor;
            T.trauma = Math.min(1, T.trauma + 0.55 * intensity);
            T.alertT = 2.0;
            T.flickerT = 1.3;
            window.OrbitalGame.Audio.playTremor && window.OrbitalGame.Audio.playTremor(intensity);
            document.getElementById('tremor-alert')?.classList.remove('hidden');
            // Sparks and dust raining from the ceiling around the player
            for (let n = 0; n < 3; n++) {
                const ox = this.playerPos.x + V.rand(-4, 4), oz = this.playerPos.z + V.rand(-4, 4);
                const oy = 4.2;
                for (let i = 0; i < 26; i++) {
                    this.stationVfx.spawn({
                        pos: [ox, oy, oz], vel: [V.rand(-3, 3), V.rand(-2, 1.5), V.rand(-3, 3)],
                        life: V.rand(0.6, 1.4), size: 0.035,
                        color: [3.2, 2.2, 1.0, 1], colorEnd: [1.4, 0.4, 0.05, 0],
                        cell: V.CELL.SPARK, blend: 0, gravity: -9.8, drag: 0.4, orient: V.ORIENT_STRETCH, stretch: 0.05
                    });
                }
                for (let i = 0; i < 10; i++) {
                    this.stationVfx.spawn({
                        pos: [ox + V.rand(-0.6, 0.6), oy, oz + V.rand(-0.6, 0.6)], vel: [V.rand(-0.4, 0.4), V.rand(-1.6, -0.6), V.rand(-0.4, 0.4)],
                        life: V.rand(1.8, 3.0), size: 0.25, sizeEnd: V.rand(0.9, 1.5),
                        color: [0.55, 0.57, 0.6, 0.45], colorEnd: [0.5, 0.52, 0.55, 0],
                        cell: V.CELL.SMOKE, blend: 1, drag: 0.8, rotVel: V.rand(-0.5, 0.5)
                    });
                }
            }
        }

        updateTremors(dt) {
            const T = this.tremor;
            T.next -= dt;
            if (T.next <= 0) {
                const urgency = (this.reactorArmed ? 1 : 0) + (this.countdown < 120 ? 1 : 0);
                this.triggerTremor(0.6 + urgency * 0.25 + Math.random() * 0.2);
                T.next = urgency >= 2 ? 9 + Math.random() * 6 : (urgency === 1 ? 15 + Math.random() * 8 : 24 + Math.random() * 14);
            }
            T.trauma = Math.max(0, T.trauma - dt * 0.8);
            if (T.alertT > 0) {
                T.alertT -= dt;
                if (T.alertT <= 0) document.getElementById('tremor-alert')?.classList.add('hidden');
            }
            const lights = this.station.emergencyLights || [];
            if (T.flickerT > 0) {
                T.flickerT -= dt;
                lights.forEach(l => {
                    if (!l.light) return;
                    if (l._baseI === undefined) l._baseI = l.light.intensity;
                    l.light.intensity = Math.random() < 0.45 ? l._baseI * 0.12 : l._baseI * (0.7 + Math.random() * 0.5);
                });
                if (T.flickerT <= 0) lights.forEach(l => { if (l.light && l._baseI !== undefined) l.light.intensity = l._baseI; });
            }
        }

        updateStationAmbience(dt) {
            const V = window.OrbitalGame.VFX;
            const fx = this.stationVfx;
            // Thermal-lab steam leak jets (until the bypass puzzle is solved)
            if (this.eng.steamLeakActive) {
                const jets = [
                    { p: [-19.05, 3.2, -16.4], d: [1, -0.25, 0.15] },
                    { p: [-16.2, 3.9, -22.1], d: [0.1, -0.35, 1] }
                ];
                jets.forEach(j => {
                    const n = Math.random() < 0.85 ? 2 : 4;
                    for (let i = 0; i < n; i++) {
                        const sp = V.rand(3.5, 6.5);
                        fx.spawn({
                            pos: [j.p[0], j.p[1], j.p[2]],
                            vel: [j.d[0] * sp + V.rand(-0.5, 0.5), j.d[1] * sp + V.rand(-0.4, 0.4), j.d[2] * sp + V.rand(-0.5, 0.5)],
                            life: V.rand(1.0, 1.8), size: 0.12, sizeEnd: V.rand(0.9, 1.5),
                            color: [0.88, 0.92, 0.96, 0.32], colorEnd: [0.85, 0.9, 0.95, 0],
                            cell: V.CELL.SMOKE, blend: 1, drag: 2.4, gravity: 0.6, rotVel: V.rand(-1, 1), fadeIn: 0.05, fadeOut: 0.4
                        });
                    }
                });
            }
            // Reactor plasma arcs (more violent once the overload is armed)
            const arcRate = this.reactorArmed ? 0.55 : 0.12;
            if (Math.random() < arcRate) {
                const a = Math.random() * Math.PI * 2;
                const r = 1.55 + V.rand(-0.3, 0.3);
                const hot = this.reactorArmed;
                for (let i = 0; i < (hot ? 8 : 4); i++) {
                    fx.spawn({
                        pos: [Math.cos(a) * r, 2.85 + V.rand(-0.35, 0.35), Math.sin(a) * r],
                        vel: [Math.cos(a) * V.rand(1, 4), V.rand(-2, 3), Math.sin(a) * V.rand(1, 4)],
                        life: V.rand(0.15, 0.4), size: 0.03,
                        color: hot ? [3.2, 1.2, 0.6, 1] : [0.8, 2.4, 3.2, 1], colorEnd: hot ? [1.2, 0.2, 0.05, 0] : [0.2, 0.6, 1.4, 0],
                        cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.08, drag: 1.5
                    });
                }
            }
            // Floating dust motes catching the helmet light
            if (Math.random() < 0.5) {
                const cp = this.camera.getPosition();
                const f = this.camera.forward;
                const d = V.rand(1.2, 5);
                fx.spawn({
                    pos: [cp.x + f.x * d + V.rand(-1.6, 1.6), cp.y + V.rand(-0.9, 1.0), cp.z + f.z * d + V.rand(-1.6, 1.6)],
                    vel: [V.rand(-0.06, 0.06), V.rand(-0.03, 0.05), V.rand(-0.06, 0.06)],
                    life: V.rand(3, 6), size: V.rand(0.008, 0.016),
                    color: [0.85, 0.9, 1.0, 0.55], colorEnd: [0.85, 0.9, 1.0, 0],
                    cell: V.CELL.DOT, blend: 0, fadeIn: 0.25, fadeOut: 0.6
                });
            }
        }

        update(dt) {
            this.time += dt;

            if (this.station && this.station.root.enabled) {
                this.station.updateStation(dt, this.time, this.reactorArmed);
            }

            const stationVisible = !!(this.station && this.station.root.enabled) &&
                (this.state === 'TITLE' || this.state === 'EXPLORE' || this.state === 'TERMINAL');
            if (this.stationVfx) {
                this.stationVfx.entity.enabled = stationVisible;
                if (stationVisible) {
                    this.updateStationAmbience(dt);
                    this.stationVfx.update(dt);
                }
            }

            if (this.state === 'TITLE') {
                const angle = this.time * 0.22;
                this.camera.setPosition(Math.sin(angle) * 5.2, 2.3, -15.5 + Math.cos(angle) * 3.5);
                this.camera.lookAt(0, 1.6, -24.0);
                return;
            }

            if (this.state === 'CINEMATIC') {
                this.cinematic.update(dt);
                return;
            }

            if (this.state !== 'EXPLORE' && this.state !== 'TERMINAL') return;

            // 1. Update Reactor Countdown & Suit O2 Drain
            const rate = this.reactorArmed ? 1.85 : 1.0;
            this.countdown = Math.max(0, this.countdown - dt * rate);

            const o2DrainRate = this.eng.steamLeakActive ? 0.34 : 0.14;
            this.eng.suitO2 = Math.max(0, this.eng.suitO2 - dt * o2DrainRate);

            if (this.postEffect) {
                const tr = this.tremor ? this.tremor.trauma * this.tremor.trauma : 0;
                this.postEffect.hypoxiaAmount = this.eng.suitO2 < 35 ? (35 - this.eng.suitO2) / 35 : 0;
                this.postEffect.shakeAmount = (this.reactorArmed ? 0.15 : 0.0) + tr * 0.8;
                this.postEffect.shakeOffset[0] = Math.sin(this.time * 47.0) * tr * 0.003;
                this.postEffect.shakeOffset[1] = Math.cos(this.time * 41.0) * tr * 0.003;
            }

            const mins = Math.floor(this.countdown / 60);
            const secs = Math.floor(this.countdown % 60);
            const ms = Math.floor((this.countdown % 1) * 100);
            const cdEl = document.getElementById('countdown-display');
            if (cdEl) {
                cdEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
            }

            const timerBox = document.getElementById('timer-box');
            const badge = document.getElementById('reactor-state-badge');
            if (this.reactorArmed || this.countdown < 60 || this.eng.suitO2 < 25) {
                timerBox?.classList.add('critical');
                badge?.classList.add('armed');
                if (badge) {
                    badge.textContent = this.eng.suitO2 < 25
                        ? 'SUIT HYPOXIA // スーツ酸素枯渇危険'
                        : (this.reactorArmed ? 'OVERLOAD ARMED // 臨界爆縮作動中' : 'CRITICAL // 炉心崩壊間近');
                }
                document.getElementById('screen-fx')?.classList.toggle('alarm-pulse', Math.sin(this.time * 8) > 0);

                this.alarmAccum += dt;
                if (this.alarmAccum > 2.4) {
                    this.alarmAccum = 0;
                    window.OrbitalGame.Audio.playAlarmPulse();
                }
            } else {
                timerBox?.classList.remove('critical');
                badge?.classList.remove('armed');
                if (badge) badge.textContent = 'CONTAINMENT DECAY // 磁場減衰中';
                document.getElementById('screen-fx')?.classList.remove('alarm-pulse');
            }

            if (this.countdown <= 0 || this.eng.suitO2 <= 0) {
                this.launchEndingCinematic(this.installed, true, this.eng);
                return;
            }

            this.updateResourceHUD();
            this.updateTremors(dt);

            if (this.state !== 'EXPLORE') return;

            // 2. First-Person Movement & Seamless Union-of-Rectangles Collision
            if (this.moveKeys.q) this.yaw += 95 * dt;

            const yawRad = (this.yaw * Math.PI) / 180;
            const fwdX = -Math.sin(yawRad);
            const fwdZ = -Math.cos(yawRad);
            const rightX = Math.cos(yawRad);
            const rightZ = -Math.sin(yawRad);

            let moveX = 0;
            let moveZ = 0;
            if (this.moveKeys.w) { moveX += fwdX; moveZ += fwdZ; }
            if (this.moveKeys.s) { moveX -= fwdX; moveZ -= fwdZ; }
            if (this.moveKeys.d) { moveX += rightX; moveZ += rightZ; }
            if (this.moveKeys.a) { moveX -= rightX; moveZ -= rightZ; }

            const len = Math.hypot(moveX, moveZ);
            const isMoving = len > 0.01;
            const speed = this.moveKeys.shift ? 8.4 : 5.4;

            if (isMoving) {
                moveX = (moveX / len) * speed * dt;
                moveZ = (moveZ / len) * speed * dt;

                // Axis-separated sliding collision using union-of-rectangles check (zero doorway seam blocks!)
                const nextX = this.playerPos.x + moveX;
                if (isPositionWalkable(nextX, this.playerPos.z, 0.36)) {
                    this.playerPos.x = nextX;
                }
                const nextZ = this.playerPos.z + moveZ;
                if (isPositionWalkable(this.playerPos.x, nextZ, 0.36)) {
                    this.playerPos.z = nextZ;
                }

                this.stepAccum += dt * (this.moveKeys.shift ? 1.55 : 1.0);
                if (this.stepAccum >= 0.42) {
                    this.stepAccum = 0;
                    window.OrbitalGame.Audio.playFootstep(this.moveKeys.shift);
                }
            }

            const bobOffset = isMoving ? Math.sin(this.time * (this.moveKeys.shift ? 14 : 9.5)) * 0.052 : 0;
            const tr = this.tremor.trauma * this.tremor.trauma;
            const sx = (Math.sin(this.time * 37.0) * 0.6 + Math.sin(this.time * 71.0) * 0.4) * tr * 0.09;
            const sy = (Math.sin(this.time * 43.0 + 1.3) * 0.6 + Math.sin(this.time * 67.0) * 0.4) * tr * 0.07;
            this.camera.setPosition(this.playerPos.x + sx, 1.7 + bobOffset + sy, this.playerPos.z);
            this.camera.setEulerAngles(this.pitch + sy * 18, this.yaw + sx * 14, Math.sin(this.time * 29.0) * tr * 2.2);

            const zoneEl = document.getElementById('hud-zone-name');
            if (zoneEl) zoneEl.textContent = this.getCurrentZoneName(this.playerPos.x, this.playerPos.z);

            this.checkInteractables();
            this.updateObjectiveMarker();
            this.drawMinimap();
        }
    }

    // Let the cinematic menu paint before the procedural 3D assets are built.
    window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(() => setTimeout(() => {
        try {
            const game = new GameController();
            game.init();
            window.OrbitalGame.instance = game;
            document.getElementById('btn-start-mission').disabled = false;
            document.getElementById('btn-open-sim-title').disabled = false;
            document.getElementById('boot-status').textContent = '準備完了';
            document.getElementById('boot-status').classList.add('ready');
        } catch (error) {
            console.error('Orbital Recoil initialization failed:', error);
            document.getElementById('boot-status').textContent = '起動できませんでした。WebGL対応ブラウザーで再読み込みしてください。';
        }
    }, 0)));
})();

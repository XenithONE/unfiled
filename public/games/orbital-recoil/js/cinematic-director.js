window.OrbitalGame = window.OrbitalGame || {};

// =============================================================================
// CINEMATIC DIRECTOR — shot-based ending sequences for all 10 endings
//
// Every ending is a list of "shots" on a timeline. Each shot owns its staging,
// camera work, VFX, telemetry and subtitles. Shared building blocks:
//   CameraRig        : damped dolly/look with trauma-based shake + FOV
//   ParticleEngine   : fire, sparks, smoke, plasma, spray, cloth (vfx-particles.js)
//   SurfaceEnv       : sky dome, Gerstner ocean, clouds, islands (surface-environment.js)
//   CinematicVisor   : flash / fade / heat haze / hypoxia grading (post-effects.js)
// =============================================================================
(function () {
    const DEG = 180 / Math.PI;
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
    const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; const x = clamp01(k) - 1; return 1 + c3 * x * x * x + c1 * x * x; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const wob = (t, s) => Math.sin(t * 1.31 + s) * 0.5 + Math.sin(t * 2.71 + s * 1.7) * 0.3 + Math.sin(t * 5.13 + s * 2.3) * 0.2;
    const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

    const _up = new pc.Vec3(0, 1, 0);
    const _q = new pc.Quat();
    const _axis = new pc.Vec3();
    const _va = new pc.Vec3();
    const _vb = new pc.Vec3();

    function addPrim(parent, type, name, pos, scale, rot, material) {
        const e = new pc.Entity(name);
        e.addComponent('render', { type, material, castShadows: false, receiveShadows: false });
        if (pos) e.setLocalPosition(pos[0], pos[1], pos[2]);
        if (scale) e.setLocalScale(scale[0], scale[1], scale[2]);
        if (rot) e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
        parent.addChild(e);
        return e;
    }

    function setMaterialDeep(ent, mat) {
        if (ent && ent.render) ent.render.meshInstances.forEach(mi => { mi.material = mat; });
    }

    // Orient an entity so that its local +Y points along (dx, dy, dz) in world space
    function alignY(ent, dx, dy, dz) {
        const l = Math.hypot(dx, dy, dz) || 1;
        _va.set(dx / l, dy / l, dz / l);
        const d = _up.dot(_va);
        if (d > 0.99999) _q.set(0, 0, 0, 1);
        else if (d < -0.99999) _q.setFromAxisAngle(pc.Vec3.RIGHT, 180);
        else {
            _axis.cross(_up, _va).normalize();
            _q.setFromAxisAngle(_axis, Math.acos(d) * DEG);
        }
        ent.setRotation(_q);
    }

    function placeBetween(ent, a, b, thick) {
        ent.setPosition((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        ent.setLocalScale(thick, Math.hypot(dx, dy, dz), thick);
        alignY(ent, dx, dy, dz);
    }

    const VS_GLOW = `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        uniform mat4 matrix_model;
        uniform mat4 matrix_viewProjection;
        uniform mat3 matrix_normal;
        varying vec3 vLocalPos;
        varying vec3 vPositionW;
        varying vec3 vNormalW;
        void main(void) {
            vLocalPos = aPosition;
            vec4 wp = matrix_model * vec4(aPosition, 1.0);
            vPositionW = wp.xyz;
            vNormalW = normalize(matrix_normal * aNormal);
            gl_Position = matrix_viewProjection * wp;
        }
    `;

    const FS_VOLUMETRIC_GLOW = `
        precision highp float;
        varying vec3 vLocalPos;
        varying vec3 vPositionW;
        varying vec3 vNormalW;
        uniform vec3 view_position;
        uniform vec3 uColor;
        uniform vec3 uCoreColor;
        uniform float uIntensity;
        uniform float uPower;
        uniform float uTime;
        void main(void) {
            vec3 V = normalize(view_position - vPositionW);
            vec3 N = normalize(vNormalW);
            float ndv = max(abs(dot(N, V)), 0.0);
            float radial = pow(ndv, uPower);
            float core = pow(ndv, uPower * 3.2);
            float n1 = sin(vLocalPos.x * 13.0 + uTime * 6.5) * cos(vLocalPos.y * 13.0 - uTime * 5.2) * sin(vLocalPos.z * 13.0 + uTime * 6.0);
            float n2 = cos(vLocalPos.x * 27.0 - uTime * 11.0) * sin(vLocalPos.y * 25.0 + uTime * 9.5);
            float turb = 0.68 + 0.32 * (n1 * 0.7 + n2 * 0.3);
            vec3 raw = mix(uColor, uCoreColor, core) * radial * turb * uIntensity;
            vec3 col = raw / (vec3(1.0) + raw * vec3(0.22, 0.38, 0.65));
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    const FS_PLASMA_SHEATH = `
        precision highp float;
        varying vec3 vLocalPos;
        varying vec3 vPositionW;
        varying vec3 vNormalW;
        uniform vec3 view_position;
        uniform vec3 uColor;
        uniform vec3 uHotColor;
        uniform float uIntensity;
        uniform float uMode;
        uniform float uTime;
        void main(void) {
            vec3 V = normalize(view_position - vPositionW);
            vec3 N = normalize(vNormalW);
            float ndv = max(abs(dot(N, V)), 0.0);
            float ang = atan(vLocalPos.y, vLocalPos.x);
            if (uMode < 0.5) {
                // Thin translucent bow-shock meniscus hugging the leading (-Z) heat-shield
                float front = smoothstep(-0.04, -0.44, vLocalPos.z);
                float r2 = length(vLocalPos.xy);
                float rimFade = 1.0 - smoothstep(0.32, 0.49, r2);
                float meniscus = pow(1.0 - ndv, 1.35) * 0.85 + pow(ndv, 2.6) * 0.28;
                float fil = 0.68 + 0.32 * sin(ang * 16.0 + uTime * 26.0) * cos(r2 * 24.0 - uTime * 34.0);
                float mask = front * rimFade * meniscus * fil;
                float hot = smoothstep(-0.24, -0.48, vLocalPos.z) * (1.0 - smoothstep(0.18, 0.42, r2));
                vec3 raw = mix(uColor, uHotColor, hot * 0.75) * mask * uIntensity;
                vec3 col = raw / (vec3(1.0) + raw * vec3(0.25, 0.42, 0.70));
                gl_FragColor = vec4(col, 1.0);
            } else {
                // Hollow Fresnel wake envelope trailing behind the capsule (+Z)
                float fresnel = pow(1.0 - ndv, 2.25) * smoothstep(0.0, 0.24, 1.0 - ndv);
                float axial = smoothstep(-0.44, -0.10, vLocalPos.z) * (1.0 - smoothstep(0.08, 0.49, vLocalPos.z));
                float stream = 0.58 + 0.42 * sin(ang * 10.0 + vLocalPos.z * 16.0 - uTime * 38.0) * cos(ang * 6.0 - vLocalPos.z * 11.0 + uTime * 29.0);
                vec3 raw = mix(uColor, uHotColor, smoothstep(0.1, -0.35, vLocalPos.z) * 0.45) * fresnel * axial * stream * uIntensity;
                vec3 col = raw / (vec3(1.0) + raw * vec3(0.25, 0.42, 0.70));
                gl_FragColor = vec4(col, 1.0);
            }
        }
    `;

    function createVolumetricGlowMat(device, name, color, coreColor, power, intensity) {
        const shader = pc.createShaderFromCode(device, VS_GLOW, FS_VOLUMETRIC_GLOW, 'CineVolGlow_' + name, {
            aPosition: pc.SEMANTIC_POSITION,
            aNormal: pc.SEMANTIC_NORMAL
        });
        const m = new pc.Material();
        m.shader = shader;
        m.blendType = pc.BLEND_ADDITIVE;
        m.depthWrite = false;
        m.cull = pc.CULLFACE_BACK;
        m.setParameter('uColor', color);
        m.setParameter('uCoreColor', coreColor || color);
        m.setParameter('uPower', power);
        m.setParameter('uIntensity', intensity);
        m.setParameter('uTime', 0);
        m.update();
        return m;
    }

    function createPlasmaSheathMat(device, name, mode, color, hotColor) {
        const shader = pc.createShaderFromCode(device, VS_GLOW, FS_PLASMA_SHEATH, 'CinePlasmaSheath_' + name, {
            aPosition: pc.SEMANTIC_POSITION,
            aNormal: pc.SEMANTIC_NORMAL
        });
        const m = new pc.Material();
        m.shader = shader;
        m.blendType = pc.BLEND_ADDITIVE;
        m.depthWrite = false;
        m.cull = pc.CULLFACE_NONE;
        m.setParameter('uColor', color);
        m.setParameter('uHotColor', hotColor);
        m.setParameter('uMode', mode);
        m.setParameter('uIntensity', 0);
        m.setParameter('uTime', 0);
        m.update();
        return m;
    }

    // -------------------------------------------------------------------------
    // Camera rig: critically-damped dolly + look, trauma shake, FOV, roll
    // -------------------------------------------------------------------------
    class CameraRig {
        constructor() {
            this.pos = new pc.Vec3();
            this.look = new pc.Vec3();
            this.tPos = new pc.Vec3();
            this.tLook = new pc.Vec3();
            this.fov = 60; this.tFov = 60;
            this.roll = 0; this.tRoll = 0;
            this.posLag = 4; this.lookLag = 6; this.fovLag = 2;
            this.trauma = 0;
            this.minTrauma = 0;
        }
        cut(pos, look, fov) {
            this.pos.set(pos[0], pos[1], pos[2]); this.tPos.copy(this.pos);
            this.look.set(look[0], look[1], look[2]); this.tLook.copy(this.look);
            if (fov !== undefined) { this.fov = fov; this.tFov = fov; }
        }
        to(pos, look, fov, posLag, lookLag) {
            if (pos) this.tPos.set(pos[0], pos[1], pos[2]);
            if (look) this.tLook.set(look[0], look[1], look[2]);
            if (fov !== undefined && fov !== null) this.tFov = fov;
            if (posLag !== undefined) this.posLag = posLag;
            if (lookLag !== undefined) this.lookLag = lookLag;
        }
        shake(amount) { this.trauma = Math.min(1.25, this.trauma + amount); }
        update(dt, t, cam, postFx) {
            const kp = 1 - Math.exp(-this.posLag * dt);
            const kl = 1 - Math.exp(-this.lookLag * dt);
            this.pos.lerp(this.pos, this.tPos, kp);
            this.look.lerp(this.look, this.tLook, kl);
            this.fov = lerp(this.fov, this.tFov, 1 - Math.exp(-this.fovLag * dt));
            this.roll = lerp(this.roll, this.tRoll, 1 - Math.exp(-2 * dt));
            this.trauma = Math.max(this.minTrauma, this.trauma - dt * 0.85);
            const s = this.trauma * this.trauma;
            const ox = wob(t * 17.0, 1.3) * s * 0.55;
            const oy = wob(t * 15.0, 4.1) * s * 0.55;
            const oz = wob(t * 13.0, 7.7) * s * 0.35;
            cam.setPosition(this.pos.x + ox, this.pos.y + oy, this.pos.z + oz);
            cam.lookAt(this.look);
            cam.rotateLocal(0, 0, this.roll + wob(t * 11.0, 2.2) * s * 3.5);
            cam.camera.fov = this.fov + s * 2.5;
            if (postFx) {
                postFx.gForceShake = Math.min(1, s * 0.7);
                postFx.shakeOffset[0] = wob(t * 31.0, 5.5) * s * 0.004;
                postFx.shakeOffset[1] = wob(t * 29.0, 8.8) * s * 0.004;
            }
        }
    }

    const TRACK_LABELS = ['SEPARATION', 'DETONATION', 'TRANSFER', 'RE-ENTRY', 'DESCENT', 'SPLASHDOWN'];

    // =========================================================================
    class CinematicDirector {
        constructor(app, mats, createPodFn) {
            this.app = app;
            this.mats = mats;
            this.createPodFn = createPodFn;
            this.root = null;
            this.active = false;
            this.time = 0;
            this.duration = 16;
            this.ending = null;
            this.installed = {};
            this.onComplete = null;
            this.postFx = null;
            this.rig = new CameraRig();
            this.vfx = new window.OrbitalGame.VFX.ParticleEngine(app, 6000, 'CinematicVFX');
            this.timeScale = 1;
            this.flags = {};
            this._domCache = {};
            this._lastSub = '';
            this._lastPhase = '';
            this._lastTrack = -1;
        }

        // ---------------------------------------------------------------------
        // Lifecycle
        // ---------------------------------------------------------------------
        start(installedMap, isTimeout, cameraEntity, onCompleteCallback, engState = null, explicitEnding = null) {
            this.stop();
            const CE = window.OrbitalGame.CinematicEndings;
            this.active = true;
            this.time = 0;
            this.timeScale = 1;
            this.installed = Object.assign({}, installedMap);
            this.ending = explicitEnding || CE.evaluateEnding(this.installed, isTimeout, engState);
            this.engState = engState;
            this.camera = cameraEntity;
            this.onComplete = onCompleteCallback;
            this.flags = {};
            this.flash = 0; this.flashDecay = 3; this.flashColor = [1, 0.95, 0.88];
            this.shotFade = 0;
            this.tele = { vel: 7.66, g: 0, temp: 22, alt: 418 };
            this._lastSub = ''; this._lastPhase = ''; this._lastTrack = -1;
            this._prevFov = cameraEntity.camera.fov;
            this._prevAmbient = this.app.scene.ambientLight.clone();
            this._prevFog = {
                fog: this.app.scene.fog, color: this.app.scene.fogColor.clone(),
                start: this.app.scene.fogStart, end: this.app.scene.fogEnd
            };

            this.vfx.clear();
            this.vfx.setCamera(cameraEntity);
            this.buildStage();
            this.buildTimeline(this.ending.id);
            this.shotIdx = -1;

            const layer = document.getElementById('cinematic-layer');
            if (layer) {
                layer.classList.remove('cine-ending-fail', 'cine-ending-success');
                layer.classList.add(this.ending.id === 'EARTH_RETURN_SUCCESS' ? 'cine-ending-success' : 'cine-ending-fail');
                layer.classList.remove('cine-bars-in');
                void layer.offsetWidth;
                layer.classList.add('cine-bars-in');
            }
            this.renderTrack();
            this.update(0);
        }

        stop() {
            this.active = false;
            const A = window.OrbitalGame.Audio;
            A.stopReentryPlasmaSound();
            if (A.stopWindRush) A.stopWindRush();
            this.vfx.clear();
            this.timeScale = 1;
            this.showPodWindow(false);
            if (this.postFx && this.postFx.resetModifiers) this.postFx.resetModifiers();
            if (this.mats && this.mats.earthSurface && this.mats.earthSurface.setParameter) {
                const defaultSun = [0.92, 0.06, -0.18];
                this.mats.earthSurface.setParameter('uSunDir', defaultSun);
                if (this.mats.earthAtmosphere && this.mats.earthAtmosphere.setParameter) {
                    this.mats.earthAtmosphere.setParameter('uSunDir', defaultSun);
                }
            }
            if (this._prevFog) {
                this.app.scene.fog = this._prevFog.fog;
                this.app.scene.fogColor = this._prevFog.color;
                this.app.scene.fogStart = this._prevFog.start;
                this.app.scene.fogEnd = this._prevFog.end;
                this._prevFog = null;
            }
            if (this._prevAmbient) {
                this.app.scene.ambientLight = this._prevAmbient;
                this._prevAmbient = null;
            }
            if (this.camera && this._prevFov) this.camera.camera.fov = this._prevFov;
            if (this.root) {
                this.root.destroy();
                this.root = null;
            }
        }

        skip() {
            if (!this.active) return;
            this.time = this.duration;
            this.finish();
        }

        fastForward(target) {
            let guard = 0;
            while (this.active && this.time < target && guard++ < 6000) this.update(1 / 60);
        }

        finish() {
            if (!this.active) return;
            const finishedEnding = this.ending;
            this.active = false;
            const A = window.OrbitalGame.Audio;
            A.stopReentryPlasmaSound();
            if (A.stopWindRush) A.stopWindRush();
            this.showPodWindow(false);
            if (this.onComplete) this.onComplete(finishedEnding);
        }

        // ---------------------------------------------------------------------
        // Timeline
        // ---------------------------------------------------------------------
        buildTimeline(id) {
            const S = [];
            const add = (t0, key, fn, track) => S.push({ t0, key, fn, track });
            if (id === 'STATION_MELTDOWN_TIMEOUT') {
                add(0, 'meltdown', this.shotMeltdown, 1);
                add(4.4, 'meltBlast', this.shotMeltBlast, 1);
                this.duration = 11.0;
            } else {
                add(0, 'undock', this.shotUndock, 0);
                if (id === 'WEAK_BLAST_DRIFT') {
                    add(2.2, 'detWeak', this.shotDetonation, 1);
                    add(5.4, 'drift', this.shotDrift, 2);
                    this.duration = 14.0;
                } else if (id === 'SHOCKWAVE_CRUSH') {
                    add(2.2, 'detCrush', this.shotDetonation, 1);
                    add(5.4, 'crushAfter', this.shotCrushAfter, 1);
                    this.duration = 12.5;
                } else {
                    add(2.2, 'det', this.shotDetonation, 1);
                    add(5.4, 'transit', this.shotTransit, 2);
                    if (id === 'HYPOXIA_IN_ORBIT') {
                        add(7.8, 'hypoxia', this.shotHypoxia, 2);
                        this.duration = 16.2;
                    } else if (id === 'ORBIT_SKIP_LOST') {
                        add(7.8, 'skip', this.shotSkip, 3);
                        add(12.4, 'lost', this.shotLost, 3);
                        this.duration = 16.6;
                    } else if (id === 'ATMOS_BURNUP') {
                        add(7.8, 'reentry', this.shotReentry, 3);
                        add(11.8, 'breakup', this.shotBreakup, 3);
                        this.duration = 17.2;
                    } else {
                        add(7.8, 'reentry', this.shotReentry, 3);
                        add(13.8, 'high', this.shotHigh, 4);
                        add(17.0, 'low', this.shotLow, id === 'EARTH_RETURN_SUCCESS' ? 4 : 5);
                        if (id === 'EARTH_RETURN_SUCCESS') {
                            add(22.0, 'after', this.shotAfter, 5);
                            this.duration = 27.5;
                        } else {
                            this.duration = 23.5;
                        }
                    }
                }
            }
            this.shots = S;
        }

        update(dtRaw) {
            if (!this.active || !this.root) return;
            const dt = dtRaw * this.timeScale;
            this.time += dt;
            const t = this.time;

            let idx = 0;
            for (let i = 0; i < this.shots.length; i++) if (t >= this.shots[i].t0) idx = i;
            let entering = false;
            if (idx !== this.shotIdx) {
                this.shotIdx = idx;
                entering = true;
                this.shotFade = 0;
                this.setTrack(this.shots[idx].track);
            }
            const shot = this.shots[idx];
            shot.fn.call(this, t - shot.t0, dt, entering);

            // Global systems: update camera rig FIRST so billboards, sun sprite, and sky dome use current camera pose
            this.rig.update(dtRaw, t, this.camera, this.postFx);
            if (this.mats.earthSurface && this.mats.earthSurface.setParameter) {
                this.mats.earthSurface.setParameter('uTime', t * 3.0);
            }
            if (this.bowCapMat) this.bowCapMat.setParameter('uTime', t);
            if (this.shellMat) this.shellMat.setParameter('uTime', t);
            if (this.fbCoreMat) this.fbCoreMat.setParameter('uTime', t);
            if (this.fbOuterMat) this.fbOuterMat.setParameter('uTime', t);
            if (this.earthBody && this.spaceGroup.enabled) this.earthBody.rotateLocal(0, dt * (this.earthSpin || 1.2), 0);
            this.updateSunSprite();
            if (this.surface && this.surface.group.enabled) this.surface.update(dt, t, this.camera);
            this.vfx.update(dt);

            this.flash *= Math.exp(-this.flashDecay * dt);
            if (this.postFx) {
                this.postFx.flash = Math.min(1, this.flash);
                this.postFx.flashColor = this.flashColor;
                const endFade = smooth(this.duration - 1.4, this.duration - 0.1, t);
                this.postFx.fadeBlack = Math.max(this.shotFade, endFade);
            }
            this.writeTelemetry();

            if (t >= this.duration) this.finish();
        }

        // ---------------------------------------------------------------------
        // Stage
        // ---------------------------------------------------------------------
        buildStage() {
            const mats = this.mats;
            const device = this.app.graphicsDevice;
            this.root = new pc.Entity('CinematicStageRoot');
            this.app.root.addChild(this.root);

            this.sunLight = new pc.Entity('CineSun');
            this.sunLight.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.96, 0.9), intensity: 1.7, castShadows: false });
            this.root.addChild(this.sunLight);

            this.fillLight = new pc.Entity('CineEarthBounce');
            this.fillLight.addComponent('light', { type: 'directional', color: new pc.Color(0.25, 0.45, 0.75), intensity: 0.35, castShadows: false });
            this.fillLight.setEulerAngles(180, 0, 0); // shining upward from the planet
            this.root.addChild(this.fillLight);

            // ---------------- SPACE GROUP ----------------
            this.spaceGroup = new pc.Entity('SpaceGroup');
            this.root.addChild(this.spaceGroup);
            this.app.scene.ambientLight = new pc.Color(0.05, 0.07, 0.1);

            this.R = 90;
            this.earthGroup = new pc.Entity('CineEarthGroup');
            this.spaceGroup.addChild(this.earthGroup);
            this.earthBody = addPrim(this.earthGroup, 'sphere', 'CineEarth', [0, 0, 0], [180, 180, 180], [-78, 155, 16], mats.earthSurface);
            this.earthAtmo = addPrim(this.earthGroup, 'sphere', 'CineAtmo', [0, 0, 0], [183.2, 183.2, 183.2], [0, 0, 0], mats.earthAtmosphere);
            this.earthSpin = 1.2;

            this.moon = mats.moonSurface ? addPrim(this.spaceGroup, 'sphere', 'CineMoon', [0, 0, 0], [16, 16, 16], [10, 35, -6], mats.moonSurface) : null;

            const sunCore = createVolumetricGlowMat(device, 'SunCore', [1.0, 0.94, 0.82], [1.0, 1.0, 0.96], 1.6, 5.5);
            const sunHalo = createVolumetricGlowMat(device, 'SunCorona', [1.0, 0.65, 0.32], [1.0, 0.92, 0.75], 3.8, 1.25);
            this.sunSprite = new pc.Entity('CineSunSprite');
            this.spaceGroup.addChild(this.sunSprite);
            addPrim(this.sunSprite, 'sphere', 'Photosphere', [0, 0, 0], [9, 9, 9], [0, 0, 0], sunCore);
            addPrim(this.sunSprite, 'sphere', 'Corona', [0, 0, 0], [34, 34, 34], [0, 0, 0], sunHalo);

            this.buildStation();
            this.buildPod();
            this.buildBlastMeshes();

            // ---------------- SURFACE GROUP ----------------
            this.surface = window.OrbitalGame.SurfaceEnv.create(this.app, this.root);
            this.surface.group.enabled = false;

            this.sunDir = [0.85, 0.18, -0.48];
            this.setSun(this.sunDir);
            this.earthPos([24, -76, 108]);
        }

        buildStation() {
            const mats = this.mats;
            const Arch = window.OrbitalGame.MeshArchitect;
            const device = this.app.graphicsDevice;
            const g = new pc.Entity('CineStationHELIOS9');
            this.spaceGroup.addChild(g);
            this.stationGroup = g;
            this.stationChunks = [];
            const chunk = (ent, dir, speed, trail) => {
                const d = norm3(dir);
                this.stationChunks.push({
                    ent,
                    orig: ent.getLocalPosition().clone(),
                    vel: new pc.Vec3(d[0] * speed, d[1] * speed, d[2] * speed),
                    spin: new pc.Vec3(rnd(-80, 80), rnd(-80, 80), rnd(-80, 80)),
                    trail
                });
                return ent;
            };

            this.windowMat = mats.createEmissive(1.0, 0.86, 0.62, 2.2);
            this.ventMat = mats.createEmissive(0.2, 0.9, 1.0, 1.8);

            chunk(addPrim(g, 'sphere', 'CoreHub', [0, 0, 0], [5.0, 5.0, 5.0], [0, 0, 0], mats.titaniumHull), [0.1, 0.4, 0.2], 1.0, false);
            chunk(addPrim(g, 'cylinder', 'HubMLIBand', [0, 0, 0], [5.3, 1.5, 5.3], [0, 0, 90], mats.goldKapton), [0.3, -0.6, 0.4], 3.5, true);
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                chunk(addPrim(g, 'box', `Vent_${i}`, [0, Math.cos(a) * 2.62, Math.sin(a) * 2.62], [1.6, 0.16, 0.55], [a * DEG, 0, 0], this.ventMat),
                    [rnd(-0.3, 0.3), Math.cos(a), Math.sin(a)], rnd(9, 14), false);
            }
            chunk(Arch.createLatticeTruss(g, mats, 'SpineTrussL', [-10.5, 0, 0], [0, 90, 0], 15, 1.3, 6), [-1, 0.25, 0.15], 6, true);
            chunk(Arch.createLatticeTruss(g, mats, 'SpineTrussR', [10.5, 0, 0], [0, 90, 0], 15, 1.3, 6), [1, -0.15, 0.2], 6, true);

            const ringMesh = Arch.createTorusMesh(device, 7.4, 0.62, 64, 14);
            chunk(Arch.addCustomMeshEntity(g, 'HabRing', ringMesh, mats.paddedBulkhead, [0, 0, 0], [1, 1, 1], [0, 0, 90]), [0.15, 0.7, -0.3], 2.4, false);
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
                chunk(addPrim(g, 'cylinder', `Spoke_${i}`, [0, Math.cos(a) * 4.9, Math.sin(a) * 4.9], [0.32, 4.6, 0.32], [a * DEG, 0, 0], mats.darkStructural),
                    [0, Math.cos(a), Math.sin(a)], rnd(7, 11), false);
            }
            // Window strips around the hab ring
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                chunk(addPrim(g, 'box', `RingWindow_${i}`, [0.64, Math.cos(a) * 7.4, Math.sin(a) * 7.4], [0.05, 0.22, 0.9], [a * DEG, 0, 0], this.windowMat),
                    [0.2, Math.cos(a), Math.sin(a)], rnd(5, 9), false);
            }
            // Hangar module (pod departs from here toward -Z) and command module (+Z)
            chunk(addPrim(g, 'cylinder', 'HangarModule', [0, -0.6, -5.6], [3.4, 5.6, 3.4], [90, 0, 0], mats.titaniumHull), [0.1, -0.4, -1], 4, true);
            const hangarRingMat = mats.createEmissive(0.1, 0.85, 1.0, 2.5);
            chunk(Arch.addCustomMeshEntity(g, 'HangarMouthRing', Arch.createTorusMesh(device, 1.75, 0.08, 40, 8), hangarRingMat, [0, -0.6, -8.45], [1, 1, 1], [90, 0, 0]), [0, -0.2, -1], 7, false);
            chunk(addPrim(g, 'cylinder', 'CommandModule', [0, 1.4, 5.4], [2.9, 5.2, 2.9], [90, 0, 0], mats.paddedBulkhead), [0.1, 0.5, 1], 3.5, true);
            for (let i = 0; i < 5; i++) {
                chunk(addPrim(g, 'box', `CmdWindow_${i}`, [1.46, 1.4, 3.6 + i * 0.9], [0.05, 0.35, 0.5], [0, 0, 0], this.windowMat), [1, 0.3, 0.5], rnd(6, 10), false);
            }
            // Solar wings and radiators (tilted 24 deg so photovoltaic cell texture shows without direct sun glare)
            for (const s of [-1, 1]) {
                for (const up of [-1, 1]) {
                    chunk(addPrim(g, 'box', `SolarWing_${s}_${up}`, [s * 17.5, up * 4.4, 0], [8.5, 0.1, 3.6], [24, 0, 0], mats.solarPanel),
                        [s, up * 0.6, rnd(-0.4, 0.4)], rnd(5, 8), false);
                    chunk(addPrim(g, 'cylinder', `SolarMast_${s}_${up}`, [s * 17.5, up * 2.2, 0], [0.18, 4.4, 0.18], [0, 0, 0], mats.darkStructural),
                        [s, up, 0.2], rnd(6, 9), false);
                }
                chunk(addPrim(g, 'box', `Radiator_${s}`, [s * 6.2, 3.6, 1.2], [4.8, 0.08, 2.2], [40, s * 25, 0], mats.paddedBulkhead), [s * 0.6, 1, 0.3], rnd(6, 9), false);
                chunk(addPrim(g, 'box', `RadiatorB_${s}`, [s * 6.2, -3.6, -1.2], [4.8, 0.08, 2.2], [-40, s * 25, 0], mats.paddedBulkhead), [s * 0.6, -1, -0.3], rnd(6, 9), false);
            }

            this.coreLight = new pc.Entity('StationCoreLight');
            this.coreLight.addComponent('light', { type: 'point', color: new pc.Color(0.3, 0.85, 1.0), intensity: 0, range: 40, castShadows: false });
            g.addChild(this.coreLight);
        }

        buildPod() {
            const mats = this.mats;
            const Arch = window.OrbitalGame.MeshArchitect;
            const device = this.app.graphicsDevice;

            this.podWrapper = new pc.Entity('CinePodWrapper');
            this.root.addChild(this.podWrapper);
            this.podModel = this.createPodFn(this.installed);
            this.podWrapper.addChild(this.podModel);
            this.podModel.setLocalEulerAngles(-90, 0, 0);

            if (!this.hotShieldMat) {
                this.hotShieldMat = mats.carbonAblative.clone();
                this.hotHullMat = mats.titaniumHull.clone();
            }
            this.setHeat(0, 0);
            setMaterialDeep(this.podModel.findByName('AblativeHeatShieldDome'), this.hotShieldMat);
            setMaterialDeep(this.podModel.findByName('MonocoqueHull'), this.hotHullMat);

            // Plasma sheath (space frame: travel direction is -Z)
            this.plasmaGroup = new pc.Entity('PlasmaSheath');
            this.plasmaGroup.enabled = false;
            this.podWrapper.addChild(this.plasmaGroup);
            this.bowCapMat = createPlasmaSheathMat(device, 'BowShock', 0.0, [1.0, 0.42, 0.10], [1.0, 0.92, 0.72]);
            this.shellMat = createPlasmaSheathMat(device, 'PlasmaWake', 1.0, [1.0, 0.32, 0.08], [1.0, 0.68, 0.25]);
            this.bowCap = addPrim(this.plasmaGroup, 'sphere', 'BowShock', [0, 0, -1.18], [3.1, 3.1, 0.95], [0, 0, 0], this.bowCapMat);
            this.plasmaShell = addPrim(this.plasmaGroup, 'sphere', 'PlasmaShell', [0, 0, 0.85], [3.5, 3.5, 5.2], [0, 0, 0], this.shellMat);

            // Retro-rocket plumes (surface frame: pod upright, plumes point -Y)
            this.retroGroup = new pc.Entity('RetroPlumes');
            this.retroGroup.enabled = false;
            this.podWrapper.addChild(this.retroGroup);
            this.retroMat = mats.createEmissive(1.0, 0.72, 0.38, 2.4);
            this.retroMat.blendType = pc.BLEND_ADDITIVE; this.retroMat.depthWrite = false; this.retroMat.update();
            this.retroPlumes = [];
            for (let i = 0; i < 4; i++) {
                const a = (i * Math.PI) / 2;
                this.retroPlumes.push(addPrim(this.retroGroup, 'cone', `RetroPlume_${i}`, [Math.cos(a) * 1.28, -1.75, Math.sin(a) * 1.28], [0.45, 2.2, 0.45], [180, 0, 0], this.retroMat));
            }

            // Parachutes
            if (!this.canopyMat) {
                const c = document.createElement('canvas');
                c.width = 512; c.height = 64;
                const ctx = c.getContext('2d');
                for (let i = 0; i < 8; i++) {
                    ctx.fillStyle = i % 2 === 0 ? '#ff5f12' : '#f2efe6';
                    ctx.fillRect(i * 64, 0, 64, 64);
                }
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                for (let i = 0; i <= 8; i++) ctx.fillRect(i * 64 - 1, 0, 2, 64);
                const tex = new pc.Texture(device, { width: 512, height: 64, format: pc.PIXELFORMAT_R8_G8_B8_A8, mipmaps: true, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
                tex.setSource(c);
                this.canopyMat = new pc.StandardMaterial();
                this.canopyMat.diffuseMap = tex;
                this.canopyMat.cull = pc.CULLFACE_NONE;
                this.canopyMat.twoSidedLighting = true;
                this.canopyMat.useMetalness = true;
                this.canopyMat.metalness = 0;
                this.canopyMat.gloss = 0.3;
                this.canopyMat.emissive = new pc.Color(0.18, 0.08, 0.03);
                this.canopyMat.update();
                this.flotMat = new pc.StandardMaterial();
                this.flotMat.diffuse = new pc.Color(1.0, 0.42, 0.08);
                this.flotMat.useMetalness = true; this.flotMat.metalness = 0; this.flotMat.gloss = 0.55;
                this.flotMat.update();
                this.riserMat = new pc.StandardMaterial();
                this.riserMat.diffuse = new pc.Color(0.85, 0.84, 0.8);
                this.riserMat.update();
            }
            this.canopyMesh = Arch.createLatheMesh(device, [[0.0, 1.0], [0.35, 0.97], [0.66, 0.88], [0.88, 0.72], [1.0, 0.52], [1.03, 0.40]], 32);
            this.chuteGroup = new pc.Entity('Parachutes');
            this.chuteGroup.enabled = false;
            this.root.addChild(this.chuteGroup);
            const mkCanopy = (name, radius) => {
                const e = Arch.addCustomMeshEntity(this.chuteGroup, name, this.canopyMesh, this.canopyMat, [0, 0, 0], [radius, radius * 0.78, radius], [0, 0, 0]);
                const risers = [];
                for (let k = 0; k < 4; k++) risers.push(addPrim(this.chuteGroup, 'cylinder', `${name}_Riser${k}`, [0, 0, 0], [0.04, 1, 0.04], [0, 0, 0], this.riserMat));
                return { e, risers, radius, open: 0, offset: new pc.Vec3(), released: false, relVel: new pc.Vec3() };
            };
            this.drogue = mkCanopy('Drogue', 1.5);
            this.mains = [mkCanopy('MainA', 4.4), mkCanopy('MainB', 4.4), mkCanopy('MainC', 4.4)];
            this.mains.forEach((m, i) => {
                const a = (i / 3) * Math.PI * 2 + 0.4;
                m.offset.set(Math.cos(a) * 3.6, 12.5, Math.sin(a) * 3.6);
                m.tilt = [Math.sin(a) * 14, 0, -Math.cos(a) * 14];
            });
            this.drogue.offset.set(0, 8.5, 0);
            this.drogue.tilt = [0, 0, 0];

            // Flotation collar + recovery beacon (surface aftermath)
            this.floatBags = [];
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2;
                const b = addPrim(this.podWrapper, 'sphere', `FloatBag_${i}`, [Math.cos(a) * 0.62, 1.95, Math.sin(a) * 0.62], [0.01, 0.01, 0.01], [0, 0, 0], this.flotMat);
                b.enabled = false;
                this.floatBags.push(b);
            }
            this.beaconMat = mats.createEmissive(1, 1, 1, 8);
            this.beacon = addPrim(this.podWrapper, 'sphere', 'RecoveryBeacon', [0, 2.15, 0], [0.18, 0.18, 0.18], [0, 0, 0], this.beaconMat);
            this.beacon.enabled = false;
            this.beaconLight = new pc.Entity('BeaconLight');
            this.beaconLight.addComponent('light', { type: 'point', color: new pc.Color(1, 1, 1), intensity: 0, range: 8, castShadows: false });
            this.beaconLight.setLocalPosition(0, 2.3, 0);
            this.podWrapper.addChild(this.beaconLight);
        }

        buildBlastMeshes() {
            const mats = this.mats;
            const Arch = window.OrbitalGame.MeshArchitect;
            const device = this.app.graphicsDevice;
            this.fbCoreMat = createVolumetricGlowMat(device, 'FireballCore', [1.0, 0.72, 0.35], [1.0, 0.98, 0.90], 2.4, 0.0);
            this.fbOuterMat = createVolumetricGlowMat(device, 'FireballOuter', [1.0, 0.35, 0.08], [1.0, 0.75, 0.32], 3.2, 0.0);
            this.swMat = mats.createEmissive(0.35, 0.85, 1.0, 0.0);
            this.swMat.blendType = pc.BLEND_ADDITIVE; this.swMat.depthWrite = false; this.swMat.update();
            this.fbCore = addPrim(this.spaceGroup, 'sphere', 'FireballCore', [0, 0, 0], [0.01, 0.01, 0.01], [0, 0, 0], this.fbCoreMat);
            this.fbOuter = addPrim(this.spaceGroup, 'sphere', 'FireballOuter', [0, 0, 0], [0.01, 0.01, 0.01], [0, 0, 0], this.fbOuterMat);
            this.swRing = Arch.addCustomMeshEntity(this.spaceGroup, 'ShockwaveTorus', Arch.createTorusMesh(device, 1.0, 0.025, 64, 10), this.swMat, [0, 0, 0], [0.01, 0.01, 0.01], [78, 0, 0]);
            this.swRing2 = Arch.addCustomMeshEntity(this.spaceGroup, 'ShockwaveTorus2', Arch.createTorusMesh(device, 1.0, 0.018, 64, 10), this.swMat, [0, 0, 0], [0.01, 0.01, 0.01], [12, 40, 0]);
            this.fbCore.enabled = false;
            this.fbOuter.enabled = false;
            this.swRing.enabled = false;
            this.swRing2.enabled = false;
            this.blastLight = new pc.Entity('BlastLight');
            this.blastLight.addComponent('light', { type: 'point', color: new pc.Color(1.0, 0.72, 0.4), intensity: 0, range: 160, castShadows: false });
            this.spaceGroup.addChild(this.blastLight);
        }

        // ---------------------------------------------------------------------
        // Shared helpers
        // ---------------------------------------------------------------------
        setSun(dir) {
            const d = norm3(dir);
            this.sunDir = d;
            alignY(this.sunLight, d[0], d[1], d[2]);
            if (this.mats.earthSurface && this.mats.earthSurface.setParameter) {
                this.mats.earthSurface.setParameter('uSunDir', d);
                if (this.mats.earthAtmosphere && this.mats.earthAtmosphere.setParameter) this.mats.earthAtmosphere.setParameter('uSunDir', d);
            }
        }

        updateSunSprite() {
            if (!this.spaceGroup.enabled || !this.camera) return;
            const cp = this.camera.getPosition();
            const d = this.sunDir;
            this.sunSprite.setPosition(cp.x + d[0] * 600, cp.y + d[1] * 600, cp.z + d[2] * 600);
            if (this.moon) {
                const m = norm3([-0.55, 0.32, -0.77]);
                this.moon.setPosition(cp.x + m[0] * 700, cp.y + m[1] * 700, cp.z + m[2] * 700);
            }
        }

        earthPos(p) { this.earthGroup.setPosition(p[0], p[1], p[2]); }

        // Place Earth so its surface is `h` units below point p along normal n
        earthBelow(p, h, n) {
            const nn = norm3(n || [0.15, 1, 0.45]);
            const d = this.R + h;
            this.earthGroup.setPosition(p.x - nn[0] * d, p.y - nn[1] * d, p.z - nn[2] * d);
        }

        podPos() { return this.podWrapper.getPosition(); }

        setPod(x, y, z) { this.podWrapper.setPosition(x, y, z); }

        setHeat(shield, hull) {
            const bb = (h) => {
                if (h < 0.33) { const k = h / 0.33; return [lerp(0.0, 0.85, k), lerp(0.0, 0.12, k), 0.0]; }
                if (h < 0.66) { const k = (h - 0.33) / 0.33; return [lerp(0.85, 1.0, k), lerp(0.12, 0.5, k), lerp(0.0, 0.12, k)]; }
                const k = (h - 0.66) / 0.34; return [1.0, lerp(0.5, 0.92, k), lerp(0.12, 0.75, k)];
            };
            const s = bb(clamp01(shield)), u = bb(clamp01(hull));
            this.hotShieldMat.emissive.set(s[0], s[1], s[2]);
            this.hotShieldMat.emissiveIntensity = shield * 5.5;
            this.hotShieldMat.update();
            this.hotHullMat.emissive.set(u[0], u[1], u[2]);
            this.hotHullMat.emissiveIntensity = hull * 3.0;
            this.hotHullMat.update();
        }

        once(key, fn) {
            if (this.flags[key]) return false;
            this.flags[key] = true;
            fn();
            return true;
        }

        doFlash(amount, decay, color) {
            this.flash = Math.max(this.flash, amount);
            this.flashDecay = decay;
            if (color) this.flashColor = color;
        }

        rcsPuff(dir, strength = 1) {
            const p = this.podPos();
            const V = window.OrbitalGame.VFX;
            for (let i = 0; i < 10 * strength; i++) {
                const sp = rnd(4, 9) * strength;
                this.vfx.spawn({
                    pos: [p.x + dir[0] * 1.3, p.y + dir[1] * 1.3, p.z + dir[2] * 1.3],
                    vel: [dir[0] * sp + rnd(-1, 1), dir[1] * sp + rnd(-1, 1), dir[2] * sp + rnd(-1, 1)],
                    life: rnd(0.5, 0.9), size: 0.12, sizeEnd: rnd(0.8, 1.3) * strength,
                    color: [0.95, 0.97, 1.0, 0.7], colorEnd: [0.9, 0.92, 0.95, 0],
                    cell: V.CELL.SMOKE, blend: 1, drag: 3.5, fadeIn: 0.02, fadeOut: 0.3
                });
            }
            window.OrbitalGame.Audio.playRcsPuff && window.OrbitalGame.Audio.playRcsPuff();
        }

        enterSpace() {
            this.spaceGroup.enabled = true;
            this.surface.group.enabled = false;
            this.fillLight.enabled = true;
            this.sunLight.light.color = new pc.Color(1, 0.96, 0.9);
            this.sunLight.light.intensity = 1.7;
            this.app.scene.ambientLight = new pc.Color(0.05, 0.07, 0.1);
            this.app.scene.fog = pc.FOG_NONE;
        }

        enterSurface(presetName) {
            const A = window.OrbitalGame.Audio;
            A.stopReentryPlasmaSound();
            this.spaceGroup.enabled = false;
            this.surface.group.enabled = true;
            this.fillLight.enabled = false;
            this.plasmaGroup.enabled = false;
            this.setHeat(0.12, 0.02);
            const { sunDir, preset } = this.surface.setPreset(presetName);
            this.surfacePreset = preset;
            alignY(this.sunLight, sunDir[0], sunDir[1], sunDir[2]);
            this.sunLight.light.color = new pc.Color(preset.light[0], preset.light[1], preset.light[2]);
            this.sunLight.light.intensity = preset.lightIntensity;
            this.app.scene.ambientLight = new pc.Color(preset.ambient[0], preset.ambient[1], preset.ambient[2]);
            this.app.scene.fog = pc.FOG_LINEAR;
            this.app.scene.fogColor = new pc.Color(preset.horizon[0] * 0.85, preset.horizon[1] * 0.85, preset.horizon[2] * 0.85);
            this.app.scene.fogStart = 260;
            this.app.scene.fogEnd = 1100;
            if (this.postFx) { this.postFx.heatHaze = 0; this.postFx.temperature = presetName === 'sunrise' ? 0.18 : 0; this.postFx.exposure = 1.0; }
            this.podModel.setLocalEulerAngles(0, 0, 0);
            this.podModel.setLocalScale(1, 1, 1);
            this.podModel.enabled = true;
        }

        spawnCloudBank(cy, count, spread) {
            const V = window.OrbitalGame.VFX;
            const p = this.surfacePreset;
            for (let i = 0; i < count; i++) {
                const a = rnd(0, Math.PI * 2), r = rnd(25, spread);
                const shade = rnd(0.82, 1.0);
                this.vfx.spawn({
                    pos: [Math.cos(a) * r, cy + rnd(-10, 14), Math.sin(a) * r],
                    vel: [rnd(-0.6, 0.6), 0, rnd(-0.6, 0.6)],
                    life: 60, size: rnd(18, 42), sizeEnd: rnd(20, 46),
                    color: [p.cloudLit[0] * shade, p.cloudLit[1] * shade, p.cloudLit[2] * shade, 0.82],
                    colorEnd: [p.cloudLit[0] * shade, p.cloudLit[1] * shade, p.cloudLit[2] * shade, 0.82],
                    cell: V.CELL.CLOUD, blend: 1, rot: rnd(-0.3, 0.3), fadeIn: 0.01, fadeOut: 0.97
                });
            }
        }

        // Parachute rendering: inflation, sway, risers
        updateChutes(t, dt) {
            const pod = this.podPos();
            const attach = _vb.set(pod.x, pod.y + 1.85, pod.z);
            const all = [this.drogue, ...this.mains];
            for (const c of all) {
                const vis = c.open > 0.001;
                c.e.enabled = vis;
                c.risers.forEach(r => { r.enabled = vis && !c.released; });
                if (!vis) continue;
                if (!c.released) {
                    const sway = Math.sin(t * 1.1 + c.offset.x) * 0.6;
                    c.e.setPosition(pod.x + c.offset.x + sway, pod.y + c.offset.y * (0.35 + 0.65 * Math.min(1, c.open)), pod.z + c.offset.z);
                } else {
                    c.relVel.y -= 2.5 * dt;
                    const p = c.e.getPosition();
                    const ny = Math.max(this.surface ? 0.25 : -999, p.y + c.relVel.y * dt);
                    c.e.setPosition(p.x + c.relVel.x * dt, ny, p.z + c.relVel.z * dt);
                    if (ny <= 0.3) c.flatten = Math.min(1, (c.flatten || 0) + dt * 0.8);
                }
                const breathe = 1 + Math.sin(t * 3.2 + c.offset.z) * 0.035;
                const s = easeOutBack(c.open) * c.radius;
                const flat = c.flatten || 0;
                c.e.setLocalScale(s * breathe, s * 0.78 * (1 - flat * 0.85) / breathe, s * breathe);
                c.e.setLocalEulerAngles(c.tilt[0] + Math.sin(t * 0.9 + c.offset.x) * 3, t * 4, c.tilt[2]);
                if (!c.released) {
                    const wt = c.e.getWorldTransform();
                    for (let k = 0; k < 4; k++) {
                        const a = (k / 4) * Math.PI * 2;
                        wt.transformPoint(_va.set(Math.cos(a) * 1.03, 0.4, Math.sin(a) * 1.03), _axis);
                        placeBetween(c.risers[k], _axis, attach, 0.035);
                    }
                }
            }
        }

        showPodWindow(on, frost = 0) {
            const el = document.getElementById('pod-window-overlay');
            if (!el) return;
            el.classList.toggle('hidden', !on);
            el.style.setProperty('--frost', String(frost));
        }

        // ---------------------------------------------------------------------
        // HUD: telemetry, subtitles, phase track
        // ---------------------------------------------------------------------
        $(id) {
            if (!this._domCache[id]) this._domCache[id] = document.getElementById(id);
            return this._domCache[id];
        }

        sub(phase, text) {
            if (phase !== this._lastPhase) {
                this._lastPhase = phase;
                const el = this.$('cinematic-phase-title');
                if (el) el.textContent = phase;
            }
            if (text !== this._lastSub) {
                this._lastSub = text;
                const el = this.$('cinematic-subtitle');
                if (el) {
                    el.textContent = text;
                    el.classList.remove('cine-sub-anim');
                    void el.offsetWidth;
                    el.classList.add('cine-sub-anim');
                }
            }
        }

        renderTrack() {
            const el = this.$('cine-phase-track');
            if (!el) return;
            el.innerHTML = TRACK_LABELS.map((l, i) => `<li data-k="${i}">${l}</li>`).join('');
        }

        setTrack(k, fail = false) {
            const el = this.$('cine-phase-track');
            if (!el) return;
            el.querySelectorAll('li').forEach((li, i) => {
                li.classList.toggle('done', i < k);
                li.classList.toggle('active', i === k);
                li.classList.toggle('fail', i === k && fail);
            });
            this._lastTrack = k;
        }

        writeTelemetry() {
            const T = this.tele;
            const v = this.$('tele-vel'), g = this.$('tele-g'), tp = this.$('tele-temp'), al = this.$('tele-alt');
            if (v) v.textContent = `${T.vel.toFixed(2)} km/s`;
            if (g) { g.textContent = `${T.g.toFixed(1)} G`; g.className = T.g > 30 ? 'tele-val danger' : (T.g > 12 ? 'tele-val warn' : 'tele-val'); }
            if (tp) { tp.textContent = `${Math.round(T.temp)} °C`; tp.className = T.temp > 1600 ? 'tele-val danger' : (T.temp > 600 ? 'tele-val warn' : 'tele-val'); }
            if (al) al.textContent = T.alt >= 1 ? `${T.alt.toFixed(1)} km` : `${Math.max(0, T.alt * 1000).toFixed(0)} m`;
        }

        // Shared detonation of the station at origin (yield 0..1)
        detonateStation(yieldScale) {
            const P = window.OrbitalGame.VFX.Presets;
            const A = window.OrbitalGame.Audio;
            const big = yieldScale > 0.5;
            A.playStationDetonation(big);
            P.explosion(this.vfx, [0, 0, 0], big ? 2.6 * yieldScale : 0.9, big
                ? { fire: 75, sparks: 320, smoke: 60, debris: 100 }
                : { fire: 35, sparks: 80, smoke: 25, debris: 25 });
            P.shockRing(this.vfx, [0, 0, 0], { size: 2, sizeEnd: big ? 120 : 30, life: big ? 2.2 : 1.4 });
            this.doFlash(big ? 0.65 : 0.28, big ? 4.8 : 5.5, [1, 0.88, 0.68]);
            this.rig.shake(big ? 0.8 : 0.3);
            this.windowMat.emissive.set(0, 0, 0); this.windowMat.update();
            this.blastT0 = this.time;
            this.blastYield = yieldScale;
            this.fbCore.setPosition(0, 0, 0);
            this.fbOuter.setPosition(0, 0, 0);
            this.swRing.setPosition(0, 0, 0);
            this.swRing2.setPosition(0, 0, 0);
            this.blastLight.setPosition(0, 0, 0);

            // Burning trails on large structural chunks
            const V = window.OrbitalGame.VFX;
            this.stationChunks.filter(c => c.trail).forEach(c => {
                this.vfx.addEmitter({
                    rate: 26 * yieldScale, duration: 3.2,
                    spawn: (eng, et) => {
                        const p = c.ent.getPosition();
                        const fade = 1 - et / 3.2;
                        eng.spawn({
                            pos: [p.x + rnd(-0.4, 0.4), p.y + rnd(-0.4, 0.4), p.z + rnd(-0.4, 0.4)],
                            vel: [rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)],
                            life: rnd(0.6, 1.3), size: rnd(0.5, 0.9) * fade + 0.2, sizeEnd: rnd(1.6, 2.6),
                            color: Math.random() < 0.55 ? [1.6, 0.75, 0.22, 0.85] : [0.14, 0.13, 0.13, 0.7],
                            colorEnd: [0.3, 0.1, 0.05, 0],
                            cell: Math.random() < 0.55 ? V.CELL.FIRE : V.CELL.SMOKE,
                            blend: Math.random() < 0.55 ? 0 : 1, drag: 1.2, fadeOut: 0.4
                        });
                    }
                });
            });
        }

        animateBlast(dt) {
            if (this.blastT0 === undefined) return;
            const s = this.time - this.blastT0;
            const y = this.blastYield;
            const big = y > 0.5;
            const coreS = Math.min(big ? 11.5 : 4.2, s * (big ? 18 : 7.5));
            const coreI = Math.max(0, (big ? 1.85 : 1.0) * Math.exp(-s * 1.15));
            this.fbCore.enabled = coreI > 0.02;
            if (this.fbCore.enabled) {
                this.fbCore.setLocalScale(coreS, coreS, coreS);
                this.fbCoreMat.setParameter('uIntensity', coreI);
            }
            const outS = Math.min(big ? 21 : 6.5, s * (big ? 15 : 5.5));
            const outI = Math.max(0, (big ? 1.25 : 0.7) * Math.exp(-s * 0.68));
            this.fbOuter.enabled = outI > 0.02;
            if (this.fbOuter.enabled) {
                this.fbOuter.setLocalScale(outS, outS, outS);
                this.fbOuterMat.setParameter('uIntensity', outI);
            }
            const sw = s * (big ? 34 : 9);
            const swI = Math.max(0, (big ? 2.6 : 1.1) * Math.exp(-s * 1.45));
            this.swRing.enabled = swI > 0.02;
            this.swRing2.enabled = swI > 0.02;
            if (this.swRing.enabled) {
                this.swRing.setLocalScale(sw, sw, sw);
                this.swRing2.setLocalScale(sw * 0.78, sw * 0.78, sw * 0.78);
                this.swMat.emissiveIntensity = swI;
                this.swMat.update();
            }
            this.blastLight.light.intensity = Math.max(0, (big ? 6 : 2) * Math.exp(-s * 1.4));
            const k = big ? 1.0 : 0.12;
            this.stationChunks.forEach(c => {
                const f = s * (1 + s * 0.1) * 2.1 * k;
                c.ent.setLocalPosition(c.orig.x + c.vel.x * f, c.orig.y + c.vel.y * f, c.orig.z + c.vel.z * f);
                c.ent.rotateLocal(c.spin.x * dt * k, c.spin.y * dt * k, c.spin.z * dt * k);
            });
        }

        // =====================================================================
        // SHOTS
        // =====================================================================

        // 0.0 – 2.2  Pod separation from the hangar, reactor going critical
        shotUndock(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            if (enter) {
                this.enterSpace();
                this.setSun([0.85, 0.18, -0.48]);
                this.earthPos([24, -76, 108]);
                this.earthSpin = 1.2;
                this.rig.cut([7.2, 1.6, -15.5], [0, -0.3, -4.5], 52);
                this.rig.to([5.6, 0.9, -16.5], [0, -0.5, -5.5], 50, 0.6, 1.2);
                this.rig.minTrauma = 0.08;
                this.podModel.setLocalEulerAngles(-90, 0, 0);
                // Venting sparks from the hub seams (intensify toward detonation)
                this.ventEmitter = this.vfx.addEmitter({
                    rate: (et) => 10 + et * 40, duration: 2.3,
                    spawn: (eng) => {
                        const a = rnd(0, Math.PI * 2);
                        const dir = [rnd(-0.3, 0.3), Math.cos(a), Math.sin(a)];
                        eng.spawn({
                            pos: [dir[0], dir[1] * 2.7, dir[2] * 2.7],
                            vel: [dir[0] * 6, dir[1] * rnd(5, 12), dir[2] * rnd(5, 12)],
                            life: rnd(0.3, 0.7), size: 0.05, color: [0.8, 2.2, 3.0, 1], colorEnd: [0.2, 0.6, 1.4, 0],
                            cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.08, drag: 0.8
                        });
                    }
                });
            }
            this.setPod(0, -1.2, -7.8 - lt * 1.3);
            this.podModel.setLocalEulerAngles(-90, 0, Math.sin(lt * 0.8) * 3);
            if (lt > 0.3) this.once('rcs1', () => this.rcsPuff([1, 0, 0], 0.8));
            if (lt > 0.42) this.once('rcs1b', () => this.rcsPuff([-1, 0, 0], 0.8));
            if (lt > 1.25) this.once('rcs2', () => this.rcsPuff([0, 1, 0], 0.7));

            // Reactor criticality: vents cyan -> white-hot, windows flicker red, station trembles
            const k = smooth(0, 2.2, lt);
            this.ventMat.emissive.set(lerp(0.2, 1.0, k), lerp(0.9, 0.95, k), lerp(1.0, 0.85, k));
            this.ventMat.emissiveIntensity = 1.8 + k * 6 + Math.sin(lt * 40) * k * 1.5;
            this.ventMat.update();
            const red = Math.sin(lt * 14) > 0;
            this.windowMat.emissive.set(1.0, red && lt > 0.6 ? 0.15 : 0.86, red && lt > 0.6 ? 0.1 : 0.62);
            this.windowMat.update();
            this.coreLight.light.intensity = k * 5;
            this.stationGroup.setLocalPosition(wob(lt * 30, 1) * k * 0.08, wob(lt * 28, 3) * k * 0.08, 0);
            if (lt > 1.2) this.once('alarm', () => A.playAlarmPulse());

            const n = Math.max(1, 3 - Math.floor(lt / 0.73));
            this.sub('PHASE 01 // POD SEPARATION & BLAST ALIGNMENT',
                `KESTREL-01 分離完了。後部プッシャープレートを反応炉へ指向 — トカマク臨界爆縮まで ${n}…`);
            this.tele.vel = 7.66; this.tele.g = 0.1; this.tele.temp = 22; this.tele.alt = 418.2;
        }

        // 2.2 – 5.4  Detonation; variants: det (nominal), detWeak, detCrush
        shotDetonation(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            const key = this.shots[this.shotIdx].key;
            const weak = key === 'detWeak';
            const crush = key === 'detCrush';
            const HIT = 0.25;
            const zh = -10.66 - Math.min(lt, HIT) * 1.3;

            if (enter) {
                this.detonateStation(weak ? 0.3 : 1.0);
                this.rig.cut([15, 4.5, -24], [0, -0.5, -5], 58);
                this.rig.to([15.5, 4.8, -25], null, 58, 1, 3);
                this.rig.minTrauma = 0;
            }
            this.animateBlast(dt);

            const u = Math.max(0, lt - HIT);
            let pz = zh, py = -1.2;
            if (lt >= HIT) {
                if (weak) { pz = zh - 2.2 * u; py = -1.2 - u * 0.1; }
                else if (crush) { pz = zh - 9 * (u - 0.3 * (1 - Math.exp(-u / 0.3))); py = -1.2 - u * 0.3; }
                else { pz = zh - 30 * (u - 0.3 * (1 - Math.exp(-u / 0.3))); py = -1.2 - u * 0.8; }
            }
            this.setPod(0, py, pz);
            const pod = this.podPos();

            if (lt >= HIT) {
                this.once('hit', () => {
                    A.playShockwaveImpact(!crush);
                    this.rig.shake(weak ? 0.25 : 1.05);
                    // Pusher-plate impact sparks
                    for (let i = 0; i < (weak ? 25 : 110); i++) {
                        const a = rnd(0, Math.PI * 2), sp = rnd(8, 30);
                        this.vfx.spawn({
                            pos: [pod.x, pod.y, pod.z + 1.6],
                            vel: [Math.cos(a) * sp, Math.sin(a) * sp, rnd(-4, 12)],
                            life: rnd(0.3, 0.9), size: 0.06, color: [4, 2.6, 1.2, 1], colorEnd: [1.4, 0.3, 0.05, 0],
                            cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.05, drag: 1.5
                        });
                    }
                    if (!weak) {
                        // Plasma wash streaming past the capsule
                        this.vfx.addEmitter({
                            rate: (et) => 240 * Math.max(0, 1 - et / 1.3), duration: 1.3,
                            spawn: (eng) => {
                                const p = this.podPos();
                                const a = rnd(0, Math.PI * 2), r = rnd(1.6, 4.2);
                                eng.spawn({
                                    pos: [p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, p.z + rnd(1, 4)],
                                    vel: [Math.cos(a) * 3, Math.sin(a) * 3, -rnd(42, 58)],
                                    life: rnd(0.25, 0.5), size: rnd(0.15, 0.4),
                                    color: [3, 1.5, 0.6, 0.9], colorEnd: [1.2, 0.25, 0.05, 0],
                                    cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.05
                                });
                            }
                        });
                    }
                    if (crush) {
                        A.playMetalCrunch && A.playMetalCrunch();
                        this.timeScale = 0.3;
                    }
                    // Cut to chase camera behind the pod looking back at the fireball
                    if (crush) this.rig.cut([pod.x + 5.8, pod.y + 1.6, pod.z - 5.4], [pod.x, pod.y, pod.z + 2.0], 56);
                    else this.rig.cut([pod.x + 3.6, pod.y + 1.4, pod.z - 7.0], [pod.x, pod.y, pod.z + 6], 62);
                });

                if (crush) {
                    // Capsule buckles under 44.8 G, then ruptures
                    const k = smooth(0.0, 0.35, u);
                    this.podModel.setLocalScale(1 + 0.18 * k, 1 - 0.4 * k, 1 + 0.18 * k);
                    this.podModel.setLocalEulerAngles(-90 + k * 18, k * 25, k * 12);
                    this.rig.to([pod.x + 5.8, pod.y + 1.6, pod.z - 5.4], [pod.x, pod.y, pod.z + 2.0], 54, 6, 8);
                    if (u > 0.08 && u < 0.6 && Math.random() < 0.6) {
                        for (let i = 0; i < 4; i++) {
                            const a = rnd(0, Math.PI * 2), sp = rnd(4, 14);
                            this.vfx.spawn({
                                pos: [pod.x + Math.cos(a) * 1.2, pod.y + Math.sin(a) * 1.2, pod.z + rnd(-0.8, 0.8)],
                                vel: [Math.cos(a) * sp, Math.sin(a) * sp, rnd(-3, 3)],
                                life: rnd(0.3, 0.7), size: 0.05, color: [3.5, 2.2, 1, 1], colorEnd: [1, 0.2, 0.02, 0],
                                cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.06, drag: 1
                            });
                        }
                    }
                    if (u > 0.62) {
                        this.once('podBurst', () => {
                            this.podModel.enabled = false;
                            V.Presets.explosion(this.vfx, [pod.x, pod.y, pod.z], 1.3, { fire: 90, sparks: 200, smoke: 30, debris: 70 });
                            this.doFlash(0.45, 4, [1, 0.8, 0.6]);
                            this.rig.shake(1.2);
                            A.playStationDetonation(true);
                            this.crushPoint = [pod.x, pod.y, pod.z];
                        });
                    }
                    if (u > 0.95) this.timeScale = Math.min(1, this.timeScale + dt * 3.5);
                } else if (weak) {
                    this.rig.to([pod.x + 5.5, pod.y + 1.6, pod.z - 6.5], [pod.x, pod.y, pod.z + 6], 58, 2, 3);
                } else {
                    // Chase, then sweep to a hero angle with the fireball behind
                    if (lt < 1.8) this.rig.to([pod.x + 3.6, pod.y + 1.4, pod.z - 7.0], [pod.x, pod.y, pod.z + 6], 64, 10, 10);
                    else this.rig.to([pod.x + 8.5, pod.y + 2.6, pod.z + 2.0], [pod.x, pod.y - 0.4, pod.z + 7], 52, 2.4, 3);
                }
            }

            // Station-side ambient fire for the first second
            if (lt < 1.4 && !weak) {
                for (let i = 0; i < 2; i++) {
                    const d = V.randDir([0, 0, 0]);
                    this.vfx.spawn({
                        pos: [d[0] * 3, d[1] * 3, d[2] * 3], vel: [d[0] * rnd(4, 10), d[1] * rnd(4, 10), d[2] * rnd(4, 10)],
                        life: rnd(0.8, 1.6), size: 2.5, sizeEnd: 7, color: [2.8, 1.6, 0.7, 1], colorEnd: [0.5, 0.1, 0.02, 0],
                        cell: V.CELL.FIRE, blend: 0, drag: 1.4, fadeOut: 0.4
                    });
                }
            }

            const hitG = weak ? 1.2 : (crush ? 44.8 : 26.4);
            this.tele.g = lt < HIT ? 0.3 : hitG * Math.exp(-u * 2.2) + (weak ? 0 : 1.2);
            this.tele.vel = 7.66 + (weak ? u * 0.05 : Math.min(3.2, u * 6) * (crush ? 0 : 1));
            this.tele.temp = 22 + (lt < HIT ? 0 : (weak ? 18 : 160 * Math.exp(-u)));
            if (weak) {
                this.sub('PHASE 02 // INSUFFICIENT REACTOR IMPULSE',
                    '【異常】起爆出力・触媒が不足 — 衝撃波が弱い！ 軌道離脱に必要な ΔV 3.20 km/s に届かない…');
            } else if (crush) {
                this.sub('CATASTROPHIC FAILURE // 44.8 G STRUCTURAL OVERLOAD',
                    lt < HIT + 0.6 ? '衝撃波直撃 — 油圧ダンパー底突き！ チタン船殻が座屈していく…！' : 'モノコック船体圧壊 — KESTREL-01、軌道上で爆散。');
            } else {
                this.sub('PHASE 02 // THERMONUCLEAR DETONATION & BLAST-SAIL',
                    lt < HIT ? 'HELIOS-9 臨界爆縮 ——！' : '指向性プラズマ衝撃波がプッシャープレートを直撃！ 26.4G で地球帰還軌道へ射出！');
            }
        }

        // 5.4 – 7.8  Coast toward Earth; RCS flip to heat-shield-forward attitude
        shotTransit(lt, dt, enter) {
            const skip = this.ending.id === 'ORBIT_SKIP_LOST';
            if (enter) {
                this.stationGroup.enabled = false;
                [this.fbCore, this.fbOuter, this.swRing, this.swRing2].forEach(e => { e.enabled = false; });
                this.blastLight.light.intensity = 0;
                this.vfx.clear();
                this.setSun([0.7, 0.45, -0.3]);
                this.earthSpin = 1.6;
                this.setPod(0, 0, 0);
                this.rig.cut([6.8, 2.6, 7.6], [0, -2.8, -6], 56);
                this.rig.to([5.0, 1.4, 9.4], [0, -3.2, -7], 54, 0.7, 1.2);
                this.rig.minTrauma = 0;
                this.flash = 0;
            }
            this.setPod(0, -lt * 0.2, -lt * 3);
            const pod = this.podPos();
            this.earthBelow(pod, 30 - lt * 1.5);

            const flipK = smooth(0.5, 2.0, lt);
            const target = skip ? 35 : 90;
            const x = -90 + flipK * (target + 90) + (skip ? Math.sin(lt * 3) * 8 * flipK : 0);
            this.podModel.setLocalEulerAngles(x, skip ? lt * 20 : 0, 0);
            if (lt > 0.5) this.once('flip1', () => { this.rcsPuff([0, 1, 0], 0.9); this.rcsPuff([0, -1, 0], 0.6); });
            if (lt > 1.85) this.once('flip2', () => this.rcsPuff([0, 0, 1], 0.8));

            this.tele.g = 0.0; this.tele.vel = 10.62; this.tele.temp = 48 - lt * 6; this.tele.alt = 412 - lt * 18;
            if (skip) {
                this.sub('ATTITUDE ERROR // NAV-GYRO OFFLINE',
                    '軌道計算ジャイロ未搭載 — 姿勢反転が不完全なまま、浅すぎる角度で大気圏上端へ接近していく…');
            } else if (this.ending.id === 'HYPOXIA_IN_ORBIT') {
                this.sub('PHASE 03 // TRANS-ATMOSPHERIC COAST (42 min)',
                    'RCS で再突入姿勢へ反転。大気圏到達まで 42 分 — 警告：ポッド酸素・推進剤残量が規定値未満。');
            } else {
                this.sub('PHASE 03 // RCS FLIP & RE-ENTRY ATTITUDE',
                    'RCS 噴射で 180° 姿勢反転 — ハニカム耐熱シールドを進行方向へ。進入角 −6.20° の回廊へ。');
            }
        }

        // Atmospheric re-entry (nominal / burn-up variant). Pod held at origin,
        // the planet scrolls beneath while plasma streams past.
        shotReentry(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            const burn = this.ending.id === 'ATMOS_BURNUP';
            const dur = burn ? 4.0 : 6.0;
            if (enter) {
                this.setPod(0, 0, 0);
                this.setSun([0.62, 0.42, -0.66]);
                this.earthSpin = 7.5;
                this.plasmaGroup.enabled = true;
                A.startReentryPlasmaSound();
                this.rig.cut([4.8, 1.3, -6.4], [0, 0, 0.6], 54);
                this.rig.to([4.0, 1.6, -7.0], [0, -0.2, 0.6], 52, 0.8, 2);
                // Plasma streaks off the heat-shield rim
                this.plasmaEmitter = this.vfx.addEmitter({
                    rate: () => 320 * (this.plasmaI || 0),
                    spawn: (eng) => {
                        const a = rnd(0, Math.PI * 2), r = rnd(0.9, 1.7);
                        const hot = this.plasmaI || 0;
                        eng.spawn({
                            pos: [Math.cos(a) * r, Math.sin(a) * r, -1.3],
                            vel: [Math.cos(a) * rnd(3, 10), Math.sin(a) * rnd(3, 10), rnd(45, 80)],
                            life: rnd(0.22, 0.5), size: rnd(0.1, 0.24),
                            color: [3.6, 2.4 + hot * 0.4, 1.3 + hot * 0.5, 1], colorEnd: [1.3, 0.25, 0.05, 0],
                            cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.045, fadeIn: 0
                        });
                    }
                });
                // Glowing ionised wake
                this.wakeEmitter = this.vfx.addEmitter({
                    rate: () => 70 * (this.plasmaI || 0),
                    spawn: (eng) => {
                        eng.spawn({
                            pos: [rnd(-0.9, 0.9), rnd(-0.9, 0.9), rnd(0.5, 2.5)],
                            vel: [rnd(-1, 1), rnd(-1, 1), rnd(26, 40)],
                            life: rnd(0.6, 1.0), size: 1.4, sizeEnd: rnd(4, 6),
                            color: [1.8, 0.6, 0.18, 0.4], colorEnd: [0.6, 0.1, 0.02, 0],
                            cell: V.CELL.GLOW, blend: 0, fadeIn: 0.05, fadeOut: 0.3
                        });
                    }
                });
                // Shedding ablator embers
                this.emberEmitter = this.vfx.addEmitter({
                    rate: () => 30 * (this.plasmaI || 0) * (burn ? 2.5 : 1),
                    spawn: (eng) => {
                        const a = rnd(0, Math.PI * 2);
                        eng.spawn({
                            pos: [Math.cos(a) * 1.4, Math.sin(a) * 1.4, -0.6],
                            vel: [Math.cos(a) * rnd(2, 6), Math.sin(a) * rnd(2, 6), rnd(15, 30)],
                            life: rnd(0.6, 1.4), size: rnd(0.08, 0.16),
                            color: [3, 1.4, 0.4, 1], colorEnd: [0.8, 0.12, 0.02, 0],
                            cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.03, drag: 0.4
                        });
                    }
                });
            }

            const I = burn
                ? smooth(0.1, 1.2, lt) * (1 + lt * 0.22)
                : smooth(0.2, 1.6, lt) * (1 - 0.6 * smooth(4.4, 5.9, lt));
            this.plasmaI = I;
            const pod = this.podPos();
            this.earthBelow(pod, lerp(26, burn ? 12 : 9, smooth(0, dur, lt)), [0.15, 1, 0.45]);

            this.podModel.setLocalEulerAngles(90 + wob(lt * 6, 1) * 3 * I, lt * 28, wob(lt * 5, 2) * 2.5 * I);
            this.bowCapMat.setParameter('uIntensity', (0.95 + I * 0.85 + Math.sin(lt * 37) * 0.15) * Math.min(1, I * 1.2));
            this.shellMat.setParameter('uIntensity', 1.15 * Math.min(1, I));
            this.bowCap.setLocalScale(3.1 + I * 0.25 + Math.sin(lt * 23) * 0.05, 3.1 + I * 0.25 + Math.cos(lt * 19) * 0.05, 0.95 + I * 0.15);
            this.setHeat(burn ? Math.min(1, I * 0.7) : I * 0.75, burn ? smooth(1.5, 4, lt) * 0.9 : I * 0.22);

            if (lt < 2.6) this.rig.to([4.0 + lt * 0.2, 1.6, -7.0 + lt * 0.4], [0, -0.2, 0.6], 52, 0.8, 2);
            else this.rig.to([3.0, 2.6, 8.2], [0, -1.6, -5], 56, 1.1, 1.6);
            this.rig.minTrauma = 0.22 + 0.4 * Math.min(1, I);
            if (this.postFx) {
                this.postFx.heatHaze = Math.min(1, 0.9 * I);
                this.postFx.temperature = Math.min(0.8, 0.55 * I);
                this.postFx.exposure = 1 + 0.08 * I;
            }

            this.tele.alt = lerp(120, burn ? 70 : 34, lt / dur);
            this.tele.vel = lerp(10.8, burn ? 8.6 : 4.2, lt / dur);
            this.tele.g = 2 + 6.4 * I + wob(lt * 9, 3) * 0.6;
            this.tele.temp = burn ? 600 + lt * 680 : 300 + 2880 * smooth(0.2, 3.2, lt) * (1 - 0.3 * smooth(4.5, 6, lt));

            if (!burn && lt > dur - 0.45) this.shotFade = smooth(dur - 0.45, dur - 0.02, lt);
            if (burn) {
                this.sub('HYPERSONIC RE-ENTRY // THERMAL PROTECTION FAILURE',
                    lt < 2 ? '【警告】耐熱シールド未装着 / 進入角過大 — 熱流束 1,420 W/cm²、船殻温度が急上昇！'
                        : '船殻温度 3,000℃ 突破 — チタン外板が白熱・融解を開始…！');
            } else if (lt > 2.2 && lt < 4.2) {
                this.sub('PLASMA BLACKOUT // 通信途絶', '電離プラズマ・ブラックアウト — 地上との交信途絶。3,180℃ の衝撃層を耐熱シールドが受け止める。');
            } else {
                this.sub('PHASE 04 // HYPERSONIC ATMOSPHERIC RE-ENTRY (γ −6.20°)',
                    lt < 2.2 ? '高度 120 km、マッハ 24 で大気圏突入 — 断熱圧縮で衝撃層が発光を始める。' : 'ブラックアウト明け — 減速 8.4G、高度 40 km を通過。');
            }
        }

        // Descent above the cloud deck (chutes / freefall / shred)
        shotHigh(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            const id = this.ending.id;
            const noChute = id === 'GROUND_CRASH';
            const shred = id === 'SUPERSONIC_CHUTE_SHRED';
            if (enter) {
                this.enterSurface(id === 'EARTH_RETURN_SUCCESS' ? 'sunrise' : (shred ? 'overcast' : 'day'));
                this.vfx.clear();
                this.podY = 255;
                this.podV = 38;
                this.setPod(0, this.podY, 0);
                this.chuteGroup.enabled = !noChute;
                [this.drogue, ...this.mains].forEach(c => {
                    c.open = 0; c.released = false; c.flatten = 0;
                    c.e.enabled = false;
                    c.risers.forEach(r => { r.enabled = false; });
                });
                this.spawnCloudBank(150, 46, 230);
                A.startWindRush && A.startWindRush();
                const p = this.podPos();
                this.rig.cut([p.x + 11, p.y + 1.5, p.z + 14], [p.x, p.y + 2, p.z], 58);
                this.rig.minTrauma = 0.05;
                this.shotFade = 1;
                if (noChute) {
                    this.vfx.addEmitter({
                        rate: 70,
                        spawn: (eng) => {
                            const pp = this.podPos();
                            const fire = Math.random() < 0.35;
                            eng.spawn({
                                pos: [pp.x + rnd(-0.5, 0.5), pp.y + rnd(0, 1), pp.z + rnd(-0.5, 0.5)],
                                vel: [rnd(-1, 1), rnd(4, 8), rnd(-1, 1)],
                                life: fire ? rnd(0.3, 0.6) : rnd(1.6, 2.6), size: fire ? 0.6 : 0.9, sizeEnd: fire ? 1.4 : rnd(3.5, 5),
                                color: fire ? [2.6, 1.3, 0.4, 1] : [0.2, 0.19, 0.18, 0.75], colorEnd: fire ? [0.5, 0.1, 0.02, 0] : [0.3, 0.29, 0.28, 0],
                                cell: fire ? V.CELL.FIRE : V.CELL.SMOKE, blend: fire ? 0 : 1, drag: 1.2, fadeOut: 0.4
                            });
                        }
                    });
                }
            }
            this.shotFade = Math.max(0, 1 - lt / 0.5);

            // Vertical dynamics
            let targetV;
            if (noChute) targetV = 40 + lt * 6;
            else if (shred) targetV = lt < 0.85 ? 22 : 30 + (lt - 0.85) * 10;
            else targetV = lt < 0.35 ? 38 : (lt < 1.5 ? 16 : 6);
            this.podV = lerp(this.podV, targetV, 1 - Math.exp(-(noChute ? 2 : 3.2) * dt));
            this.podY -= this.podV * dt;
            this.setPod(Math.sin(lt * 0.7) * 0.4, this.podY, 0);
            const pod = this.podPos();

            if (noChute) {
                this.podModel.rotateLocal(dt * 160, dt * 90, dt * 70);
            } else {
                this.podModel.setLocalEulerAngles(Math.sin(lt * 1.3) * 5, lt * 6, Math.cos(lt * 1.1) * 4);
                if (lt > 0.35 || (shred && lt > 0.45)) this.once('drogue', () => { A.playParachuteDeploy(); this.rig.shake(0.3); });
                if (lt > 0.35) this.drogue.open = Math.min(1, this.drogue.open + dt * 2.2);
                const mainT = shred ? 0.45 : 1.5;
                if (lt > mainT) {
                    this.once('mains', () => {
                        A.playParachuteDeploy();
                        this.rig.shake(0.45);
                        this.drogue.released = true;
                        this.drogue.relVel.set(2, 14, -1);
                    });
                    this.mains.forEach(m => { m.open = Math.min(1, m.open + dt * (shred ? 3.5 : 1.5)); });
                }
                if (shred && lt > 0.85) {
                    this.once('shred', () => {
                        A.playMetalCrunch && A.playMetalCrunch();
                        A.playParachuteDeploy();
                        this.rig.shake(0.8);
                        this.doFlash(0.15, 6, [1, 1, 1]);
                        this.mains.forEach(m => {
                            const cp = m.e.getPosition();
                            for (let i = 0; i < 26; i++) {
                                const orange = Math.random() < 0.55;
                                this.vfx.spawn({
                                    pos: [cp.x + rnd(-3, 3), cp.y + rnd(-1, 2), cp.z + rnd(-3, 3)],
                                    vel: [rnd(-7, 7), rnd(2, 16), rnd(-7, 7)],
                                    life: rnd(3, 4.5), size: rnd(0.4, 1.1), aspect: rnd(0.6, 1.6),
                                    color: orange ? [1.0, 0.42, 0.1, 1] : [0.95, 0.93, 0.88, 1],
                                    colorEnd: orange ? [0.9, 0.38, 0.1, 0.9] : [0.9, 0.88, 0.84, 0.9],
                                    cell: V.CELL.CLOTH, blend: 1, gravity: -3, drag: 1.6, rotVel: rnd(-9, 9), fadeIn: 0, fadeOut: 0.8
                                });
                            }
                            m.open = 0;
                        });
                        this.drogue.open = 0;
                    });
                }
                this.updateChutes(this.time, dt);
            }

            // Camera
            if (noChute) {
                this.rig.to([pod.x + 14, pod.y + 7, pod.z + 16], [pod.x, pod.y - 2, pod.z], 60, 2.6, 6);
            } else {
                const ang = 0.72 + lt * 0.09;
                const lookUp = this.mains[0].open > 0.2 ? 6 : 2;
                this.rig.to([pod.x + Math.sin(ang) * 17, pod.y + 1.5 - lt * 0.4, pod.z + Math.cos(ang) * 17], [pod.x, pod.y + lookUp, pod.z], 58, 3, 4);
            }
            if (A.setWindLevel) A.setWindLevel(Math.min(1, this.podV / 40));

            this.tele.alt = Math.max(1, this.podY / 255 * 15.2);
            this.tele.vel = this.podV / 1000 * 8;
            this.tele.g = noChute ? 1.0 : (this.flags.mains ? 2.4 + Math.exp(-(lt - 1.5) * 3) * 2 : 1.6);
            this.tele.temp = 210 - lt * 18;
            if (noChute) {
                this.sub('CRITICAL // DECELERATION SYSTEM ABSENT',
                    '【致命的】パラシュート＆逆噴射モジュール未搭載 — 減速手段なし、時速 880 km で落下中！');
            } else if (shred) {
                this.sub('SUPERSONIC DEPLOYMENT // CANOPY FAILURE',
                    lt < 0.85 ? '高度 19.5 km 以上・マッハ 4.5 で強制開傘 ——' : '超音速の動圧でキャノピーが引き裂かれた！ 減速手段を喪失 — 自由落下！');
            } else {
                this.sub('PHASE 05 // DROGUE & MAIN PARACHUTE DEPLOYMENT',
                    lt < 1.5 ? '高度 15 km — ドローグシュート開傘。朝焼けの雲海の上へ。' : '高度 4.2 km — メインパラシュート 3 基、正常開傘！');
            }
        }

        // Final approach below the clouds: splashdown / crash variants
        shotLow(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            const P = V.Presets;
            const id = this.ending.id;
            const S = this.surface;
            const island = S.islands[0];
            const islandTop = island.topY || 20;

            if (enter) {
                this.shotFade = 0;
                this.rig.minTrauma = 0.02;
                if (id === 'EARTH_RETURN_SUCCESS') {
                    this.setPod(0, 70, 0);
                    this.mains.forEach(m => { m.open = 1; });
                    this.rig.cut([15, 2.6, 21], [0, 34, 0], 50);
                } else if (id === 'RETRO_TIMING_CRASH') {
                    this.podY = 72; this.podV = 10;
                    this.setPod(0, 72, 0);
                    this.mains.forEach(m => { m.open = 1; });
                    this.rig.cut([24, 5, 30], [0, 40, 0], 52);
                } else if (id === 'GROUND_CRASH') {
                    this.crashFrom = new pc.Vec3(island.x + 42, islandTop + 120, island.z + 32);
                    this.crashTo = new pc.Vec3(island.x, islandTop - 0.5, island.z);
                    this.setPod(this.crashFrom.x, this.crashFrom.y, this.crashFrom.z);
                    this.rig.cut([island.x + 75, islandTop + 16, island.z + 82], [this.crashFrom.x, this.crashFrom.y, this.crashFrom.z], 50);
                } else {
                    this.podY = 130; this.podV = 50;
                    this.setPod(0, 130, 0);
                    this.rig.cut([38, 6, 46], [0, 60, 0], 52);
                }
            }

            const pod = this.podPos();
            const time = this.time;

            if (id === 'EARTH_RETURN_SUCCESS') {
                const TOUCH = 4.2;
                const u = clamp01(lt / TOUCH);
                if (lt < TOUCH) {
                    this.setPod(0, 70 * Math.pow(1 - u, 1.35) + 0.4, 0);
                    this.podModel.setLocalEulerAngles(Math.sin(lt * 1.4) * 4, lt * 5, Math.cos(lt * 1.2) * 3);
                    this.rig.to([15 - lt * 0.6, 2.6, 21 - lt * 0.8], [pod.x, pod.y + 3, pod.z], 50, 1, 3);
                } else {
                    const wh = S.waveHeight(0, 0, time);
                    this.setPod(0, wh + 0.35, 0);
                    this.podModel.setLocalEulerAngles(Math.sin(time * 1.3) * 5, 21 + (lt - TOUCH) * 3, Math.cos(time * 1.1) * 5);
                    this.rig.to([11, 2.2, 15], [0, 1.4, 0], 52, 1.2, 2);
                }
                // Retro-rocket cushion burn at 26 m
                const retroOn = lt > 3.45 && lt < TOUCH + 0.05;
                this.retroGroup.enabled = retroOn;
                if (retroOn) {
                    this.once('retro', () => { A.playRetroBurn && A.playRetroBurn(); this.rig.shake(0.25); });
                    const flick = 0.85 + Math.random() * 0.3;
                    this.retroPlumes.forEach(pl => pl.setLocalScale(0.45 * flick, 2.2 * flick, 0.45 * flick));
                    for (let i = 0; i < 6; i++) {
                        const a = (Math.floor(rnd(0, 4)) * Math.PI) / 2;
                        this.vfx.spawn({
                            pos: [pod.x + Math.cos(a) * 1.28, pod.y - 2.2, pod.z + Math.sin(a) * 1.28],
                            vel: [rnd(-2, 2), -rnd(16, 26), rnd(-2, 2)],
                            life: rnd(0.2, 0.4), size: 0.5, sizeEnd: 1.4,
                            color: [3, 2, 1, 1], colorEnd: [1, 0.3, 0.05, 0], cell: V.CELL.FIRE, blend: 0, drag: 2
                        });
                    }
                    if (pod.y < 9) {
                        for (let i = 0; i < 8; i++) {
                            const a = rnd(0, Math.PI * 2), sp = rnd(9, 18);
                            this.vfx.spawn({
                                pos: [pod.x + Math.cos(a) * 2, 0.3, pod.z + Math.sin(a) * 2],
                                vel: [Math.cos(a) * sp, rnd(1.5, 4), Math.sin(a) * sp],
                                life: rnd(0.8, 1.4), size: 0.6, sizeEnd: rnd(2.5, 4),
                                color: [0.95, 0.97, 1, 0.7], colorEnd: [0.9, 0.94, 0.98, 0],
                                cell: V.CELL.SPRAY, blend: 1, drag: 1.6, gravity: -4, fadeOut: 0.4
                            });
                        }
                    }
                }
                if (lt >= TOUCH) {
                    this.once('splash', () => {
                        P.splash(this.vfx, [0, 0, 0], 0.8);
                        A.playSplashdown();
                        this.rig.shake(0.35);
                        this.mains.forEach((m, i) => { m.released = true; m.relVel.set(3 + i, 1.5, rnd(-1, 1)); });
                    });
                }
                this.updateChutes(time, dt);
                this.tele.alt = Math.max(0, pod.y * 0.06);
                this.tele.vel = lt < TOUCH ? 0.0064 + (1 - u) * 0.004 : 0;
                this.tele.g = retroOn ? 3.2 : (lt >= TOUCH && lt < TOUCH + 0.6 ? 4.2 : 1.0);
                this.tele.temp = 64;
                this.sub(lt < TOUCH ? 'PHASE 06 // TERMINAL DESCENT & RETRO CUSHION' : 'SPLASHDOWN CONFIRMED',
                    lt < 3.45 ? '降下率 7 m/s — 着水点、太平洋上の回収海域に一致。'
                        : (lt < TOUCH ? '高度 26 m — 固体逆噴射ロケット点火！' : '着水 —— 秒速 6.4 m。KESTREL-01、地球へ帰還！'));
                if (A.setWindLevel) A.setWindLevel(lt < TOUCH ? 0.35 : 0.1);
                return;
            }

            if (id === 'RETRO_TIMING_CRASH') {
                const impacted = !!this.flags.impact;
                if (!impacted) {
                    const target = lt < 1.2 ? 10 : 26;
                    this.podV = lerp(this.podV, target, 1 - Math.exp(-1.5 * dt));
                    this.podY -= this.podV * dt;
                    this.setPod(0, this.podY, 0);
                    this.podModel.setLocalEulerAngles(Math.sin(lt * 2) * 6, lt * 9, Math.cos(lt * 1.7) * 5);
                    // Collapsing canopies after the wasted burn
                    if (lt > 1.2) this.mains.forEach((m, i) => { m.open = Math.max(0.45, m.open - dt * 0.25 * (i + 1)); });
                    this.rig.to([24, 5, 30], [pod.x, pod.y + 3, pod.z], 52, 1, 3);
                }
                const retroOn = lt > 0.45 && lt < 1.15;
                this.retroGroup.enabled = retroOn;
                if (retroOn) {
                    this.once('retroEarly', () => { A.playRetroBurn && A.playRetroBurn(); this.rig.shake(0.3); });
                    for (let i = 0; i < 8; i++) {
                        const a = (Math.floor(rnd(0, 4)) * Math.PI) / 2;
                        this.vfx.spawn({
                            pos: [pod.x + Math.cos(a) * 1.28, pod.y - 2.2, pod.z + Math.sin(a) * 1.28],
                            vel: [rnd(-3, 3), -rnd(14, 24), rnd(-3, 3)],
                            life: rnd(0.3, 0.6), size: 0.6, sizeEnd: 2,
                            color: [3, 2, 1, 1], colorEnd: [1, 0.3, 0.05, 0], cell: V.CELL.FIRE, blend: 0, drag: 1.5
                        });
                        this.vfx.spawn({
                            pos: [pod.x + rnd(-1, 1), pod.y - 3.5, pod.z + rnd(-1, 1)],
                            vel: [rnd(-2, 2), -rnd(4, 9), rnd(-2, 2)],
                            life: rnd(2, 3.5), size: 1.2, sizeEnd: rnd(5, 8),
                            color: [0.72, 0.7, 0.68, 0.55], colorEnd: [0.75, 0.74, 0.72, 0], cell: V.CELL.SMOKE, blend: 1, drag: 1.2
                        });
                    }
                }
                if (!impacted && this.podY <= 0.4) {
                    this.once('impact', () => {
                        P.splash(this.vfx, [0, 0, 0], 1.5, { count: 200 });
                        P.explosion(this.vfx, [0, 0.5, 0], 0.7, { fire: 40, sparks: 80, smoke: 25, debris: 30, gravity: -9.8 });
                        A.playSplashdown(); A.playMetalCrunch && A.playMetalCrunch();
                        this.doFlash(0.3, 5, [1, 0.85, 0.7]);
                        this.rig.shake(1.0);
                        this.impactLt = lt;
                        this.mains.forEach((m, i) => { m.released = true; m.relVel.set(2 + i, 0, rnd(-1, 1)); });
                        this.wreckSmoke();
                    });
                }
                if (this.flags.impact) {
                    const wh = S.waveHeight(0, 0, time);
                    this.setPod(0, wh - 0.9, 0);
                    this.podModel.setLocalEulerAngles(62 + Math.sin(time) * 3, 40, 18);
                    this.rig.to([19, 3.5, 24], [0, 1, 0], 50, 0.5, 1.5);
                }
                this.updateChutes(time, dt);
                this.tele.alt = Math.max(0, pod.y * 0.06);
                this.tele.vel = this.flags.impact ? 0 : this.podV / 1000;
                this.tele.g = this.flags.impact ? (lt - (this.impactLt || 0) < 0.6 ? 18.0 : 0) : (retroOn ? 3.0 : 1.4);
                this.tele.temp = this.flags.impact ? 340 : 70;
                this.sub(this.flags.impact ? 'HARD IMPACT // HULL BREACH' : 'RETRO IGNITION ALTITUDE ERROR',
                    this.flags.impact ? '18G の着水衝撃で船底が圧壊・浸水 — 逆噴射のタイミングが致命的に早すぎた。'
                        : (lt < 1.2 ? '【点火高度エラー】高度 60 m 以上で逆噴射ロケットが燃焼 — 推力を空費！' : '逆噴射燃焼終了 — 減速を失ったまま海面が迫る…！'));
                return;
            }

            if (id === 'GROUND_CRASH') {
                const IMPACT = 2.1;
                if (lt < IMPACT) {
                    const k = Math.pow(lt / IMPACT, 1.35);
                    this.setPod(lerp(this.crashFrom.x, this.crashTo.x, k), lerp(this.crashFrom.y, this.crashTo.y, k), lerp(this.crashFrom.z, this.crashTo.z, k));
                    this.podModel.rotateLocal(dt * 190, dt * 110, dt * 60);
                    this.rig.to(null, [pod.x, pod.y, pod.z], 48, 1, 5);
                } else {
                    this.once('crash', () => {
                        const c = [this.crashTo.x, this.crashTo.y + 1, this.crashTo.z];
                        this.podModel.enabled = false;
                        this.vfx.emitters.length = 0;
                        P.explosion(this.vfx, c, 3.0, { fire: 180, sparks: 300, smoke: 60, debris: 120, gravity: -12, smokeRise: 3 });
                        P.shockRing(this.vfx, [c[0], c[1] - 0.5, c[2]], { flat: true, size: 3, sizeEnd: 90, life: 1.6, color: [2.2, 1.6, 1.0, 0.9], colorEnd: [0.8, 0.5, 0.3, 0] });
                        this.doFlash(0.65, 3.2, [1, 0.78, 0.5]);
                        this.rig.shake(1.25);
                        A.playStationDetonation(true);
                        A.playMetalCrunch && A.playMetalCrunch();
                        this.smokeColumn(c, 1.6);
                    });
                    this.rig.to([island.x + 58, islandTop + 13, island.z + 62], [island.x, islandTop + 10, island.z], 50, 0.35, 1.2);
                }
                this.tele.alt = lt < IMPACT ? Math.max(0, (pod.y - islandTop) * 0.05) : 0;
                this.tele.vel = lt < IMPACT ? 0.244 : 0;
                this.tele.g = lt < IMPACT ? 1 : (lt < IMPACT + 0.5 ? 98.4 : 0);
                this.tele.temp = lt < IMPACT ? 240 : 2400;
                this.sub(lt < IMPACT ? 'TERMINAL VELOCITY // 880 km/h' : 'SIGNAL LOST // SURFACE IMPACT',
                    lt < IMPACT ? '雲海を突き抜けた — 減速できないまま、火山島の稜線が迫る…！'
                        : '地表激突、大爆発 —— 巨大な火柱と黒煙が島の空を覆う。帰還ミッション失敗。');
                return;
            }

            // SUPERSONIC_CHUTE_SHRED: freefall into the ocean
            if (!this.flags.oceanImpact) {
                this.podV = lerp(this.podV, 58, 1 - Math.exp(-1.2 * dt));
                this.podY -= this.podV * dt;
                this.setPod(0, Math.max(0, this.podY), 0);
                this.podModel.rotateLocal(dt * 120, dt * 80, dt * 50);
                this.rig.to([38, 6, 46], [pod.x, pod.y, pod.z], 50, 1, 5);
                if (this.podY <= 0) {
                    this.once('oceanImpact', () => {
                        this.podModel.enabled = false;
                        P.splash(this.vfx, [0, 0, 0], 2.4, { count: 260 });
                        P.explosion(this.vfx, [0, 1, 0], 1.2, { fire: 60, sparks: 140, smoke: 30, debris: 60, gravity: -9.8 });
                        this.doFlash(0.4, 4, [1, 0.9, 0.8]);
                        this.rig.shake(1.1);
                        A.playSplashdown(); A.playStationDetonation(true);
                        this.wreckSmoke();
                        this.impactLt = lt;
                    });
                }
            } else {
                this.rig.to([30, 4.5, 36], [0, 3, 0], 50, 0.4, 1.2);
            }
            this.tele.alt = Math.max(0, pod.y * 0.06);
            this.tele.vel = this.flags.oceanImpact ? 0 : this.podV / 1000 * 4;
            this.tele.g = this.flags.oceanImpact ? (lt - (this.impactLt || 0) < 0.5 ? 64 : 0) : 1;
            this.tele.temp = 150;
            this.sub(this.flags.oceanImpact ? 'SIGNAL LOST // OCEAN IMPACT' : 'FREEFALL // NO DECELERATION',
                this.flags.oceanImpact ? '海面へ激突し爆散 —— 巨大な水柱と爆炎。KESTREL-01 からの信号が途絶。'
                    : '引き裂かれたキャノピーを残し、ポッドは灰色の海面へ一直線に落ちていく…！');
        }

        wreckSmoke() {
            const V = window.OrbitalGame.VFX;
            this.vfx.addEmitter({
                rate: 20,
                spawn: (eng) => {
                    eng.spawn({
                        pos: [rnd(-1, 1), 0.6, rnd(-1, 1)],
                        vel: [rnd(-0.5, 0.5) + 1.2, rnd(3, 6), rnd(-0.5, 0.5)],
                        life: rnd(4, 6), size: 1.2, sizeEnd: rnd(6, 9),
                        color: [0.16, 0.15, 0.15, 0.7], colorEnd: [0.35, 0.35, 0.36, 0],
                        cell: Math.random() < 0.5 ? V.CELL.SMOKE : V.CELL.SMOKE2, blend: 1, drag: 0.6, rotVel: rnd(-0.3, 0.3), fadeOut: 0.5
                    });
                    if (Math.random() < 0.35) {
                        eng.spawn({
                            pos: [rnd(-1.2, 1.2), 0.3, rnd(-1.2, 1.2)], vel: [0, rnd(1, 3), 0],
                            life: rnd(0.4, 0.8), size: 0.6, sizeEnd: 1.6,
                            color: [2.4, 1.2, 0.4, 1], colorEnd: [0.5, 0.1, 0.02, 0], cell: V.CELL.FIRE, blend: 0
                        });
                    }
                }
            });
        }

        smokeColumn(c, scale) {
            const V = window.OrbitalGame.VFX;
            this.vfx.addEmitter({
                rate: 34,
                spawn: (eng, et) => {
                    eng.spawn({
                        pos: [c[0] + rnd(-2, 2) * scale, c[1] + rnd(0, 2), c[2] + rnd(-2, 2) * scale],
                        vel: [rnd(-1, 1) + 2.2, rnd(6, 11), rnd(-1, 1)],
                        life: rnd(6, 9), size: 2.5 * scale, sizeEnd: rnd(12, 18) * scale,
                        color: [0.13, 0.12, 0.12, 0.85], colorEnd: [0.32, 0.31, 0.32, 0],
                        cell: Math.random() < 0.5 ? V.CELL.SMOKE : V.CELL.SMOKE2, blend: 1, drag: 0.35, rotVel: rnd(-0.25, 0.25), fadeOut: 0.55
                    });
                    if (et < 4 && Math.random() < 0.6) {
                        eng.spawn({
                            pos: [c[0] + rnd(-3, 3), c[1] + rnd(0, 1.5), c[2] + rnd(-3, 3)], vel: [rnd(-1, 1), rnd(3, 7), rnd(-1, 1)],
                            life: rnd(0.6, 1.2), size: 1.6 * scale, sizeEnd: 4 * scale,
                            color: [2.8, 1.4, 0.45, 1], colorEnd: [0.6, 0.12, 0.02, 0], cell: V.CELL.FIRE, blend: 0, drag: 0.8
                        });
                    }
                }
            });
        }

        // Success aftermath: floating capsule, flotation collar, beacon, sea dye
        shotAfter(lt, dt, enter) {
            const S = this.surface;
            if (enter) {
                this.floatBags.forEach(b => { b.enabled = true; });
                this.beacon.enabled = true;
                this.rig.to(null, null, 48, 0.8, 1.5);
            }
            const time = this.time;
            const wh = S.waveHeight(0, 0, time);
            this.setPod(0, wh + 0.4, 0);
            this.podModel.setLocalEulerAngles(Math.sin(time * 1.3) * 5, 21 + lt * 2, Math.cos(time * 1.1) * 5);
            this.floatBags.forEach((b, i) => {
                const k = easeOutBack(clamp01((lt - i * 0.18) / 0.9)) * 0.62;
                b.setLocalScale(k, k, k);
            });
            const strobe = (time % 1.1) < 0.09;
            this.beacon.enabled = strobe;
            this.beaconLight.light.intensity = strobe ? 6 : 0;
            S.setDye(0.6, 0.3, 2 + lt * 3.2, Math.min(0.9, lt * 0.6));
            const ang = 0.9 + lt * 0.16;
            this.rig.to([Math.sin(ang) * 12.5, 2.3 + Math.sin(lt * 0.5) * 0.3, Math.cos(ang) * 12.5], [0, 1.2, 0], 48, 1.2, 2);
            this.updateChutes(time, dt);
            this.tele.alt = 0; this.tele.vel = 0; this.tele.g = 1.0; this.tele.temp = 31;
            this.sub('MISSION ACCOMPLISHED // WELCOME HOME',
                lt < 2.4 ? '浮揚バッグ展開、回収ビーコン発信。蛍光シーマーカーが朝焼けの海に広がる。'
                    : '回収艦が針路を変えた —— 爆縮反動推進による地球完全生還、達成。');
        }

        // Weak blast: eternal drift in orbit
        shotDrift(lt, dt, enter) {
            const V = window.OrbitalGame.VFX;
            if (enter) {
                this.stationGroup.enabled = true;
                [this.fbCore, this.fbOuter, this.swRing, this.swRing2].forEach(e => { e.enabled = false; });
                this.blastLight.light.intensity = 0;
                this.vfx.clear();
                this.setPod(0, 0, 0);
                this.setSun([0.7, 0.4, -0.35]);
                this.earthSpin = 0.6;
                const pod = this.podPos();
                this.driftStart = pod.clone();
                this.rig.cut([pod.x + 4.6, pod.y + 1.3, pod.z + 6.2], [pod.x, pod.y, pod.z], 54);
                this.rig.minTrauma = 0;
                for (let i = 0; i < 40; i++) {
                    const d = V.randDir([0, 0, 0]);
                    const r = rnd(6, 30);
                    this.vfx.spawn({
                        pos: [pod.x + d[0] * r, pod.y + d[1] * r * 0.5, pod.z + d[2] * r],
                        vel: [rnd(-0.6, 0.6), rnd(-0.3, 0.3), rnd(-0.6, 0.6)],
                        life: 30, size: rnd(0.12, 0.5), color: [0.6, 0.58, 0.55, 1], colorEnd: [0.6, 0.58, 0.55, 1],
                        cell: V.CELL.DEBRIS, blend: 1, rotVel: rnd(-1.5, 1.5), fadeIn: 0.01, fadeOut: 0.98
                    });
                }
            }
            this.stationGroup.setLocalPosition(0, 4, 26 + lt * 0.5);
            this.setPod(0, -lt * 0.05, -lt * 0.5);
            const pod = this.podPos();
            this.earthBelow(pod, 44);
            this.podModel.rotateLocal(dt * 9, dt * 15, dt * 6);
            [[0.8, [1, 0, 0], 0.7], [1.4, [0, -1, 0], 0.6], [2.6, [-1, 0, 0], 0.4], [4.0, [0, 1, 0], 0.18]].forEach(([at, d, s], i) => {
                if (lt > at) this.once('sput' + i, () => this.rcsPuff(d, s));
            });
            const dist = 6.5 + lt * 6.2;
            this.rig.to([pod.x + dist * 0.6, pod.y + 1.3 + lt * 2.0, pod.z + dist * 0.8], [pod.x, pod.y - lt * 1.3, pod.z], 54 - lt * 1.2, 0.6, 1.5);
            this.tele.vel = 7.38; this.tele.g = 0; this.tele.temp = Math.max(-140, 18 - lt * 16); this.tele.alt = 412.4;
            this.sub('ORBITAL DECAY FAILURE // ETERNAL DRIFT',
                lt < 2.8 ? 'RCS 推進剤で軌道修正を試みる — 噴射が途切れがちに…' :
                    (lt < 5.6 ? 'ΔV 不足 — 地球の重力井戸へ降りていけない。' : '高度 412 km の楕円軌道。眼下の青い惑星へ、二度と降りられない。'));
        }

        // Life support exhausted during the 42-minute transfer
        shotHypoxia(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            if (enter) {
                this.nextBeat = 0;
                this.beatI = 0.85;
                this.hypBase = this.podPos().clone();
            }
            const pod = this.podPos();
            if (lt < 1.8) {
                this.setPod(this.hypBase.x, this.hypBase.y - lt * 0.1, this.hypBase.z - lt * 1.5);
                this.earthBelow(this.podPos(), 26);
                this.rig.to([pod.x + 4.6, pod.y + 1.6, pod.z + 6.8], [pod.x, pod.y - 2, pod.z - 6], 54, 1, 1.5);
            } else {
                this.once('pov', () => {
                    this.podModel.enabled = false;
                    this.showPodWindow(true, 0);
                    const p = this.podPos();
                    this.rig.cut([p.x, p.y + 0.4, p.z], [p.x - 3, p.y - 5.5, p.z - 10], 62);
                });
                const p = this.podPos();
                const k = (lt - 1.8);
                this.earthBelow(p, 24 - k * 0.6);
                this.rig.to([p.x, p.y + 0.4, p.z], [p.x - 3 + wob(k * 0.3, 1) * 1.5, p.y - 5.5 + wob(k * 0.25, 4), p.z - 10], 62 - k * 1.2, 1, 0.6);
                this.rig.tRoll = wob(k * 0.2, 2) * 6;
                this.showPodWindow(true, smooth(0, 6, k));
            }
            const hyp = smooth(1.6, 7.6, lt);
            if (this.postFx) {
                this.postFx.hypoxiaFactor = hyp;
                this.postFx.saturation = 1.06 - hyp * 0.6;
                this.postFx.temperature = -hyp * 0.45;
            }
            if (lt >= this.nextBeat) {
                A.playHeartbeat && A.playHeartbeat(1 - hyp * 0.6);
                this.beatI = lerp(0.85, 1.9, hyp);
                this.nextBeat = lt + this.beatI;
            }
            this.tele.vel = 10.6; this.tele.g = 0; this.tele.temp = Math.max(-60, 18 - lt * 9); this.tele.alt = 380 - lt * 9;
            this.sub('LIFE SUPPORT CRITICAL // HYPOXIA IN TRANSIT',
                lt < 2.5 ? 'ポッド O₂ 残量 0% — 推進剤も尽き、姿勢制御が効かない。' :
                    (lt < 5.5 ? '船内酸素分圧が低下していく…窓の外の地球が、少しずつ遠のいて見える。' : '……'));
        }

        // After the capsule bursts under 44.8 G
        shotCrushAfter(lt, dt, enter) {
            const V = window.OrbitalGame.VFX;
            const c = this.crushPoint || [0, -1.5, -14];
            if (enter) {
                this.timeScale = 1;
                this.rig.to([c[0] + 9, c[1] + 3, c[2] - 10], [c[0], c[1], c[2]], 54, 0.5, 1.2);
                for (let i = 0; i < 30; i++) {
                    const d = V.randDir([0, 0, 0]);
                    this.vfx.spawn({
                        pos: [c[0] + d[0] * 2, c[1] + d[1] * 2, c[2] + d[2] * 2],
                        vel: [d[0] * rnd(1, 4), d[1] * rnd(1, 4), d[2] * rnd(1, 4)],
                        life: 20, size: rnd(0.1, 0.35), color: [0.62, 0.55, 0.42, 1], colorEnd: [0.4, 0.38, 0.35, 1],
                        cell: V.CELL.DEBRIS, blend: 1, rotVel: rnd(-4, 4), fadeIn: 0, fadeOut: 0.95
                    });
                }
            }
            this.animateBlast(dt);
            const dist = 14 + lt * 3.5;
            this.rig.to([c[0] + dist * 0.7, c[1] + 3 + lt * 0.8, c[2] - dist * 0.7], [c[0], c[1] - lt * 0.5, c[2]], 54, 0.5, 1.2);
            this.tele.vel = 0; this.tele.g = lt < 0.4 ? 44.8 : 0; this.tele.temp = Math.max(-80, 1800 - lt * 420); this.tele.alt = 415;
            this.sub('CATASTROPHIC STRUCTURAL FAILURE // SIGNAL LOST',
                '爆風反動ダンパー未装着 — 衝撃を吸収できず船体は圧壊。軌道上には金色の破片だけが漂う。');
        }

        // Shallow entry: atmospheric skip-off
        shotSkip(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            if (enter) {
                this.setSun([0.6, 0.5, -0.55]);
                this.earthSpin = 1.5;
                this.skipC = new pc.Vec3(0, -this.R - 14, -36);
                this.earthGroup.setPosition(this.skipC);
                this.setPod(0, 0, 0);
                this.plasmaGroup.enabled = true;
                this.rig.cut([15, -5, -46], [0, 0, 0], 50);
                this.rig.minTrauma = 0;
                A.startReentryPlasmaSound();
            }
            const x = lt * 1.5;
            const y = -9 * Math.sin(Math.min(1, lt / 2.0) * Math.PI / 2) + (lt > 2 ? Math.pow(lt - 2, 1.6) * 5.5 : 0);
            const z = -18 * lt;
            this.setPod(x, y, z);
            this.podModel.setLocalEulerAngles(35 + lt * 40, lt * 55, lt * 20);
            const I = 0.6 * Math.exp(-Math.pow((lt - 2.0) / 0.75, 2));
            this.plasmaI = I;
            this.bowCapMat.setParameter('uIntensity', I * 2.2);
            this.shellMat.setParameter('uIntensity', I * 1.1);
            this.setHeat(I * 0.6, I * 0.2);
            const pod = this.podPos();
            if (I > 0.08) {
                for (let i = 0; i < Math.floor(I * 10); i++) {
                    const a = rnd(0, Math.PI * 2);
                    this.vfx.spawn({
                        pos: [pod.x + Math.cos(a) * 1.4, pod.y + Math.sin(a) * 1.4, pod.z - 1],
                        vel: [Math.cos(a) * 5, Math.sin(a) * 5 + 3, rnd(20, 40)],
                        life: rnd(0.3, 0.6), size: 0.14, color: [3.4, 2.2, 1.1, 1], colorEnd: [1.2, 0.25, 0.05, 0],
                        cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.05
                    });
                }
            }
            if (lt > 2.0) {
                this.once('bounce', () => {
                    this.rig.shake(0.6);
                    A.playShockwaveImpact(true);
                    V.Presets.shockRing(this.vfx, [pod.x, pod.y, pod.z], { size: 1, sizeEnd: 22, life: 0.9, color: [2.6, 1.4, 0.6, 1], colorEnd: [1, 0.3, 0.05, 0] });
                    for (let i = 0; i < 120; i++) {
                        const d = V.randDir([0, 0, 0]);
                        this.vfx.spawn({
                            pos: [pod.x, pod.y - 1, pod.z], vel: [d[0] * rnd(8, 26), Math.abs(d[1]) * rnd(4, 18), d[2] * rnd(8, 26)],
                            life: rnd(0.5, 1.2), size: 0.08, color: [4, 2.4, 1, 1], colorEnd: [1.2, 0.2, 0.02, 0],
                            cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.05, drag: 1.2
                        });
                    }
                });
            }
            if (lt > 3.4) this.once('skipQuiet', () => { A.stopReentryPlasmaSound(); this.plasmaGroup.enabled = false; });
            this.rig.to([15, -5, -46], [pod.x, pod.y, pod.z], 50, 1, 4);
            this.tele.alt = lt < 2 ? lerp(120, 92.4, lt / 2) : 92.4 + Math.pow(lt - 2, 1.6) * 14;
            this.tele.vel = 11.4; this.tele.g = 2 + I * 20; this.tele.temp = 200 + I * 2100;
            this.sub('TRAJECTORY ERROR // ATMOSPHERIC SKIP-OFF',
                lt < 1.9 ? '進入角が浅すぎる（> −5.3°）— 大気圏上端の熱圏に、斜めに突っ込んでいく…'
                    : '水切り石のように火花を散らして弾き返された！ 大気圏外へ跳躍していく——');
        }

        shotLost(lt, dt, enter) {
            if (enter) {
                const p = this.podPos();
                this.lostStart = p.clone();
                this.rig.cut([p.x + 6, p.y + 1.5, p.z + 12], [p.x, p.y, p.z], 50);
                this.rig.to(null, null, 30, 1, 3);
            }
            const s = this.lostStart;
            const k = lt * lt * 0.6 + lt * 4;
            this.setPod(s.x + k * 0.15, s.y + k * 0.35, s.z - k);
            const pod = this.podPos();
            this.podModel.rotateLocal(dt * 30, dt * 45, dt * 15);
            this.earthGroup.setPosition(this.skipC.x, this.skipC.y - lt * 5, this.skipC.z - lt * 3);
            this.rig.to(null, [pod.x, pod.y, pod.z], 30 - lt * 2, 1, 3);
            this.tele.alt = 140 + lt * 120; this.tele.vel = 11.6 + lt * 0.2; this.tele.g = 0; this.tele.temp = Math.max(-90, 300 - lt * 120);
            this.sub('LOST IN DEEP SPACE // BEYOND RETURN',
                '大気に弾かれたポッドは地球の重力を振り切った。もう、帰る場所へは戻れない——');
        }

        // Thermal failure: capsule disintegrates into a meteor shower
        shotBreakup(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            if (enter) {
                this.podModel.enabled = false;
                this.plasmaGroup.enabled = false;
                this.vfx.emitters.length = 0;
                V.Presets.explosion(this.vfx, [0, 0, 0], 0.9, { fire: 70, sparks: 160, smoke: 10, debris: 40 });
                this.doFlash(0.5, 4, [1, 0.75, 0.45]);
                this.rig.shake(0.9);
                A.playStationDetonation(true);
                if (!this.fragMat) {
                    this.fragMat = this.mats.createEmissive(1.0, 0.62, 0.25, 4.5);
                }
                this.frags = [];
                for (let i = 0; i < 8; i++) {
                    const s = rnd(0.25, 0.8);
                    const e = addPrim(this.spaceGroup, i % 2 ? 'box' : 'cone', `Fragment_${i}`, [rnd(-0.6, 0.6), rnd(-0.6, 0.6), rnd(-0.6, 0.6)], [s, s * rnd(0.6, 1.6), s], [rnd(0, 360), rnd(0, 360), 0], this.fragMat);
                    const f = { e, vel: new pc.Vec3(rnd(-4, 4), rnd(-3, 2), rnd(5, 18)), spin: new pc.Vec3(rnd(-200, 200), rnd(-200, 200), rnd(-200, 200)), size: s };
                    this.frags.push(f);
                    this.vfx.addEmitter({
                        rate: 90,
                        spawn: (eng) => {
                            const p = f.e.getPosition();
                            eng.spawn({
                                pos: [p.x, p.y, p.z], vel: [f.vel.x * 0.3 + rnd(-1, 1), f.vel.y * 0.3 + rnd(-1, 1), f.vel.z + rnd(18, 30)],
                                life: rnd(0.25, 0.55), size: f.size * 0.5, color: [3.4, 2.0, 0.9, 1], colorEnd: [1, 0.2, 0.03, 0],
                                cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.06
                            });
                            if (Math.random() < 0.35) {
                                eng.spawn({
                                    pos: [p.x, p.y, p.z], vel: [rnd(-0.5, 0.5), rnd(-0.5, 0.5), f.vel.z + rnd(8, 14)],
                                    life: rnd(0.8, 1.4), size: f.size * 1.2, sizeEnd: f.size * 5,
                                    color: [1.6, 0.6, 0.2, 0.5], colorEnd: [0.4, 0.08, 0.02, 0], cell: V.CELL.GLOW, blend: 0
                                });
                            }
                        }
                    });
                }
                this.rig.cut([27, 6, 4], [0, -1, 12], 50);
                this.rig.minTrauma = 0.1;
                if (this.postFx) { this.postFx.heatHaze = 0.4; this.postFx.temperature = 0.4; }
            }
            this.frags.forEach(f => {
                const p = f.e.getLocalPosition();
                f.vel.z *= Math.exp(-0.15 * dt);
                f.e.setLocalPosition(p.x + f.vel.x * dt, p.y + f.vel.y * dt, p.z + f.vel.z * dt);
                f.e.rotateLocal(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt);
            });
            this.earthBelow(this.podPos(), 12 - lt * 0.6, [0.15, 1, 0.45]);
            this.rig.to([27 + lt * 3, 6 + lt * 1.5, 4 + lt * 5], [0, -1.5, 12 + lt * 8], 50, 0.5, 1.2);
            if (this.postFx) this.postFx.heatHaze = Math.max(0, 0.4 - lt * 0.08);
            this.tele.alt = Math.max(30, 70 - lt * 6); this.tele.vel = 7.8; this.tele.g = 0; this.tele.temp = 3240;
            this.sub('HULL DISINTEGRATION // BROKEN UP IN ATMOSPHERE',
                '船殻温度 3,240℃ — KESTREL-01 は空中分解し、夜明けの空を横切る無数の流れ星となった。');
        }

        // Timeout: never escaped
        shotMeltdown(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            if (enter) {
                this.enterSpace();
                this.podWrapper.enabled = false;
                this.setSun([0.8, 0.3, -0.5]);
                this.earthPos([20, -128, 40]);
                this.rig.cut([22, 8, 24], [0, 0, 0], 54);
                this.rig.minTrauma = 0.05;
                this.secondary = [1.4, 2.3, 3.0, 3.6, 4.05];
                this.vfx.addEmitter({
                    rate: (et) => 20 + et * 70, duration: 4.5,
                    spawn: (eng) => {
                        const a = rnd(0, Math.PI * 2);
                        const dir = [rnd(-0.3, 0.3), Math.cos(a), Math.sin(a)];
                        eng.spawn({
                            pos: [dir[0], dir[1] * 2.7, dir[2] * 2.7], vel: [dir[0] * 8, dir[1] * rnd(6, 16), dir[2] * rnd(6, 16)],
                            life: rnd(0.4, 0.9), size: 0.07, color: [3, 1.8, 0.8, 1], colorEnd: [1.4, 0.3, 0.05, 0],
                            cell: V.CELL.SPARK, blend: 0, orient: V.ORIENT_STRETCH, stretch: 0.08, drag: 0.6
                        });
                    }
                });
            }
            const k = smooth(0, 4.4, lt);
            const ang = 0.72 + lt * 0.07;
            this.rig.to([Math.sin(ang) * 32, 9, Math.cos(ang) * 32], [0, 0, 0], 54 - k * 6, 0.8, 2);
            this.rig.minTrauma = 0.05 + k * 0.35;
            this.stationGroup.setLocalPosition(wob(lt * 30, 1) * k * 0.2, wob(lt * 27, 3) * k * 0.2, wob(lt * 25, 5) * k * 0.2);
            this.ventMat.emissive.set(1.0, lerp(0.9, 0.55, k), lerp(1.0, 0.25, k));
            this.ventMat.emissiveIntensity = 2 + k * 8 + Math.sin(lt * 50) * k * 2; this.ventMat.update();
            const red = Math.sin(lt * 12) > 0;
            this.windowMat.emissive.set(1.0, red ? 0.12 : 0.6, red ? 0.08 : 0.4); this.windowMat.update();
            this.coreLight.light.color = new pc.Color(1.0, lerp(0.85, 0.5, k), lerp(1.0, 0.3, k));
            this.coreLight.light.intensity = 2 + k * 8;
            this.secondary.forEach((at, i) => {
                if (lt > at) this.once('sec' + i, () => {
                    const c = this.stationChunks[(i * 7 + 3) % this.stationChunks.length].ent.getPosition();
                    V.Presets.explosion(this.vfx, [c.x, c.y, c.z], 0.6, { fire: 30, sparks: 60, smoke: 12, debris: 12 });
                    this.doFlash(0.12, 6, [1, 0.8, 0.6]);
                    this.rig.shake(0.35);
                    A.playShockwaveImpact(true);
                });
            });
            if (lt > 0.4) this.once('alarmM1', () => A.playAlarmPulse());
            if (lt > 2.2) this.once('alarmM2', () => A.playAlarmPulse());
            this.tele.vel = 7.66; this.tele.g = 0.2 + k; this.tele.temp = 40 + k * 900; this.tele.alt = 418.2;
            this.sub('CRITICAL FAILURE // CONTAINMENT BREACH',
                lt < 2.2 ? 'カウントダウン終了 — トカマク磁場崩壊。脱出ポッドはまだハンガーの中だ…！' : '連鎖爆発がステーションを引き裂いていく —— 炉心融解、臨界突破。');
        }

        shotMeltBlast(lt, dt, enter) {
            const A = window.OrbitalGame.Audio;
            const V = window.OrbitalGame.VFX;
            if (enter) {
                this.detonateStation(1.0);
                V.Presets.explosion(this.vfx, [0, 0, 0], 5.0, { fire: 160, sparks: 300, smoke: 50, debris: 80 });
                this.doFlash(1.0, 1.1, [1, 0.97, 0.92]);
                this.rig.shake(1.25);
                this.rig.minTrauma = 0;
                A.playStationDetonation(true);
            }
            this.animateBlast(dt);
            const s = lt;
            const big = Math.min(70, s * 34);
            this.fbOuter.setLocalScale(big, big, big);
            const ang = 0.72 + (4.4 + lt) * 0.07;
            const dist = 32 + Math.min(40, lt * 22);
            this.rig.to([Math.sin(ang) * dist, 9 + lt * 2, Math.cos(ang) * dist], [0, 0, 0], 60, 1.2, 2);
            if (lt > 0.65) this.once('wave2', () => { this.doFlash(0.55, 1.6, [1, 0.72, 0.4]); this.rig.shake(0.8); });
            this.tele.vel = 0; this.tele.g = 99.9; this.tele.temp = Math.floor(2400 + lt * 900); this.tele.alt = 418;
            this.sub('CONSUMED BY MELTDOWN // NO SURVIVORS',
                '宇宙ステーション HELIOS-9、完全爆縮 —— 超新星のようなプラズマ火球が、すべてを呑み込んだ。');
        }
    }

    window.OrbitalGame.CinematicEndings = window.OrbitalGame.CinematicEndings || {};
    window.OrbitalGame.CinematicEndings.CinematicDirector = CinematicDirector;
    window.OrbitalGame.CinematicDirector = CinematicDirector;
})();

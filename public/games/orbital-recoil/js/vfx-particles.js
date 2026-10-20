window.OrbitalGame = window.OrbitalGame || {};

// =============================================================================
// VFX PARTICLE ENGINE
// CPU-simulated, camera-facing billboard particles rendered in ONE draw call.
// Premultiplied-alpha blending lets additive (fire, sparks, plasma) and
// alpha-blended (smoke, steam, spray, debris) particles share a single pass:
//   blend = 0.0 -> purely additive, blend = 1.0 -> normal alpha "over".
// =============================================================================
(function () {
    // Sprite atlas cells (4 x 4 grid)
    const CELL = {
        GLOW: 0,      // soft gaussian glow
        SPARK: 1,     // hot pinpoint core
        SMOKE: 2,     // billowing smoke puff
        SMOKE2: 3,    // second smoke variant
        FIRE: 4,      // turbulent fire puff
        FLARE: 5,     // 4-point star flare
        RING: 6,      // thin ring (shockwaves / water rings)
        DEBRIS: 7,    // jagged hull fragment
        CLOUD: 8,     // big soft cumulus billow
        SPRAY: 9,     // water droplet cluster
        CLOTH: 10,    // torn fabric scrap
        DOT: 11       // small hard dot (dust motes)
    };

    const ORIENT_BILLBOARD = 0;
    const ORIENT_STRETCH = 1;
    const ORIENT_FLAT = 2;

    function hash(x, y) {
        const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
    }
    function vnoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }
    function fbm(x, y, oct) {
        let v = 0, a = 0.5, f = 1;
        for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
        return v;
    }

    // -------------------------------------------------------------------------
    // Procedural 512x512 sprite atlas (white-ish RGB, shape in alpha)
    // -------------------------------------------------------------------------
    function buildAtlas(device) {
        const S = 512, C = 128;
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(S, S);
        const d = img.data;

        const put = (cell, fn) => {
            const ox = (cell % 4) * C, oy = Math.floor(cell / 4) * C;
            for (let y = 0; y < C; y++) {
                for (let x = 0; x < C; x++) {
                    const u = (x + 0.5) / C * 2 - 1;
                    const v = (y + 0.5) / C * 2 - 1;
                    const out = fn(u, v, x, y);
                    const idx = ((oy + y) * S + ox + x) * 4;
                    d[idx] = Math.max(0, Math.min(255, out[0] * 255));
                    d[idx + 1] = Math.max(0, Math.min(255, out[1] * 255));
                    d[idx + 2] = Math.max(0, Math.min(255, out[2] * 255));
                    d[idx + 3] = Math.max(0, Math.min(255, out[3] * 255));
                }
            }
        };
        // Fade to zero at the cell border so bilinear/mip sampling never bleeds
        const edge = (u, v) => {
            const m = Math.max(Math.abs(u), Math.abs(v));
            return m > 0.94 ? 0 : 1 - Math.pow(Math.max(0, m - 0.86) / 0.08, 2);
        };

        put(CELL.GLOW, (u, v) => {
            const r = Math.hypot(u, v);
            const a = Math.exp(-r * r * 4.5) * (1 - Math.min(1, r)) ;
            return [1, 1, 1, a * edge(u, v)];
        });
        put(CELL.SPARK, (u, v) => {
            const r = Math.hypot(u, v);
            const a = Math.exp(-r * r * 26) + Math.exp(-r * r * 6) * 0.35;
            return [1, 1, 1, Math.min(1, a) * edge(u, v)];
        });
        const smoke = (seed) => (u, v) => {
            const r = Math.hypot(u, v);
            const n = fbm(u * 2.6 + seed, v * 2.6 - seed, 5);
            const billow = fbm(u * 5.5 - seed * 2, v * 5.5 + seed, 4);
            const shape = Math.max(0, 1 - r * (1.05 + (n - 0.5) * 0.9));
            const a = Math.pow(shape, 1.4) * (0.55 + billow * 0.6);
            const shade = 0.72 + 0.28 * (1 - (v + 1) * 0.5) * (0.6 + n * 0.6); // lighter on top
            return [shade, shade, shade, Math.min(1, a) * edge(u, v)];
        };
        put(CELL.SMOKE, smoke(3.1));
        put(CELL.SMOKE2, smoke(11.7));
        put(CELL.FIRE, (u, v) => {
            const r = Math.hypot(u, v);
            const n = fbm(u * 3.2 + 7.3, v * 3.2 + 1.9, 5);
            const shape = Math.max(0, 1 - r * (1.0 + (n - 0.5) * 1.3));
            const a = Math.pow(shape, 1.1);
            const core = Math.pow(shape, 2.4);
            return [1, 0.75 + core * 0.25, 0.45 + core * 0.55, Math.min(1, a * 1.25) * edge(u, v)];
        });
        put(CELL.FLARE, (u, v) => {
            const r = Math.hypot(u, v);
            const spikeH = Math.exp(-Math.abs(v) * 42) * Math.max(0, 1 - Math.abs(u));
            const spikeV = Math.exp(-Math.abs(u) * 42) * Math.max(0, 1 - Math.abs(v));
            const core = Math.exp(-r * r * 18);
            return [1, 1, 1, Math.min(1, core + (spikeH + spikeV) * 0.8) * edge(u, v)];
        });
        put(CELL.RING, (u, v) => {
            const r = Math.hypot(u, v);
            const ring = Math.exp(-Math.pow((r - 0.78) / 0.07, 2));
            const inner = Math.exp(-Math.pow((r - 0.6) / 0.22, 2)) * 0.18;
            return [1, 1, 1, Math.min(1, ring + inner) * edge(u, v)];
        });
        put(CELL.DEBRIS, (u, v) => {
            // angular polygonal hull plate fragment
            const d1 = Math.abs(u * 0.92 + v * 0.18) * 1.15;
            const d2 = Math.abs(v * 0.95 - u * 0.22) * 1.48;
            const d3 = (u * 0.7 + v * 0.65) * 1.05;
            const d4 = (-u * 0.8 + v * 0.5) * 0.95;
            const maxD = Math.max(d1, d2, d3, d4) + (fbm(u * 5.0 + 1.7, v * 5.0 - 2.3, 3) - 0.5) * 0.14;
            const inside = maxD < 0.62 ? 1 : 0;
            const bevel = maxD > 0.52 && maxD < 0.62 ? 0.22 : 0;
            const panel = 0.52 + 0.28 * fbm(u * 4.5, v * 4.5, 3) + bevel - (Math.abs((u * 3.5) % 1) < 0.05 ? 0.18 : 0);
            return [panel, panel * 0.98, panel * 0.95, inside * edge(u, v)];
        });
        put(CELL.CLOUD, (u, v) => {
            const r = Math.hypot(u, v * 1.25);
            const n = fbm(u * 2.2 + 21.3, v * 2.2 + 4.4, 6);
            const shape = Math.max(0, 1 - r * (1.0 + (n - 0.5) * 1.1));
            const a = Math.pow(shape, 0.9) * (0.65 + n * 0.5);
            const lit = 0.62 + 0.38 * Math.max(0, -v * 0.8 + 0.5) + (n - 0.5) * 0.25;
            return [lit, lit, Math.min(1, lit * 1.03), Math.min(1, a) * edge(u, v)];
        });
        put(CELL.SPRAY, (u, v) => {
            const r = Math.hypot(u, v);
            const n1 = fbm(u * 4.2 + 5.7, v * 4.2 - 2.3, 5);
            const n2 = fbm(u * 8.5 - 3.1, v * 8.5 + 6.4, 4);
            const shape = Math.max(0, 1 - r * (1.05 + (n1 - 0.5) * 0.75));
            const wisps = Math.pow(shape, 1.35) * (0.42 + 0.58 * Math.pow(n2, 1.6));
            const shade = 0.84 + 0.16 * (1 - (v + 1) * 0.5) * (0.7 + n1 * 0.5);
            return [shade, shade * 0.99, 1.0, Math.min(1, wisps) * edge(u, v)];
        });
        put(CELL.CLOTH, (u, v) => {
            const inside = (Math.abs(u) < 0.8 && Math.abs(v) < 0.55 + 0.25 * Math.sin(u * 9)) ? 1 : 0;
            const stripe = Math.floor((u + 1) * 3) % 2 === 0 ? 1.0 : 0.92;
            return [stripe, stripe, stripe, inside * edge(u, v)];
        });
        put(CELL.DOT, (u, v) => {
            const r = Math.hypot(u, v);
            return [1, 1, 1, Math.max(0, 1 - r * 1.6) * edge(u, v)];
        });

        ctx.putImageData(img, 0, 0);
        const tex = new pc.Texture(device, {
            width: S, height: S,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true,
            minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE,
            flipY: false
        });
        tex.setSource(canvas);
        return tex;
    }

    const VS = `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        attribute vec2 aUv0;
        attribute vec2 aUv1;
        uniform mat4 matrix_model;
        uniform mat4 matrix_viewProjection;
        varying vec3 vColor;
        varying vec2 vUv;
        varying vec2 vAB;
        void main(void) {
            vColor = aNormal;
            vUv = aUv0;
            vAB = aUv1;
            vec4 wp = matrix_model * vec4(aPosition, 1.0);
            gl_Position = matrix_viewProjection * wp;
        }
    `;
    const FS = `
        precision highp float;
        uniform sampler2D uAtlas;
        varying vec3 vColor;
        varying vec2 vUv;
        varying vec2 vAB;
        void main(void) {
            vec4 t = texture2D(uAtlas, vUv);
            float a = t.a * vAB.x;
            if (a < 0.002) discard;
            gl_FragColor = vec4(vColor * t.rgb * a, a * vAB.y);
        }
    `;

    class ParticleEngine {
        constructor(app, maxParticles = 5000, name = 'VFXParticles') {
            this.app = app;
            this.device = app.graphicsDevice;
            this.max = maxParticles;
            this.count = 0;
            this.camera = null;
            this.timeScale = 1.0;

            const N = maxParticles;
            this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
            this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
            this.age = new Float32Array(N); this.life = new Float32Array(N);
            this.s0 = new Float32Array(N); this.s1 = new Float32Array(N);
            this.rot = new Float32Array(N); this.rotVel = new Float32Array(N);
            this.drag = new Float32Array(N);
            this.gx = new Float32Array(N); this.gy = new Float32Array(N); this.gz = new Float32Array(N);
            this.c0 = new Float32Array(N * 4); this.c1 = new Float32Array(N * 4);
            this.cell = new Uint8Array(N); this.blend = new Float32Array(N);
            this.orient = new Uint8Array(N); this.stretch = new Float32Array(N);
            this.fadeIn = new Float32Array(N); this.fadeOut = new Float32Array(N);
            this.aspect = new Float32Array(N);
            this.order = new Uint32Array(N);
            this.depth = new Float32Array(N);

            this.posData = new Float32Array(N * 4 * 3);
            this.colData = new Float32Array(N * 4 * 3);
            this.uv0Data = new Float32Array(N * 4 * 2);
            this.uv1Data = new Float32Array(N * 4 * 2);
            this.idxData = new Uint16Array(N * 6);
            for (let i = 0; i < N; i++) {
                const v = i * 4, k = i * 6;
                this.idxData[k] = v; this.idxData[k + 1] = v + 1; this.idxData[k + 2] = v + 2;
                this.idxData[k + 3] = v; this.idxData[k + 4] = v + 2; this.idxData[k + 5] = v + 3;
            }

            this.bigAabb = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(1e5, 1e5, 1e5));
            this.mesh = new pc.Mesh(this.device);
            this.mesh.clear(true, false);
            this.mesh.setPositions(this.posData, 3, N * 4);
            this.mesh.setNormals(this.colData, 3, N * 4);
            this.mesh.setUvs(0, this.uv0Data, 2, N * 4);
            this.mesh.setUvs(1, this.uv1Data, 2, N * 4);
            this.mesh.setIndices(this.idxData, N * 6);
            this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
            this.mesh.primitive[0].count = 0;
            this.mesh.aabb = this.bigAabb;

            this.atlas = ParticleEngine.sharedAtlas || (ParticleEngine.sharedAtlas = buildAtlas(this.device));
            const shader = pc.createShaderFromCode(this.device, VS, FS, 'VFXParticleShader_' + name, {
                aPosition: pc.SEMANTIC_POSITION,
                aNormal: pc.SEMANTIC_NORMAL,
                aUv0: pc.SEMANTIC_TEXCOORD0,
                aUv1: pc.SEMANTIC_TEXCOORD1
            });
            this.material = new pc.Material();
            this.material.shader = shader;
            this.material.setParameter('uAtlas', this.atlas);
            this.material.blendType = pc.BLEND_PREMULTIPLIED;
            this.material.depthWrite = false;
            this.material.depthTest = true;
            this.material.cull = pc.CULLFACE_NONE;
            this.material.update();

            this.meshInstance = new pc.MeshInstance(this.mesh, this.material);
            this.meshInstance.cull = false;
            this.entity = new pc.Entity(name);
            this.entity.addComponent('render', {
                meshInstances: [this.meshInstance],
                castShadows: false,
                receiveShadows: false
            });
            app.root.addChild(this.entity);

            this.emitters = [];
            this._right = new pc.Vec3();
            this._up = new pc.Vec3();
        }

        setCamera(cameraEntity) { this.camera = cameraEntity; }

        clear() {
            this.count = 0;
            this.emitters.length = 0;
            this._writeBuffers();
        }

        // ---------------------------------------------------------------------
        // Spawn a single particle. All fields optional except pos.
        // ---------------------------------------------------------------------
        spawn(o) {
            if (this.count >= this.max) return -1;
            const i = this.count++;
            const p = o.pos, v = o.vel || ZERO3;
            this.px[i] = p[0]; this.py[i] = p[1]; this.pz[i] = p[2];
            this.vx[i] = v[0]; this.vy[i] = v[1]; this.vz[i] = v[2];
            this.age[i] = 0;
            this.life[i] = o.life || 1.0;
            const s = o.size !== undefined ? o.size : 1.0;
            this.s0[i] = s;
            this.s1[i] = o.sizeEnd !== undefined ? o.sizeEnd : s;
            this.rot[i] = o.rot !== undefined ? o.rot : Math.random() * Math.PI * 2;
            this.rotVel[i] = o.rotVel || 0;
            this.drag[i] = o.drag || 0;
            const g = o.gravity;
            if (typeof g === 'number') { this.gx[i] = 0; this.gy[i] = g; this.gz[i] = 0; }
            else if (g) { this.gx[i] = g[0]; this.gy[i] = g[1]; this.gz[i] = g[2]; }
            else { this.gx[i] = 0; this.gy[i] = 0; this.gz[i] = 0; }
            const c = o.color || WHITE4, ce = o.colorEnd || c;
            const k = i * 4;
            this.c0[k] = c[0]; this.c0[k + 1] = c[1]; this.c0[k + 2] = c[2]; this.c0[k + 3] = c[3] !== undefined ? c[3] : 1;
            this.c1[k] = ce[0]; this.c1[k + 1] = ce[1]; this.c1[k + 2] = ce[2]; this.c1[k + 3] = ce[3] !== undefined ? ce[3] : 1;
            this.cell[i] = o.cell !== undefined ? o.cell : CELL.GLOW;
            this.blend[i] = o.blend !== undefined ? o.blend : 0;
            this.orient[i] = o.orient || ORIENT_BILLBOARD;
            this.stretch[i] = o.stretch !== undefined ? o.stretch : 0.05;
            this.fadeIn[i] = o.fadeIn !== undefined ? o.fadeIn : 0.06;
            this.fadeOut[i] = o.fadeOut !== undefined ? o.fadeOut : 0.55;
            this.aspect[i] = o.aspect || 1.0;
            return i;
        }

        _kill(i) {
            const j = --this.count;
            if (i === j) return;
            this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
            this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
            this.age[i] = this.age[j]; this.life[i] = this.life[j];
            this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
            this.rot[i] = this.rot[j]; this.rotVel[i] = this.rotVel[j];
            this.drag[i] = this.drag[j];
            this.gx[i] = this.gx[j]; this.gy[i] = this.gy[j]; this.gz[i] = this.gz[j];
            for (let q = 0; q < 4; q++) {
                this.c0[i * 4 + q] = this.c0[j * 4 + q];
                this.c1[i * 4 + q] = this.c1[j * 4 + q];
            }
            this.cell[i] = this.cell[j]; this.blend[i] = this.blend[j];
            this.orient[i] = this.orient[j]; this.stretch[i] = this.stretch[j];
            this.fadeIn[i] = this.fadeIn[j]; this.fadeOut[i] = this.fadeOut[j];
            this.aspect[i] = this.aspect[j];
        }

        // Continuous emitter: { rate, spawn(engine, dt, t), active, life(optional seconds) }
        addEmitter(em) {
            em.accum = 0;
            em.t = 0;
            if (em.active === undefined) em.active = true;
            this.emitters.push(em);
            return em;
        }

        removeEmitter(em) {
            const i = this.emitters.indexOf(em);
            if (i >= 0) this.emitters.splice(i, 1);
        }

        update(dt) {
            dt *= this.timeScale;
            if (dt <= 0) { this._writeBuffers(); return; }
            dt = Math.min(dt, 0.05);

            // 1. Emitters
            for (let e = this.emitters.length - 1; e >= 0; e--) {
                const em = this.emitters[e];
                em.t += dt;
                if (em.duration !== undefined && em.t > em.duration) {
                    this.emitters.splice(e, 1);
                    continue;
                }
                if (!em.active) continue;
                const rate = typeof em.rate === 'function' ? em.rate(em.t) : em.rate;
                em.accum += rate * dt;
                let n = Math.floor(em.accum);
                em.accum -= n;
                while (n-- > 0) em.spawn(this, em.t);
            }

            // 2. Integrate
            for (let i = 0; i < this.count; i++) {
                this.age[i] += dt;
                if (this.age[i] >= this.life[i]) {
                    this._kill(i);
                    i--;
                    continue;
                }
                const dr = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
                this.vx[i] = (this.vx[i] + this.gx[i] * dt) * dr;
                this.vy[i] = (this.vy[i] + this.gy[i] * dt) * dr;
                this.vz[i] = (this.vz[i] + this.gz[i] * dt) * dr;
                this.px[i] += this.vx[i] * dt;
                this.py[i] += this.vy[i] * dt;
                this.pz[i] += this.vz[i] * dt;
                this.rot[i] += this.rotVel[i] * dt;
            }

            this._writeBuffers();
        }

        _writeBuffers() {
            const n = this.count;
            if (n === 0 || !this.camera) {
                this.meshInstance.visible = false;
                return;
            }
            this.meshInstance.visible = true;

            const camWT = this.camera.getWorldTransform();
            camWT.getX(this._right);
            camWT.getY(this._up);
            const cp = this.camera.getPosition();
            const cx = cp.x, cy = cp.y, cz = cp.z;
            const rx = this._right.x, ry = this._right.y, rz = this._right.z;
            const ux = this._up.x, uy = this._up.y, uz = this._up.z;

            // Back-to-front sort so alpha-blended smoke composites correctly
            const order = this.order, depth = this.depth;
            for (let i = 0; i < n; i++) {
                const dx = this.px[i] - cx, dy = this.py[i] - cy, dz = this.pz[i] - cz;
                depth[i] = dx * dx + dy * dy + dz * dz;
                order[i] = i;
            }
            const sub = order.subarray(0, n);
            sub.sort((a, b) => depth[b] - depth[a]);

            const pos = this.posData;
            const col = this.colData;
            const uv0 = this.uv0Data;
            const uv1 = this.uv1Data;
            const cellUV = 0.25;
            const pad = 0.004;

            for (let s = 0; s < n; s++) {
                const i = sub[s];
                const t = this.age[i] / this.life[i];
                const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
                const k = i * 4;
                const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
                const fo = t > this.fadeOut[i] ? Math.max(0, 1 - (t - this.fadeOut[i]) / Math.max(0.0001, 1 - this.fadeOut[i])) : 1;
                const env = fi * fo;
                const r = this.c0[k] + (this.c1[k] - this.c0[k]) * t;
                const g = this.c0[k + 1] + (this.c1[k + 1] - this.c0[k + 1]) * t;
                const b = this.c0[k + 2] + (this.c1[k + 2] - this.c0[k + 2]) * t;
                const a = (this.c0[k + 3] + (this.c1[k + 3] - this.c0[k + 3]) * t) * env;

                const px = this.px[i], py = this.py[i], pz = this.pz[i];
                let ax, ay, az, bx, by, bz;

                const o = this.orient[i];
                if (o === ORIENT_STRETCH) {
                    let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
                    const sp = Math.hypot(vx, vy, vz) || 1;
                    vx /= sp; vy /= sp; vz /= sp;
                    let wx = px - cx, wy = py - cy, wz = pz - cz;
                    let sx = vy * wz - vz * wy, sy = vz * wx - vx * wz, sz = vx * wy - vy * wx;
                    const sl = Math.hypot(sx, sy, sz) || 1;
                    sx /= sl; sy /= sl; sz /= sl;
                    const len = size * (1 + sp * this.stretch[i]);
                    ax = vx * len; ay = vy * len; az = vz * len;
                    bx = sx * size; by = sy * size; bz = sz * size;
                } else if (o === ORIENT_FLAT) {
                    const c = Math.cos(this.rot[i]) * size, sn = Math.sin(this.rot[i]) * size;
                    ax = c; ay = 0; az = sn;
                    bx = -sn; by = 0; bz = c;
                } else {
                    const c = Math.cos(this.rot[i]), sn = Math.sin(this.rot[i]);
                    const sw = size * this.aspect[i];
                    ax = (rx * c + ux * sn) * sw; ay = (ry * c + uy * sn) * sw; az = (rz * c + uz * sn) * sw;
                    bx = (ux * c - rx * sn) * size; by = (uy * c - ry * sn) * size; bz = (uz * c - rz * sn) * size;
                }

                const cellIdx = this.cell[i];
                const u0 = (cellIdx % 4) * cellUV + pad, v0 = Math.floor(cellIdx / 4) * cellUV + pad;
                const u1 = u0 + cellUV - pad * 2, v1 = v0 + cellUV - pad * 2;
                const tv0 = v0, tv1 = v1;
                const bl = this.blend[i];

                const p3 = s * 12;
                const p2 = s * 8;
                // corner 0: -a -b
                pos[p3] = px - ax - bx; pos[p3 + 1] = py - ay - by; pos[p3 + 2] = pz - az - bz;
                pos[p3 + 3] = px + ax - bx; pos[p3 + 4] = py + ay - by; pos[p3 + 5] = pz + az - bz;
                pos[p3 + 6] = px + ax + bx; pos[p3 + 7] = py + ay + by; pos[p3 + 8] = pz + az + bz;
                pos[p3 + 9] = px - ax + bx; pos[p3 + 10] = py - ay + by; pos[p3 + 11] = pz - az + bz;

                col[p3] = r; col[p3 + 1] = g; col[p3 + 2] = b;
                col[p3 + 3] = r; col[p3 + 4] = g; col[p3 + 5] = b;
                col[p3 + 6] = r; col[p3 + 7] = g; col[p3 + 8] = b;
                col[p3 + 9] = r; col[p3 + 10] = g; col[p3 + 11] = b;

                uv0[p2] = u0; uv0[p2 + 1] = tv1;
                uv0[p2 + 2] = u1; uv0[p2 + 3] = tv1;
                uv0[p2 + 4] = u1; uv0[p2 + 5] = tv0;
                uv0[p2 + 6] = u0; uv0[p2 + 7] = tv0;

                uv1[p2] = a; uv1[p2 + 1] = bl;
                uv1[p2 + 2] = a; uv1[p2 + 3] = bl;
                uv1[p2 + 4] = a; uv1[p2 + 5] = bl;
                uv1[p2 + 6] = a; uv1[p2 + 7] = bl;
            }

            const maxVerts = this.max * 4;
            this.mesh.setPositions(pos, 3, maxVerts);
            this.mesh.setNormals(col, 3, maxVerts);
            this.mesh.setUvs(0, uv0, 2, maxVerts);
            this.mesh.setUvs(1, uv1, 2, maxVerts);
            this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
            this.mesh.primitive[0].count = n * 6;
            this.mesh.aabb = this.bigAabb;
        }
    }

    const ZERO3 = [0, 0, 0];
    const WHITE4 = [1, 1, 1, 1];

    // -------------------------------------------------------------------------
    // Shared helpers / presets
    // -------------------------------------------------------------------------
    const rand = (a, b) => a + Math.random() * (b - a);
    function randDir(out) {
        const z = rand(-1, 1), a = rand(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
        out[0] = Math.cos(a) * r; out[1] = Math.sin(a) * r; out[2] = z;
        return out;
    }

    const Presets = {
        // Big multi-layer explosion (fire + core flash + sparks + smoke + debris)
        explosion(eng, pos, scale = 1.0, opts = {}) {
            const d = [0, 0, 0];
            const fireCount = Math.floor((opts.fire || 70) * Math.min(1.6, scale));
            for (let i = 0; i < fireCount; i++) {
                randDir(d);
                const sp = rand(3.5, 14) * scale;
                eng.spawn({
                    pos: [pos[0] + d[0] * 0.5 * scale, pos[1] + d[1] * 0.5 * scale, pos[2] + d[2] * 0.5 * scale],
                    vel: [d[0] * sp, d[1] * sp, d[2] * sp],
                    life: rand(0.7, 1.7), size: rand(0.9, 1.9) * scale, sizeEnd: rand(2.6, 4.8) * scale,
                    color: [1.35, 0.58, 0.14, 0.65], colorEnd: [0.45, 0.08, 0.01, 0.0],
                    cell: CELL.FIRE, blend: 0, drag: 2.2, rotVel: rand(-1.5, 1.5), fadeOut: 0.35
                });
            }
            // hot core flash & star flare
            eng.spawn({ pos, life: 0.32, size: 2.5 * scale, sizeEnd: 9 * scale, color: [1.8, 1.15, 0.45, 0.85], colorEnd: [0.9, 0.3, 0.05, 0], cell: CELL.GLOW, blend: 0, fadeIn: 0, fadeOut: 0.1 });
            eng.spawn({ pos, life: 0.45, size: 4.5 * scale, sizeEnd: 16 * scale, color: [1.6, 0.95, 0.35, 0.8], colorEnd: [0.8, 0.2, 0.03, 0], cell: CELL.FLARE, blend: 0, fadeIn: 0, fadeOut: 0.0, rot: 0 });
            // spark streaks
            const sparkCount = Math.floor((opts.sparks || 160) * Math.min(2, scale));
            for (let i = 0; i < sparkCount; i++) {
                randDir(d);
                const sp = rand(12, 46) * scale;
                eng.spawn({
                    pos: [pos[0], pos[1], pos[2]],
                    vel: [d[0] * sp, d[1] * sp, d[2] * sp],
                    life: rand(0.6, 2.2), size: rand(0.05, 0.12) * scale,
                    color: [1.8, 1.1, 0.4, 0.95], colorEnd: [1.1, 0.25, 0.04, 0],
                    cell: CELL.SPARK, blend: 0, drag: rand(0.6, 1.6), gravity: opts.gravity || 0,
                    orient: ORIENT_STRETCH, stretch: 0.06, fadeIn: 0, fadeOut: 0.5
                });
            }
            // smoke
            const smokeCount = Math.floor((opts.smoke || 40) * Math.min(2, scale));
            const smokeCol = opts.smokeColor || [0.16, 0.15, 0.15];
            for (let i = 0; i < smokeCount; i++) {
                randDir(d);
                const sp = rand(1.5, 6.5) * scale;
                eng.spawn({
                    pos: [pos[0] + d[0] * scale, pos[1] + d[1] * scale, pos[2] + d[2] * scale],
                    vel: [d[0] * sp, d[1] * sp + (opts.smokeRise || 0), d[2] * sp],
                    life: rand(3.5, 7.0), size: rand(1.5, 3.0) * scale, sizeEnd: rand(7, 12) * scale,
                    color: [smokeCol[0], smokeCol[1], smokeCol[2], 0.85], colorEnd: [smokeCol[0] * 0.8, smokeCol[1] * 0.8, smokeCol[2] * 0.8, 0],
                    cell: Math.random() < 0.5 ? CELL.SMOKE : CELL.SMOKE2, blend: 1, drag: 1.1,
                    rotVel: rand(-0.4, 0.4), fadeIn: 0.12, fadeOut: 0.45
                });
            }
            // tumbling debris
            const debrisCount = opts.debris !== undefined ? opts.debris : 40;
            for (let i = 0; i < debrisCount; i++) {
                randDir(d);
                const sp = rand(6, 28) * scale;
                eng.spawn({
                    pos: [pos[0], pos[1], pos[2]],
                    vel: [d[0] * sp, d[1] * sp, d[2] * sp],
                    life: rand(2.5, 5.0), size: rand(0.12, 0.45) * scale,
                    color: [0.55, 0.52, 0.5, 1], colorEnd: [0.25, 0.22, 0.2, 1],
                    cell: CELL.DEBRIS, blend: 1, drag: 0.25, gravity: opts.gravity || 0,
                    rotVel: rand(-9, 9), fadeIn: 0, fadeOut: 0.8
                });
            }
        },

        // Expanding shockwave ring (flat or billboard)
        shockRing(eng, pos, opts = {}) {
            eng.spawn({
                pos, life: opts.life || 1.4,
                size: opts.size || 1, sizeEnd: opts.sizeEnd || 40,
                color: opts.color || [0.6, 1.4, 2.4, 1], colorEnd: opts.colorEnd || [0.2, 0.5, 1.0, 0],
                cell: CELL.RING, blend: opts.blend || 0,
                orient: opts.flat ? ORIENT_FLAT : ORIENT_BILLBOARD, rot: 0, fadeIn: 0, fadeOut: 0.25
            });
        },

        // Upward water column + radial spray + foam ring on a surface at y
        splash(eng, pos, scale = 1.0, opts = {}) {
            const d = [0, 0, 0];
            const n = Math.floor((opts.count || 95) * scale);
            for (let i = 0; i < n; i++) {
                const a = rand(0, Math.PI * 2);
                const spread = rand(0.2, 1.0);
                const up = rand(7, 19) * scale * (1.1 - spread * 0.55);
                const out = rand(2.5, 9.5) * scale * spread;
                eng.spawn({
                    pos: [pos[0] + Math.cos(a) * 1.1 * scale, pos[1] + 0.2, pos[2] + Math.sin(a) * 1.1 * scale],
                    vel: [Math.cos(a) * out, up, Math.sin(a) * out],
                    life: rand(1.1, 2.3), size: rand(0.45, 1.1) * scale, sizeEnd: rand(1.6, 3.0) * scale,
                    color: [0.88, 0.93, 0.98, 0.30], colorEnd: [0.72, 0.80, 0.88, 0],
                    cell: CELL.SPRAY, blend: 1, gravity: -16 * Math.max(0.6, scale * 0.8), drag: 0.6,
                    rotVel: rand(-1, 1), fadeIn: 0.04, fadeOut: 0.5
                });
            }
            // mist
            for (let i = 0; i < 18 * scale; i++) {
                randDir(d);
                eng.spawn({
                    pos: [pos[0] + d[0] * 2.2 * scale, pos[1] + Math.abs(d[1]) * 1.8, pos[2] + d[2] * 2.2 * scale],
                    vel: [d[0] * 3.2 * scale, rand(1, 3.5), d[2] * 3.2 * scale],
                    life: rand(2.0, 3.8), size: rand(1.6, 2.8) * scale, sizeEnd: rand(4.5, 7.5) * scale,
                    color: [0.85, 0.90, 0.95, 0.16], colorEnd: [0.78, 0.84, 0.90, 0],
                    cell: CELL.SMOKE, blend: 1, drag: 1.2, fadeIn: 0.12, fadeOut: 0.4
                });
            }
            // foam rings
            for (let r = 0; r < 3; r++) {
                eng.spawn({
                    pos: [pos[0], pos[1] + 0.06 + r * 0.01, pos[2]], life: 2.6 + r * 0.8,
                    size: 1.8 * scale, sizeEnd: (14 + r * 9) * scale,
                    color: [0.92, 0.96, 1.0, 0.55], colorEnd: [0.82, 0.90, 0.96, 0],
                    cell: CELL.RING, blend: 1, orient: ORIENT_FLAT, rot: 0, fadeIn: 0, fadeOut: 0.3
                });
            }
        }
    };

    window.OrbitalGame.VFX = {
        ParticleEngine,
        Presets,
        CELL,
        ORIENT_BILLBOARD,
        ORIENT_STRETCH,
        ORIENT_FLAT,
        rand,
        randDir
    };
})();

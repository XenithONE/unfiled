window.OrbitalGame = window.OrbitalGame || {};

// =============================================================================
// SURFACE ENVIRONMENT (used by the descent / splashdown / crash cinematics)
//   - Atmospheric sky dome with sun disc, Mie halo and horizon glow
//   - Camera-following Gerstner-wave ocean (fresnel sky reflection, sun glint,
//     crest foam, distance haze, fluorescent dye-marker patch)
//   - Procedural cloud deck (seen from above and below)
//   - Volcanic islands with height-based vertex colouring
// =============================================================================
(function () {
    const PRESETS = {
        sunrise: {
            sunDir: [0.50, 0.11, -0.86],
            zenith: [0.07, 0.18, 0.42],
            horizon: [1.00, 0.62, 0.38],
            sunColor: [1.55, 0.95, 0.52],
            haze: 1.25,
            deep: [0.010, 0.050, 0.090],
            scatter: [0.02, 0.16, 0.17],
            cloudLit: [1.05, 0.78, 0.60],
            cloudShade: [0.36, 0.34, 0.42],
            cloudCover: 0.50,
            light: [1.0, 0.78, 0.55], lightIntensity: 1.7,
            ambient: [0.28, 0.27, 0.33]
        },
        day: {
            sunDir: [0.36, 0.62, -0.70],
            zenith: [0.13, 0.32, 0.68],
            horizon: [0.64, 0.76, 0.90],
            sunColor: [1.45, 1.35, 1.18],
            haze: 0.8,
            deep: [0.012, 0.070, 0.130],
            scatter: [0.02, 0.20, 0.22],
            cloudLit: [1.05, 1.05, 1.08],
            cloudShade: [0.52, 0.56, 0.64],
            cloudCover: 0.54,
            light: [1.0, 0.97, 0.9], lightIntensity: 1.9,
            ambient: [0.36, 0.40, 0.48]
        },
        overcast: {
            sunDir: [0.30, 0.48, -0.82],
            zenith: [0.26, 0.30, 0.36],
            horizon: [0.56, 0.58, 0.62],
            sunColor: [0.75, 0.74, 0.72],
            haze: 1.6,
            deep: [0.020, 0.050, 0.070],
            scatter: [0.03, 0.10, 0.11],
            cloudLit: [0.74, 0.76, 0.80],
            cloudShade: [0.30, 0.32, 0.36],
            cloudCover: 0.30,
            light: [0.85, 0.87, 0.9], lightIntensity: 1.1,
            ambient: [0.34, 0.36, 0.40]
        }
    };

    // Shared GLSL sky function (used by dome + ocean reflection + fog)
    const SKY_GLSL = `
        uniform vec3 uSunDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform float uHaze;
        vec3 skyColor(vec3 dir, bool withSun) {
            float y = dir.y;
            vec3 L = normalize(uSunDir);
            float sd = max(dot(dir, L), 0.0);
            float hgrad = pow(1.0 - clamp(y, 0.0, 1.0), 4.0);
            vec3 sky = mix(uZenith, uHorizon, hgrad);
            // warm in-scatter towards the sun along the horizon
            sky += uSunColor * pow(sd, 4.0) * exp(-max(y, 0.0) * 6.0) * 0.35 * uHaze;
            sky += uSunColor * pow(sd, 24.0) * 0.30 * uHaze;
            if (withSun) {
                sky += uSunColor * smoothstep(0.9993, 0.99985, sd) * 5.5;  // solar disc
                sky += uSunColor * pow(sd, 240.0) * 1.1;                   // corona
            }
            // below horizon: darker haze band
            sky = mix(sky, uHorizon * 0.62, smoothstep(0.0, -0.12, y));
            return sky;
        }
    `;

    const VS_WORLD = `
        attribute vec3 aPosition;
        uniform mat4 matrix_model;
        uniform mat4 matrix_viewProjection;
        varying vec3 vPositionW;
        void main(void) {
            vec4 wp = matrix_model * vec4(aPosition, 1.0);
            vPositionW = wp.xyz;
            gl_Position = matrix_viewProjection * wp;
        }
    `;

    const FS_SKY = `
        precision highp float;
        varying vec3 vPositionW;
        uniform vec3 view_position;
        ${SKY_GLSL}
        void main(void) {
            vec3 dir = normalize(vPositionW - view_position);
            gl_FragColor = vec4(skyColor(dir, true), 1.0);
        }
    `;

    const VS_OCEAN = `
        attribute vec3 aPosition;
        uniform mat4 matrix_viewProjection;
        uniform vec3 uOrigin;     // camera-follow offset (xz)
        uniform float uTime;
        uniform vec3 view_position;
        varying vec3 vPositionW;
        varying vec3 vNormalW;
        varying float vCrest;

        vec3 gerstner(vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal) {
            float steep = wave.z;
            float wl = wave.w;
            float k = 6.28318 / wl;
            float c = sqrt(9.8 / k);
            vec2 d = normalize(wave.xy);
            float f = k * (dot(d, p.xz) - c * uTime);
            float a = steep / k;
            tangent += vec3(-d.x * d.x * (steep * sin(f)), d.x * (steep * cos(f)), -d.x * d.y * (steep * sin(f)));
            binormal += vec3(-d.x * d.y * (steep * sin(f)), d.y * (steep * cos(f)), -d.y * d.y * (steep * sin(f)));
            return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
        }

        void main(void) {
            vec3 p = aPosition + vec3(uOrigin.x, 0.0, uOrigin.z);
            float dist = length(p.xz - view_position.xz);
            float fade = 1.0 - smoothstep(180.0, 650.0, dist);
            vec3 tangent = vec3(1.0, 0.0, 0.0);
            vec3 binormal = vec3(0.0, 0.0, 1.0);
            vec3 disp = vec3(0.0);
            disp += gerstner(vec4(1.0, 0.35, 0.16 * fade, 58.0), p, tangent, binormal);
            disp += gerstner(vec4(0.6, -0.8, 0.14 * fade, 31.0), p, tangent, binormal);
            disp += gerstner(vec4(-0.4, 1.0, 0.12 * fade, 17.0), p, tangent, binormal);
            disp += gerstner(vec4(0.9, 0.9, 0.10 * fade, 8.5), p, tangent, binormal);
            vec3 wp = p + disp;
            vPositionW = wp;
            vNormalW = normalize(cross(binormal, tangent));
            vCrest = disp.y;
            gl_Position = matrix_viewProjection * vec4(wp, 1.0);
        }
    `;

    const FS_OCEAN = `
        precision highp float;
        varying vec3 vPositionW;
        varying vec3 vNormalW;
        varying float vCrest;
        uniform vec3 view_position;
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uScatter;
        uniform vec4 uDye;        // xz centre, radius, strength
        uniform float uFogDist;
        ${SKY_GLSL}

        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main(void) {
            vec3 toCam = view_position - vPositionW;
            float dist = length(toCam);
            vec3 V = toCam / dist;
            vec3 L = normalize(uSunDir);

            // Fine capillary ripples (procedural normal perturbation, faded with distance)
            vec2 q = vPositionW.xz;
            float rf = 1.0 - smoothstep(30.0, 260.0, dist);
            vec2 rip = vec2(
                sin(q.x * 1.7 + uTime * 2.1) * 0.5 + sin(q.x * 3.9 - q.y * 1.3 + uTime * 3.3) * 0.3 + (n2(q * 0.9 + uTime * 0.6) - 0.5),
                sin(q.y * 1.9 - uTime * 1.8) * 0.5 + sin(q.y * 4.3 + q.x * 1.1 - uTime * 2.7) * 0.3 + (n2(q * 0.9 - uTime * 0.5 + 7.0) - 0.5)
            ) * 0.09 * rf;
            vec3 N = normalize(vNormalW + vec3(rip.x, 0.0, rip.y));

            float NdotV = max(dot(N, V), 0.0);
            float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
            vec3 R = reflect(-V, N);
            R.y = abs(R.y);
            vec3 refl = skyColor(R, false);

            // Subsurface scattering through wave crests facing the sun
            float sss = pow(max(dot(V, -L + vec3(0.0, 0.25, 0.0)), 0.0), 3.0) * clamp(vCrest * 0.6 + 0.4, 0.0, 1.5);
            vec3 water = uDeep + uScatter * (0.35 + sss * 1.4) * max(L.y + 0.25, 0.15);

            vec3 col = mix(water, refl, fresnel);

            // Sun glint (tight + broad sparkle)
            float spec = pow(max(dot(R, L), 0.0), 900.0) * 18.0 + pow(max(dot(R, L), 0.0), 90.0) * 0.6;
            col += uSunColor * spec * (0.6 + 0.4 * n2(q * 6.0 + uTime));

            // Crest foam
            float foam = smoothstep(0.55, 1.15, vCrest) * (0.55 + 0.45 * n2(q * 1.6 + uTime * 0.4));
            col = mix(col, vec3(0.86, 0.9, 0.93) * (0.55 + 0.45 * max(L.y, 0.2)), foam * 0.7 * rf);

            // Fluorescent sea-dye marker patch around the capsule
            if (uDye.w > 0.0) {
                float dd = length(q - uDye.xy) / max(uDye.z, 0.001);
                float edge = n2(q * 0.35 + 3.0) * 0.35;
                float dye = (1.0 - smoothstep(0.55 + edge, 1.0 + edge, dd)) * uDye.w;
                col = mix(col, vec3(0.10, 0.55, 0.22) + uSunColor * 0.04, dye * 0.75);
            }

            // Aerial perspective toward the horizon
            float fog = 1.0 - exp(-dist / uFogDist);
            vec3 horizon = skyColor(normalize(vec3(-V.x, 0.015, -V.z)), false);
            col = mix(col, horizon, clamp(fog, 0.0, 1.0));

            gl_FragColor = vec4(col, 1.0);
        }
    `;

    const FS_CLOUDS = `
        precision highp float;
        varying vec3 vPositionW;
        uniform vec3 view_position;
        uniform float uTime;
        uniform float uCover;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudShade;
        ${SKY_GLSL}
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 6; i++) { v += a * n2(p); p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; }
            return v;
        }
        void main(void) {
            vec2 p = vPositionW.xz * 0.0062 + vec2(uTime * 0.004, uTime * 0.0015);
            float d = fbm(p);
            float detail = fbm(p * 3.1 + 4.0);
            float density = smoothstep(uCover, uCover + 0.26, d * 0.82 + detail * 0.22);
            if (density < 0.005) discard;

            vec3 toCam = view_position - vPositionW;
            float dist = length(toCam);
            bool above = view_position.y > vPositionW.y;
            vec3 L = normalize(uSunDir);
            // fake self-shadowing: denser cores darker, sunward edges brighter
            float lightTerm = above ? (0.55 + 0.45 * smoothstep(0.2, 0.9, detail)) : (0.35 + 0.25 * (1.0 - density));
            vec3 col = mix(uCloudShade, uCloudLit, lightTerm);
            col += uSunColor * pow(max(dot(normalize(-toCam), L), 0.0), 8.0) * 0.25 * (1.0 - density);

            float fog = 1.0 - exp(-dist / 900.0);
            vec3 horizon = skyColor(normalize(vec3(-toCam.x, 0.02, -toCam.z)), false);
            col = mix(col, horizon, clamp(fog, 0.0, 1.0));
            float alpha = density * (1.0 - smoothstep(0.75, 1.0, fog)) * 0.96;
            gl_FragColor = vec4(col * alpha, alpha);
        }
    `;

    // Grid with quadratic spacing: dense near the centre, sparse at the horizon
    function createRadialOceanMesh(device, n = 160, extent = 950) {
        const positions = [];
        const indices = [];
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                const u = (i / n) * 2 - 1;
                const v = (j / n) * 2 - 1;
                const x = Math.sign(u) * Math.pow(Math.abs(u), 2.3) * extent;
                const z = Math.sign(v) * Math.pow(Math.abs(v), 2.3) * extent;
                positions.push(x, 0, z);
            }
        }
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const a = j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
        const mesh = new pc.Mesh(device);
        mesh.setPositions(positions);
        mesh.setIndices(indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        mesh.aabb = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(5000, 50, 5000));
        return mesh;
    }

    function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
    function vnoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }
    function fbm(x, y, o = 5) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { v += a * vnoise(x * f, y * f); f *= 2.05; a *= 0.5; } return v; }

    function createIslandMesh(device, radius, height, seed) {
        const n = 72;
        const positions = [], colors = [], indices = [];
        const hs = [];
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                const x = (i / n * 2 - 1) * radius;
                const z = (j / n * 2 - 1) * radius;
                const r = Math.hypot(x, z) / radius;
                const warp = fbm(x * 0.03 + seed, z * 0.03 - seed, 4);
                const base = Math.max(0, 1 - r * (0.85 + warp * 0.45));
                const ridge = 1 - Math.abs(fbm(x * 0.06 + seed * 2, z * 0.06, 4) * 2 - 1);
                let h = Math.pow(base, 1.7) * height * (0.65 + ridge * 0.55) - 2.2;
                h += (fbm(x * 0.22, z * 0.22 + seed, 3) - 0.5) * 1.2 * base;
                positions.push(x, h, z);
                hs.push(h);
            }
        }
        for (let k = 0; k < hs.length; k++) {
            const h = hs[k];
            const t = h / height;
            let c;
            if (h < 0.6) c = [196, 178, 132];                       // wet sand / beach
            else if (t < 0.45) c = [48 + t * 40, 92 + t * 30, 38];  // tropical forest
            else if (t < 0.72) c = [84, 96, 62];                    // scrub
            else c = [104, 98, 92];                                 // volcanic rock
            const n2 = 0.85 + hash(k * 0.37, seed) * 0.3;
            colors.push(Math.min(255, c[0] * n2), Math.min(255, c[1] * n2), Math.min(255, c[2] * n2), 255);
        }
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const a = j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
        const normals = pc.calculateNormals(positions, indices);
        const mesh = new pc.Mesh(device);
        mesh.setPositions(positions);
        mesh.setNormals(normals);
        mesh.setColors32(new Uint8Array(colors.map(v => Math.floor(v))));
        mesh.setIndices(indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        mesh.topY = hs[Math.floor(n / 2) * (n + 1) + Math.floor(n / 2)];
        return mesh;
    }

    function create(app, parent) {
        const device = app.graphicsDevice;
        const group = new pc.Entity('SurfaceEnvironment');
        parent.addChild(group);

        const attrs = { aPosition: pc.SEMANTIC_POSITION };
        const skyShader = pc.createShaderFromCode(device, VS_WORLD, FS_SKY, 'SurfaceSkyDome', attrs);
        const oceanShader = pc.createShaderFromCode(device, VS_OCEAN, FS_OCEAN, 'SurfaceGerstnerOcean', attrs);
        const cloudShader = pc.createShaderFromCode(device, VS_WORLD, FS_CLOUDS, 'SurfaceCloudDeck', attrs);

        const skyMat = new pc.Material();
        skyMat.shader = skyShader;
        skyMat.cull = pc.CULLFACE_NONE;
        skyMat.depthWrite = true;
        skyMat.update();

        const oceanMat = new pc.Material();
        oceanMat.shader = oceanShader;
        oceanMat.cull = pc.CULLFACE_NONE;
        oceanMat.update();

        const cloudMat = new pc.Material();
        cloudMat.shader = cloudShader;
        cloudMat.cull = pc.CULLFACE_NONE;
        cloudMat.blendType = pc.BLEND_PREMULTIPLIED;
        cloudMat.depthWrite = false;
        cloudMat.update();

        const sky = new pc.Entity('SkyDome');
        sky.addComponent('render', { type: 'sphere', material: skyMat, castShadows: false, receiveShadows: false });
        sky.setLocalScale(4200, 4200, 4200);
        group.addChild(sky);

        const oceanMesh = createRadialOceanMesh(device);
        const oceanMI = new pc.MeshInstance(oceanMesh, oceanMat);
        oceanMI.cull = false;
        const ocean = new pc.Entity('GerstnerOcean');
        ocean.addComponent('render', { meshInstances: [oceanMI], castShadows: false, receiveShadows: false });
        group.addChild(ocean);

        const clouds = new pc.Entity('CloudDeck');
        clouds.addComponent('render', { type: 'plane', material: cloudMat, castShadows: false, receiveShadows: false });
        clouds.setLocalScale(2400, 1, 2400);
        clouds.setLocalPosition(0, 150, 0);
        group.addChild(clouds);

        // Islands
        const islandMat = new pc.StandardMaterial();
        islandMat.diffuse = new pc.Color(1, 1, 1);
        islandMat.diffuseVertexColor = true;
        islandMat.useMetalness = true;
        islandMat.metalness = 0.0;
        islandMat.gloss = 0.22;
        islandMat.update();

        const islands = [];
        const addIsland = (name, x, z, radius, height, seed) => {
            const mesh = createIslandMesh(device, radius, height, seed);
            const e = new pc.Entity(name);
            e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, islandMat)], castShadows: false, receiveShadows: false });
            e.setLocalPosition(x, 0, z);
            group.addChild(e);
            islands.push({ entity: e, x, z, radius, height, topY: mesh.topY });
            return e;
        };
        addIsland('VolcanicIslandMain', -60, -150, 70, 34, 1.7);
        addIsland('VolcanicIslandEast', 240, -330, 95, 46, 5.3);
        addIsland('AtollWest', -330, -260, 55, 12, 9.1);

        // Distant recovery ship silhouette (visible in the success aftermath)
        const shipMat = new pc.StandardMaterial();
        shipMat.diffuse = new pc.Color(0.32, 0.35, 0.38);
        shipMat.useMetalness = true; shipMat.metalness = 0.3; shipMat.gloss = 0.4;
        shipMat.update();
        const ship = new pc.Entity('RecoveryShip');
        group.addChild(ship);
        const shipPart = (type, pos, scale) => {
            const p = new pc.Entity();
            p.addComponent('render', { type, material: shipMat, castShadows: false, receiveShadows: false });
            p.setLocalPosition(pos[0], pos[1], pos[2]);
            p.setLocalScale(scale[0], scale[1], scale[2]);
            ship.addChild(p);
        };
        shipPart('box', [0, 1.6, 0], [46, 5, 9]);
        shipPart('box', [-6, 6, 0], [14, 5, 7]);
        shipPart('box', [-7, 10.5, 0], [6, 4, 5]);
        shipPart('cylinder', [-7, 15, 0], [0.6, 6, 0.6]);
        const navMat = new pc.StandardMaterial();
        navMat.emissive = new pc.Color(1, 0.25, 0.2); navMat.emissiveIntensity = 4; navMat.update();
        const nav = new pc.Entity('ShipNavLight');
        nav.addComponent('render', { type: 'sphere', material: navMat, castShadows: false, receiveShadows: false });
        nav.setLocalPosition(-7, 18.4, 0);
        nav.setLocalScale(0.9, 0.9, 0.9);
        ship.addChild(nav);
        ship.setLocalPosition(-210, 0, -520);
        ship.setLocalEulerAngles(0, 18, 0);

        const mats = [skyMat, oceanMat, cloudMat];
        const state = {
            preset: null,
            dye: new Float32Array([0, 0, 0, 0]),
            origin: new Float32Array([0, 0, 0])
        };

        function setPreset(name) {
            const p = PRESETS[name] || PRESETS.day;
            state.preset = p;
            const len = Math.hypot(p.sunDir[0], p.sunDir[1], p.sunDir[2]);
            const sd = [p.sunDir[0] / len, p.sunDir[1] / len, p.sunDir[2] / len];
            mats.forEach(m => {
                m.setParameter('uSunDir', sd);
                m.setParameter('uZenith', p.zenith);
                m.setParameter('uHorizon', p.horizon);
                m.setParameter('uSunColor', p.sunColor);
                m.setParameter('uHaze', p.haze);
            });
            oceanMat.setParameter('uDeep', p.deep);
            oceanMat.setParameter('uScatter', p.scatter);
            oceanMat.setParameter('uFogDist', name === 'overcast' ? 420 : 620);
            cloudMat.setParameter('uCover', p.cloudCover);
            cloudMat.setParameter('uCloudLit', p.cloudLit);
            cloudMat.setParameter('uCloudShade', p.cloudShade);
            return { sunDir: sd, preset: p };
        }

        function setDye(x, z, radius, strength) {
            state.dye[0] = x; state.dye[1] = z; state.dye[2] = radius; state.dye[3] = strength;
            oceanMat.setParameter('uDye', state.dye);
        }

        function update(dt, time, cameraEntity) {
            const cp = cameraEntity.getPosition();
            sky.setPosition(cp.x, cp.y, cp.z);
            // Snap ocean grid to 8m steps (waves are world-space so this never swims)
            state.origin[0] = Math.round(cp.x / 8) * 8;
            state.origin[2] = Math.round(cp.z / 8) * 8;
            oceanMat.setParameter('uOrigin', state.origin);
            oceanMat.setParameter('uTime', time);
            cloudMat.setParameter('uTime', time);
            const c = clouds.getLocalPosition();
            clouds.setLocalPosition(Math.round(cp.x / 50) * 50, c.y, Math.round(cp.z / 50) * 50);
            nav.enabled = Math.sin(time * 4.2) > 0.2;
        }

        // Analytic wave height (matches the vertex shader) for buoyancy
        const WAVES = [[1.0, 0.35, 0.16, 58.0], [0.6, -0.8, 0.14, 31.0], [-0.4, 1.0, 0.12, 17.0], [0.9, 0.9, 0.10, 8.5]];
        function waveHeight(x, z, time) {
            let h = 0;
            for (const w of WAVES) {
                const k = 6.28318 / w[3];
                const c = Math.sqrt(9.8 / k);
                const l = Math.hypot(w[0], w[1]);
                const f = k * ((w[0] / l) * x + (w[1] / l) * z - c * time);
                h += (w[2] / k) * Math.sin(f);
            }
            return h;
        }

        setPreset('day');
        setDye(0, 0, 0, 0);
        oceanMat.setParameter('uOrigin', state.origin);
        oceanMat.setParameter('uTime', 0);
        cloudMat.setParameter('uTime', 0);

        return { group, sky, ocean, clouds, islands, ship, setPreset, setDye, update, waveHeight, PRESETS };
    }

    window.OrbitalGame.SurfaceEnv = { create, PRESETS };
})();

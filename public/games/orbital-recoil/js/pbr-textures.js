window.OrbitalGame = window.OrbitalGame || {};

(function () {
    function hash2(x, y) {
        let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return n - Math.floor(n);
    }

    function smoothNoise(x, y) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);
        const a = hash2(ix, iy);
        const b = hash2(ix + 1, iy);
        const c = hash2(ix, iy + 1);
        const d = hash2(ix + 1, iy + 1);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }

    function fbm(x, y, octaves = 5) {
        let val = 0;
        let amp = 0.5;
        let freq = 1.0;
        for (let i = 0; i < octaves; i++) {
            val += amp * smoothNoise(x * freq, y * freq);
            freq *= 2.03;
            amp *= 0.5;
        }
        return val;
    }

    // Ridged multifractal noise for realistic mountain chains & tectonic ranges
    function ridgedFbm(x, y, octaves = 4) {
        let val = 0;
        let amp = 0.5;
        let freq = 1.0;
        let weight = 1.0;
        for (let i = 0; i < octaves; i++) {
            let n = 1.0 - Math.abs(smoothNoise(x * freq, y * freq) * 2.0 - 1.0);
            n = n * n * weight;
            weight = Math.max(0.0, Math.min(1.0, n * 2.0));
            val += n * amp;
            freq *= 2.1;
            amp *= 0.5;
        }
        return val;
    }

    function canvasToTexture(device, canvas, options = {}) {
        const tex = new pc.Texture(device, {
            width: canvas.width,
            height: canvas.height,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: options.mipmaps !== false,
            minFilter: options.mipmaps === false ? pc.FILTER_LINEAR : pc.FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: options.clamp ? pc.ADDRESS_CLAMP_TO_EDGE : pc.ADDRESS_REPEAT,
            addressV: options.clamp ? pc.ADDRESS_CLAMP_TO_EDGE : pc.ADDRESS_REPEAT,
            anisotropy: Math.min(8, device.maxAnisotropy || 1),
            projection: options.projection || pc.TEXTUREPROJECTION_NONE
        });
        tex.setSource(canvas);
        return tex;
    }

    function heightCanvasToNormalTexture(device, heightCanvas, strength = 3.0) {
        const w = heightCanvas.width;
        const h = heightCanvas.height;
        const srcCtx = heightCanvas.getContext('2d');
        const srcData = srcCtx.getImageData(0, 0, w, h).data;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        const outCtx = outCanvas.getContext('2d');
        const outImg = outCtx.createImageData(w, h);
        const dst = outImg.data;

        const sample = (x, y) => {
            const wx = (x + w) % w;
            const wy = (y + h) % h;
            return srcData[(wy * w + wx) * 4] / 255.0;
        };

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const tl = sample(x - 1, y - 1);
                const t  = sample(x,     y - 1);
                const tr = sample(x + 1, y - 1);
                const l  = sample(x - 1, y);
                const r  = sample(x + 1, y);
                const bl = sample(x - 1, y + 1);
                const b  = sample(x,     y + 1);
                const br = sample(x + 1, y + 1);

                const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
                const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

                let nx = -dx * strength;
                let ny = -dy * strength;
                let nz = 1.0;
                const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
                nx *= invLen;
                ny *= invLen;
                nz *= invLen;

                const idx = (y * w + x) * 4;
                dst[idx]     = Math.floor((nx * 0.5 + 0.5) * 255);
                dst[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
                dst[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
                dst[idx + 3] = 255;
            }
        }
        outCtx.putImageData(outImg, 0, 0);
        return canvasToTexture(device, outCanvas);
    }

    // Reuse a packed linear response map for cavity occlusion (R) and gloss (G).
    // Recesses stay dark while broad plates retain soft, varied reflections.
    function surfaceResponseTexture(device, heightCanvas, cavity = 0.5, glossVariation = 0.16) {
        const w = heightCanvas.width, h = heightCanvas.height;
        const heightData = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const height = heightData[i] / 255;
                const grain = hash2(x + 19.7, y + 4.3);
                img.data[i] = Math.round(255 * (1 - Math.max(0, 0.52 - height) * cavity));
                img.data[i + 1] = Math.round(255 * (1 - glossVariation * (0.32 + grain * 0.5 + (1 - height) * 0.18)));
                img.data[i + 2] = 255;
                img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return canvasToTexture(device, c);
    }

    function applySurfaceResponse(device, material, heightCanvas, cavity, glossVariation) {
        const response = surfaceResponseTexture(device, heightCanvas, cavity, glossVariation);
        material.aoMap = response;
        material.aoMapChannel = 'r';
        material.glossMap = response;
        material.glossMapChannel = 'g';
    }

    // =========================================================================
    // DEEP SPACE SKYBOX & IBL ENVIRONMENT (MILKY WAY + NEBULAE + STARFIELD)
    // =========================================================================
    function setupOrbitalEnvironment(app) {
        const device = app.graphicsDevice;
        const W = 2048;
        const H = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        // 1. Deep Cosmic Vacuum Backdrop with subtle Earth Albedo Bounce at Nadir
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0.0, '#000103');
        bgGrad.addColorStop(0.50, '#010308');
        bgGrad.addColorStop(0.76, '#020815');
        bgGrad.addColorStop(0.92, '#051632');
        bgGrad.addColorStop(1.0, '#092652');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // 2. Milky Way Galactic Plane with Luminous Star Clouds & Dark Interstellar Dust Lanes
        const imgData = ctx.getImageData(0, 0, W, H);
        const data = imgData.data;

        for (let y = 0; y < H * 0.88; y++) {
            const v = y / H;
            for (let x = 0; x < W; x++) {
                const u = x / W;
                // Tilted sinusoidal galactic equator
                const galCenterY = 0.42 + Math.sin(u * Math.PI * 2.0 - 0.8) * 0.18;
                const distFromPlane = Math.abs(v - galCenterY);

                if (distFromPlane < 0.24) {
                    const bandMask = Math.exp(-Math.pow(distFromPlane / 0.095, 2.0));
                    const warp = fbm(u * 9.0, v * 9.0, 3) * 0.15;
                    const cloudNoise = fbm(u * 14.0 + warp, v * 14.0 - warp, 5);
                    // Dark rift dust lane carving through the center of the Milky Way
                    const dustNoise = ridgedFbm(u * 18.0 + 3.1, v * 18.0 + 1.7, 4);
                    const dustLane = Math.exp(-Math.pow(distFromPlane / 0.032, 2.0)) * Math.max(0, (dustNoise - 0.35) * 1.45);

                    const intensity = Math.max(0, (cloudNoise * 1.15 - 0.32) * bandMask * (1.0 - dustLane * 0.82));
                    if (intensity > 0.005) {
                        const idx = (y * W + x) * 4;
                        // Galactic core region (around u = 0.28) is warmer golden-amber; outer arms are cool sapphire-violet
                        const coreProximity = Math.exp(-Math.pow((u - 0.28) / 0.16, 2.0));
                        const rAdd = intensity * (38 + coreProximity * 58);
                        const gAdd = intensity * (46 + coreProximity * 36);
                        const bAdd = intensity * (82 + coreProximity * 18);

                        data[idx]     = Math.min(255, data[idx]     + rAdd);
                        data[idx + 1] = Math.min(255, data[idx + 1] + gAdd);
                        data[idx + 2] = Math.min(255, data[idx + 2] + bAdd);
                    }
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // 3. H-II Emission Nebulae (Rose/Magenta & Cyan Oxygen-III Veil Filaments)
        for (let i = 0; i < 45; i++) {
            const u = (i * 0.6180339887) % 1.0;
            const galY = 0.42 + Math.sin(u * Math.PI * 2.0 - 0.8) * 0.18;
            const x = u * W;
            const y = (galY + (hash2(i, 9.1) - 0.5) * 0.14) * H;
            const rad = 18 + hash2(i, 2.3) * 65;
            const g = ctx.createRadialGradient(x, y, 1, x, y, rad);
            if (i % 3 === 0) {
                g.addColorStop(0, 'rgba(220, 75, 130, 0.06)');
                g.addColorStop(0.5, 'rgba(140, 40, 95, 0.025)');
            } else {
                g.addColorStop(0, 'rgba(45, 165, 255, 0.055)');
                g.addColorStop(0.5, 'rgba(20, 85, 180, 0.02)');
            }
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
        }

        // 4. Multi-Magnitude Astronomical Starfield (Blackbody Color Temperatures)
        const starPalette = [
            '#9bb8ff', // O/B Blue-white giant
            '#cad8ff', // B/A White-blue
            '#f8f7ff', // A Pure white
            '#fff4ea', // F/G Yellow-white
            '#ffd2a1', // K Orange star
            '#ffcc6f'  // M Red-gold giant
        ];

        // Faint background stars (concentrated near Milky Way band)
        for (let i = 0; i < 9500; i++) {
            const u = hash2(i, 1.13);
            const galY = 0.42 + Math.sin(u * Math.PI * 2.0 - 0.8) * 0.18;
            const spread = (hash2(i, 2.71) - 0.5) + (hash2(i, 3.19) - 0.5);
            const v = (i < 5500)
                ? Math.max(0.01, Math.min(0.92, galY + spread * 0.18))
                : hash2(i, 4.93) * 0.92;

            const x = u * W;
            const y = v * H;
            const col = starPalette[i % starPalette.length];
            const mag = hash2(i, 7.31);

            ctx.fillStyle = col;
            if (mag > 0.992) {
                // Bright Magnitude-1 Navigation Star with Crisp Cross-Diffraction Spike
                ctx.globalAlpha = 0.98;
                ctx.fillRect(x - 1, y - 1, 2.6, 2.6);
                ctx.globalAlpha = 0.35;
                ctx.fillRect(x - 5, y, 10, 1);
                ctx.fillRect(x, y - 5, 1, 10);
            } else if (mag > 0.92) {
                ctx.globalAlpha = 0.75 + (mag - 0.92) * 3.0;
                ctx.fillRect(x, y, 1.6, 1.6);
            } else {
                ctx.globalAlpha = 0.18 + mag * 0.55;
                ctx.fillRect(x, y, 1.0, 1.0);
            }
        }
        ctx.globalAlpha = 1.0;

        // 5. Astrophysical Solar Disk & Corona (for PBR Metallic Specular Reflections)
        const sunX = 1420;
        const sunY = 260;
        const sunGrad = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 175);
        sunGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
        sunGrad.addColorStop(0.06, 'rgba(255, 250, 230, 0.95)');
        sunGrad.addColorStop(0.22, 'rgba(255, 210, 140, 0.32)');
        sunGrad.addColorStop(0.55, 'rgba(120, 175, 255, 0.06)');
        sunGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sunGrad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 175, 0, Math.PI * 2);
        ctx.fill();

        const equirectTex = canvasToTexture(device, canvas, {
            mipmaps: false,
            clamp: true,
            projection: pc.TEXTUREPROJECTION_EQUIRECT
        });

        try {
            const skybox = pc.EnvLighting.generateSkyboxCubemap(equirectTex, 1024);
            const lighting = pc.EnvLighting.generateLightingSource(equirectTex);
            const envAtlas = pc.EnvLighting.generateAtlas(lighting);
            app.scene.envAtlas = envAtlas;
            app.scene.skybox = skybox;
            lighting.destroy();
        } catch (err) {
            console.warn('EnvLighting fallback:', err);
        }

        app.scene.skyboxIntensity = 0.92;
        app.scene.skyboxMip = 0;
        app.scene.exposure = 1.08;
        app.scene.gammaCorrection = pc.GAMMA_SRGB;
        // Prefer ACES2 while retaining compatibility with older engine builds.
        app.scene.toneMapping = pc.TONEMAP_ACES2 !== undefined ? pc.TONEMAP_ACES2 : pc.TONEMAP_ACES;
        app.scene.ambientLight = new pc.Color(0.075, 0.088, 0.11);
    }

    // =========================================================================
    // CUSTOM WEBGL2 GLSL SHADERS FOR PHOTOREALISTIC EARTH & ATMOSPHERE
    // =========================================================================
    function createEarthCustomMaterials(app, mats) {
        const device = app.graphicsDevice;

        // Generate 2048x1024 High-Resolution Earth Day/Water Mask, Cloud/City-Lights Mask, and Normal Map
        const w = 2048, h = 1024;
        const dayC = document.createElement('canvas'); dayC.width = w; dayC.height = h;
        const dayCtx = dayC.getContext('2d');
        const dayImg = dayCtx.createImageData(w, h);
        const dData = dayImg.data;

        const cloudCityC = document.createElement('canvas'); cloudCityC.width = w; cloudCityC.height = h;
        const ccCtx = cloudCityC.getContext('2d');
        const ccImg = ccCtx.createImageData(w, h);
        const ccData = ccImg.data;

        const heightC = document.createElement('canvas'); heightC.width = 1024; heightC.height = 512;
        const hCtx = heightC.getContext('2d');
        const hImg = hCtx.createImageData(1024, 512);
        const hData = hImg.data;

        for (let y = 0; y < h; y++) {
            const lat = (y / h) - 0.5; // -0.5 (North Pole) to +0.5 (South Pole)
            const absLat = Math.abs(lat) * 2.0;

            for (let x = 0; x < w; x++) {
                const lon = x / w;
                const idx = (y * w + x) * 4;

                // Domain-warped tectonic continental plates
                const warpX = fbm(lon * 4.5 + 1.2, lat * 4.5 + 3.4, 3) * 0.18;
                const warpY = fbm(lon * 4.5 + 7.8, lat * 4.5 + 2.1, 3) * 0.18;
                const contBase = fbm(lon * 5.2 + warpX + 0.65, lat * 5.2 + warpY + 1.85, 5);
                const ridge = ridgedFbm(lon * 16.0 + warpX * 2.0, lat * 16.0 + warpY * 2.0, 4);
                const detail = fbm(lon * 36.0, lat * 36.0, 3);

                // Bias slightly so the hemisphere facing the camera has dramatic coastlines, islands, and seas
                const elevation = contBase * 0.72 + ridge * 0.18 + detail * 0.10 - (absLat > 0.88 ? 0.08 : 0.0);

                let r, g, b, waterSpecMask = 0, cityLight = 0, elevHeight = 30;

                // 1. Polar Ice Caps & Sea Ice Pack (confined strictly to extreme poles >85 deg latitude)
                if (absLat > 0.95 - detail * 0.03) {
                    r = 185; g = 202; b = 220;
                    waterSpecMask = 40;
                    elevHeight = 160;
                }
                // 2. Deep Oceans, Bathymetric Ridges & Turquoise Coral Shelves
                else if (elevation < 0.495) {
                    const depthNorm = Math.max(0, Math.min(1, elevation / 0.495));
                    const shelf = Math.pow(Math.max(0, (elevation - 0.425) / 0.07), 2.2);
                    const reef = Math.pow(Math.max(0, (elevation - 0.472) / 0.023), 1.6);

                    r = Math.floor(3 + depthNorm * 7 + shelf * 16 + reef * 34);
                    g = Math.floor(14 + depthNorm * 28 + shelf * 68 + reef * 112);
                    b = Math.floor(42 + depthNorm * 62 + shelf * 88 + reef * 78);
                    waterSpecMask = 245;
                    elevHeight = 25;
                }
                // 3. Continents (Rainforests, Savannas, Arid Deserts, Mountain Ranges, Snow Peaks)
                else {
                    const landH = Math.min(1.0, (elevation - 0.495) / 0.34);
                    const moisture = fbm(lon * 9.5 + 5.2, lat * 9.5 + 1.9, 4);
                    const temp = 1.0 - absLat;

                    if (landH > 0.64 || (landH > 0.44 && ridge > 0.68)) {
                        // High Alpine Mountain Chains & Snow-capped Peaks
                        const snow = Math.max(0, Math.min(1, (landH - 0.58) * 2.8));
                        r = Math.floor(108 + snow * 98);
                        g = Math.floor(98 + snow * 106);
                        b = Math.floor(88 + snow * 116);
                    } else if (moisture < 0.43 && temp > 0.36) {
                        // Sahara / Arabian / Australian Golden-Ochre Deserts & Red Erg Dunes
                        const dune = detail * 0.8 + ridge * 0.2;
                        r = Math.floor(178 + dune * 48);
                        g = Math.floor(128 + dune * 38);
                        b = Math.floor(72 + dune * 24);
                    } else if (absLat > 0.72) {
                        // Boreal Taiga & Tundra
                        r = Math.floor(46 + detail * 28);
                        g = Math.floor(68 + detail * 28);
                        b = Math.floor(44 + detail * 20);
                    } else {
                        // Tropical Rainforests, Temperate Forests & Alluvial Plains
                        const lush = Math.max(0, moisture - 0.38) * 1.65;
                        r = Math.floor(24 + (1.0 - lush) * 56 + landH * 28);
                        g = Math.floor(68 + lush * 58 + detail * 24 - landH * 12);
                        b = Math.floor(22 + lush * 18 + landH * 14);
                    }

                    waterSpecMask = 10;
                    elevHeight = Math.min(255, Math.floor(65 + landH * 150 + ridge * 40));

                    // Metropolitan Night City Lights along coastlines, river basins, and temperate belts
                    if (absLat < 0.68 && landH < 0.38) {
                        const coastalBonus = landH < 0.09 ? 0.36 : 0.0;
                        const urbanCluster = fbm(lon * 28.0 + 3.7, lat * 28.0 + 8.1, 3);
                        const streetGrid = smoothNoise(lon * 190.0, lat * 190.0);
                        if (urbanCluster + coastalBonus > 0.64) {
                            const hubStrength = Math.min(1.0, (urbanCluster + coastalBonus - 0.64) * 4.4);
                            cityLight = Math.min(255, Math.floor(hubStrength * (0.38 + Math.pow(streetGrid, 2.0) * 0.95) * 255));
                        }
                    }
                }

                // Always keep alpha = 255 to prevent HTML5 Canvas2D premultiplied-alpha quantization/zeroing!
                dData[idx]     = r;
                dData[idx + 1] = g;
                dData[idx + 2] = b;
                dData[idx + 3] = 255;

                // Swirling Meteorological Cloud Systems (Cyclones, Trade-Wind Bands & Frontal Systems)
                const coriolis = Math.sin(lat * Math.PI * 3.5) * 0.25;
                const vortexX = fbm(lon * 7.5 + coriolis, lat * 7.5, 4);
                const vortexY = fbm(lon * 7.5 + 4.2, lat * 7.5 - coriolis, 4);
                const cloudMacro = fbm(lon * 10.5 + vortexX * 0.42, lat * 10.5 + vortexY * 0.42, 5);
                const cloudFine = ridgedFbm(lon * 32.0 + vortexX * 0.8, lat * 32.0 + vortexY * 0.8, 3);

                // Tropical cyclone spiral around (lon = 0.48, lat = -0.12)
                const dxCyc = (lon - 0.48) * 2.0;
                const dyCyc = (lat + 0.12);
                const rCyc = Math.hypot(dxCyc, dyCyc);
                let cycVal = 0.0;
                if (rCyc < 0.16 && rCyc > 0.012) {
                    const angle = Math.atan2(dyCyc, dxCyc) + rCyc * 26.0;
                    const arms = Math.sin(angle * 2.0) * 0.5 + 0.5;
                    const eyeWall = Math.exp(-Math.pow((rCyc - 0.045) / 0.055, 2.0));
                    cycVal = eyeWall * (0.65 + arms * 0.35);
                }

                const rawCloud = Math.max(cycVal, (cloudMacro * 0.78 + cloudFine * 0.22 - 0.45) * 2.25);
                const cloudDensity = Math.max(0, Math.min(255, Math.floor(Math.pow(Math.max(0, rawCloud), 1.35) * 255)));

                // Pack R = cloudDensity, G = cityLight, B = waterSpecMask, A = 255 (lossless!)
                ccData[idx]     = cloudDensity;
                ccData[idx + 1] = cityLight;
                ccData[idx + 2] = waterSpecMask;
                ccData[idx + 3] = 255;

                // Downsample 2x2 into height map for normal generation
                if ((x & 1) === 0 && (y & 1) === 0) {
                    const hIdx = ((y >> 1) * 1024 + (x >> 1)) * 4;
                    const combinedH = Math.min(255, elevHeight + Math.floor(cloudDensity * 0.25));
                    hData[hIdx] = hData[hIdx + 1] = hData[hIdx + 2] = combinedH;
                    hData[hIdx + 3] = 255;
                }
            }
        }

        dayCtx.putImageData(dayImg, 0, 0);
        ccCtx.putImageData(ccImg, 0, 0);
        hCtx.putImageData(hImg, 0, 0);

        const dayTex = canvasToTexture(device, dayC);
        const cloudCityTex = canvasToTexture(device, cloudCityC);
        const normalTex = heightCanvasToNormalTexture(device, heightC, 3.4);

        // ---------------------------------------------------------------------
        // SHADER 1: Photorealistic Earth Planet Surface + Clouds + Terminator
        // ---------------------------------------------------------------------
        const earthVert = `
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            attribute vec2 aUv0;

            uniform mat4 matrix_model;
            uniform mat4 matrix_viewProjection;
            uniform mat3 matrix_normal;

            varying vec3 vPositionW;
            varying vec3 vNormalW;
            varying vec2 vUv0;

            void main(void) {
                vec4 worldPos = matrix_model * vec4(aPosition, 1.0);
                vPositionW = worldPos.xyz;
                vNormalW = normalize(matrix_normal * aNormal);
                vUv0 = aUv0;
                gl_Position = matrix_viewProjection * worldPos;
            }
        `;

        const earthFrag = `
            precision highp float;

            varying vec3 vPositionW;
            varying vec3 vNormalW;
            varying vec2 vUv0;

            uniform sampler2D uDayTex;
            uniform sampler2D uCloudCityTex;
            uniform sampler2D uNormalTex;
            uniform vec3 view_position;
            uniform vec3 uSunDir;
            uniform float uTime;

            float gpuHash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            float gpuNoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                float a = gpuHash(i);
                float b = gpuHash(i + vec2(1.0, 0.0));
                float c = gpuHash(i + vec2(0.0, 1.0));
                float d = gpuHash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
            }

            float gpuFbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                for (int i = 0; i < 4; i++) {
                    v += a * gpuNoise(p);
                    p = p * 2.07 + vec2(17.3, 9.2);
                    a *= 0.5;
                }
                return v;
            }

            void main(void) {
                vec3 N = normalize(vNormalW);
                vec3 V = normalize(view_position - vPositionW);
                vec3 L = normalize(uSunDir);

                // Per-pixel GPU fractal coastline & terrain domain-warping (eliminates any close-up texel blockiness!)
                vec2 microWarp = vec2(
                    gpuFbm(vUv0 * 88.0 + vec2(1.7, 3.2)) - 0.5,
                    gpuFbm(vUv0 * 88.0 + vec2(6.4, 8.9)) - 0.5
                ) * 0.0055;
                vec2 fineWarp = vec2(
                    gpuNoise(vUv0 * 340.0) - 0.5,
                    gpuNoise(vUv0 * 340.0 + vec2(11.3, 4.7)) - 0.5
                ) * 0.0016;
                vec2 terrainUv = vUv0 + microWarp + fineWarp;

                // Sample Day Albedo & lossless packed masks (R=cloud, G=city, B=waterMask)
                vec4 daySample = texture2D(uDayTex, terrainUv);
                vec4 maskSample = texture2D(uCloudCityTex, terrainUv);
                float waterMask = smoothstep(0.35, 0.65, maskSample.b);

                // Per-pixel micro-relief & biome texture variation
                float microDetail = gpuFbm(terrainUv * 240.0);
                float microRidge = 1.0 - abs(gpuNoise(terrainUv * 420.0) * 2.0 - 1.0);
                vec3 surfaceCol = pow(daySample.rgb, vec3(1.16)) * 0.64;
                surfaceCol *= mix(0.84 + microDetail * 0.30 + microRidge * 0.12, 0.94 + microDetail * 0.12, waterMask);

                // Perturb normal with terrain & per-pixel GPU micro-bump
                vec3 relief = texture2D(uNormalTex, terrainUv).xyz * 2.0 - 1.0;
                vec2 gpuGrad = vec2(microRidge - 0.5, microDetail - 0.5) * (1.0 - waterMask * 0.85);
                vec3 bumpedN = normalize(N + vec3(relief.x + gpuGrad.x * 0.6, relief.y + gpuGrad.y * 0.6, 0.0) * 0.32);

                // Animated Cloud Layer + Per-pixel GPU Cumulus/Cyclone Wisps + Surface Drop Shadow
                vec2 baseCloudUv = vec2(fract(vUv0.x + uTime * 0.0008), vUv0.y);
                vec2 cloudSwirl = vec2(
                    gpuFbm(baseCloudUv * 54.0 + vec2(0.0, uTime * 0.002)) - 0.5,
                    gpuFbm(baseCloudUv * 54.0 + vec2(4.2, -uTime * 0.002)) - 0.5
                ) * 0.008;
                vec2 cloudUv = baseCloudUv + cloudSwirl;
                vec2 shadowUv = cloudUv - vec2(L.x, -L.y) * 0.0042;

                float macroCloud = texture2D(uCloudCityTex, cloudUv).r;
                float gpuCloudDetail = gpuFbm(cloudUv * 135.0);
                float cloudVal = clamp(smoothstep(0.18, 0.78, macroCloud * 0.82 + gpuCloudDetail * 0.46), 0.0, 1.0);

                float macroShadow = texture2D(uCloudCityTex, shadowUv).r;
                float gpuShadowDetail = gpuFbm(shadowUv * 135.0);
                float cloudShadow = clamp(smoothstep(0.20, 0.80, macroShadow * 0.82 + gpuShadowDetail * 0.46), 0.0, 1.0);

                // Dark cloud shadows on ocean and continents
                surfaceCol *= (1.0 - cloudShadow * 0.68);

                // Day / Twilight / Night Terminator Physics
                float NdotL = dot(bumpedN, L);
                float smoothNdotL = dot(N, L);
                float cloudDayFactor = smoothstep(-0.12, 0.24, smoothNdotL);

                // Sunset / Sunrise Golden-Crimson Atmospheric Scattering Band at Terminator
                float twilightBand = exp(-pow((smoothNdotL - 0.02) / 0.14, 2.0));
                vec3 sunsetTint = vec3(0.92, 0.32, 0.07) * twilightBand;

                // Pinpoint Ocean Solar Specular Glint
                vec3 H = normalize(L + V);
                float NdotH = max(dot(bumpedN, H), 0.0);
                float specTight = pow(NdotH, 160.0) * 0.90;
                float specBroad = pow(NdotH, 28.0) * 0.18;
                vec3 sunGlint = vec3(1.0, 0.88, 0.68) * (specTight + specBroad) * waterMask * (1.0 - cloudVal * 0.92) * max(0.0, smoothNdotL);

                // Combine Day Surface + Crisp Volumetric Clouds
                float cloudReliefShade = 0.74 + 0.26 * max(0.0, NdotL) + (gpuCloudDetail - 0.5) * 0.16;
                vec3 litSurface = surfaceCol * (max(0.0, NdotL) * 0.96 + sunsetTint * 0.48) + sunGlint;
                vec3 cloudColor = mix(vec3(0.66, 0.69, 0.72) * cloudReliefShade, vec3(0.84, 0.40, 0.16), twilightBand * 0.78) * cloudDayFactor;
                vec3 dayFinal = mix(litSurface, cloudColor, cloudVal * 0.92);

                // Night Side: High-Resolution Golden Metropolitan City Lights & Highway Networks
                float nightFactor = smoothstep(0.08, -0.14, smoothNdotL);
                float landMask = 1.0 - waterMask;
                float urbanHub = smoothstep(0.52, 0.78, gpuFbm(terrainUv * 46.0 + vec2(2.1, 7.4)) + maskSample.g * 0.45);
                float cityGrid = pow(gpuNoise(terrainUv * 380.0), 2.2);
                float highwayWeb = pow(1.0 - abs(gpuNoise(terrainUv * 145.0) * 2.0 - 1.0), 6.0);
                float totalCity = landMask * urbanHub * clamp(cityGrid * 1.35 + highwayWeb * 0.75, 0.0, 1.0);

                vec3 cityGlow = vec3(1.0, 0.74, 0.28) * totalCity * 1.45 * (1.0 - cloudVal * 0.68);
                vec3 cloudCityScatter = vec3(0.95, 0.52, 0.16) * totalCity * cloudVal * 0.55;
                vec3 nightAmbient = surfaceCol * vec3(0.03, 0.07, 0.16) * 0.28;
                vec3 nightFinal = (nightAmbient + cityGlow + cloudCityScatter) * nightFactor;

                // Rayleigh Atmospheric Limb Scattering (strictly near the curved horizon edge!)
                float NdotV = max(dot(N, V), 0.0);
                float fresnel = pow(1.0 - NdotV, 4.2);
                vec3 rayleighDay = mix(vec3(0.05, 0.32, 0.88), vec3(0.18, 0.62, 1.0), fresnel);
                vec3 rayleighTwilight = vec3(0.92, 0.36, 0.10);
                vec3 atmoHaze = mix(rayleighDay, rayleighTwilight, twilightBand * 0.65) * fresnel * smoothstep(-0.30, 0.35, smoothNdotL);

                vec3 finalColor = dayFinal + nightFinal + atmoHaze * 0.75;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // ---------------------------------------------------------------------
        // SHADER 2: Fresnel Rayleigh/Mie Atmospheric Limb Halo (Zero Center Washout!)
        // ---------------------------------------------------------------------
        const atmoFrag = `
            precision highp float;

            varying vec3 vPositionW;
            varying vec3 vNormalW;

            uniform vec3 view_position;
            uniform vec3 uSunDir;

            void main(void) {
                vec3 N = normalize(vNormalW);
                vec3 V = normalize(view_position - vPositionW);
                vec3 L = normalize(uSunDir);

                // View-angle limb factor: 0.0 across the disc, razor-sharp peak at horizon edge
                float viewDot = abs(dot(N, V));
                float rimInner = pow(clamp(1.0 - viewDot, 0.0, 1.0), 5.5);
                float rimOuter = pow(clamp(1.0 - viewDot, 0.0, 1.0), 11.0);

                float sunDot = dot(N, L);
                float sunMask = smoothstep(-0.35, 0.35, sunDot);
                float twilight = exp(-pow((sunDot + 0.02) / 0.22, 2.0));

                // True NASA "Thin Blue Line" Stratosphere / Exosphere Gradient
                vec3 dayHalo = mix(vec3(0.04, 0.28, 0.92), vec3(0.28, 0.78, 1.0), rimOuter);
                vec3 sunsetHalo = vec3(0.95, 0.40, 0.12);
                vec3 nightAirglow = vec3(0.03, 0.11, 0.28) * 0.24;

                vec3 haloCol = mix(nightAirglow, mix(dayHalo, sunsetHalo, twilight * 0.68), sunMask);
                float alpha = (rimInner * 0.55 + rimOuter * 0.45) * (0.16 + 0.84 * sunMask);

                gl_FragColor = vec4(haloCol * alpha * 0.95, alpha);
            }
        `;

        try {
            const earthShader = pc.createShaderFromCode(device, earthVert, earthFrag, 'PhotorealEarthShader', {
                aPosition: pc.SEMANTIC_POSITION,
                aNormal: pc.SEMANTIC_NORMAL,
                aUv0: pc.SEMANTIC_TEXCOORD0
            });

            // Diagonal sun direction so the visible face shows 65% sunlit continents/oceans + 35% night city lights & twilight terminator!
            const sunDirVec = [0.92, 0.06, -0.18];

            const earthMat = new pc.Material();
            earthMat.shader = earthShader;
            earthMat.setParameter('uDayTex', dayTex);
            earthMat.setParameter('uCloudCityTex', cloudCityTex);
            earthMat.setParameter('uNormalTex', normalTex);
            earthMat.setParameter('uSunDir', sunDirVec);
            earthMat.setParameter('uTime', 0.0);
            earthMat.update();
            mats.earthSurface = earthMat;

            const atmoShader = pc.createShaderFromCode(device, earthVert, atmoFrag, 'PhotorealAtmoLimbShader', {
                aPosition: pc.SEMANTIC_POSITION,
                aNormal: pc.SEMANTIC_NORMAL,
                aUv0: pc.SEMANTIC_TEXCOORD0
            });

            const atmoMat = new pc.Material();
            atmoMat.shader = atmoShader;
            atmoMat.setParameter('uSunDir', sunDirVec);
            atmoMat.blendType = pc.BLEND_ADDITIVE;
            atmoMat.depthWrite = false;
            atmoMat.cull = pc.CULLFACE_BACK;
            atmoMat.update();
            mats.earthAtmosphere = atmoMat;
        } catch (err) {
            console.warn('Custom Earth shader fallback:', err);
            const fallbackEarth = new pc.StandardMaterial();
            fallbackEarth.diffuseMap = dayTex;
            fallbackEarth.update();
            mats.earthSurface = fallbackEarth;
            mats.earthAtmosphere = mats.createEmissive(0.05, 0.45, 1.0, 0.5);
        }

        // Separate animated cloud shell (optional subtle high-altitude wisps)
        const cloudShellMat = new pc.StandardMaterial();
        cloudShellMat.diffuse = new pc.Color(0.95, 0.98, 1.0);
        cloudShellMat.opacityMap = cloudCityTex;
        cloudShellMat.opacityMapChannel = 'r';
        cloudShellMat.opacity = 0.22;
        cloudShellMat.blendType = pc.BLEND_NORMAL;
        cloudShellMat.depthWrite = false;
        cloudShellMat.update();
        mats.earthClouds = cloudShellMat;

        // ---------------------------------------------------------------------
        // 3D MOON (LUNA) MATERIAL WITH MARE BASALT PLAINS & IMPACT CRATERS
        // ---------------------------------------------------------------------
        {
            const mw = 512, mh = 256;
            const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
            const mctx = mc.getContext('2d');
            const mimg = mctx.createImageData(mw, mh);
            const mhc = document.createElement('canvas'); mhc.width = mw; mhc.height = mh;
            const mhctx = mhc.getContext('2d');
            const mhimg = mhctx.createImageData(mw, mh);

            for (let y = 0; y < mh; y++) {
                for (let x = 0; x < mw; x++) {
                    const u = x / mw, v = y / mh;
                    const idx = (y * mw + x) * 4;
                    const mare = fbm(u * 5.0 + 2.1, v * 5.0 + 1.3, 4);
                    const craters = ridgedFbm(u * 28.0, v * 28.0, 3);
                    const base = mare < 0.47 ? (75 + mare * 90) : (135 + mare * 75);
                    const val = Math.max(30, Math.min(235, Math.floor(base + (craters - 0.5) * 45)));
                    mimg.data[idx] = val;
                    mimg.data[idx + 1] = Math.floor(val * 0.98);
                    mimg.data[idx + 2] = Math.floor(val * 0.94);
                    mimg.data[idx + 3] = 255;

                    mhimg.data[idx] = mhimg.data[idx + 1] = mhimg.data[idx + 2] = val;
                    mhimg.data[idx + 3] = 255;
                }
            }
            mctx.putImageData(mimg, 0, 0);
            mhctx.putImageData(mhimg, 0, 0);

            const moonMat = new pc.StandardMaterial();
            moonMat.diffuseMap = canvasToTexture(device, mc);
            moonMat.normalMap = heightCanvasToNormalTexture(device, mhc, 3.2);
            moonMat.bumpiness = 1.1;
            moonMat.useMetalness = false;
            moonMat.gloss = 0.12;
            moonMat.update();
            mats.moonSurface = moonMat;
        }
    }

    function createMaterialLibrary(app) {
        const device = app.graphicsDevice;
        const mats = {};

        // 1. Brushed Aerospace Titanium Hull Panels
        {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 512;
            const ctx = c.getContext('2d');

            const hc = document.createElement('canvas');
            hc.width = 512; hc.height = 512;
            const hctx = hc.getContext('2d');

            ctx.fillStyle = '#78828c';
            ctx.fillRect(0, 0, 512, 512);
            hctx.fillStyle = '#808080';
            hctx.fillRect(0, 0, 512, 512);

            for (let i = 0; i < 1800; i++) {
                const x = hash2(i, 2.8) * 512;
                const y = hash2(i, 7.6) * 512;
                const len = 20 + hash2(i, 14.3) * 70;
                const v = 115 + Math.floor(hash2(i, 9.1) * 35);
                ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},0.1)`;
                ctx.fillRect(x, y, len, 1);
                hctx.fillStyle = `rgba(${v},${v},${v},0.12)`;
                hctx.fillRect(x, y, len, 1);
            }

            ctx.strokeStyle = '#303841';
            ctx.lineWidth = 3;
            ctx.strokeRect(4, 4, 248, 248);
            ctx.strokeRect(260, 4, 248, 248);
            ctx.strokeRect(4, 260, 248, 248);
            ctx.strokeRect(260, 260, 248, 248);

            hctx.strokeStyle = '#404040';
            hctx.lineWidth = 4;
            hctx.strokeRect(4, 4, 248, 248);
            hctx.strokeRect(260, 4, 248, 248);
            hctx.strokeRect(4, 260, 248, 248);
            hctx.strokeRect(260, 260, 248, 248);

            const drawRivets = (ox, oy, w, h) => {
                ctx.strokeStyle = 'rgba(210,222,227,0.28)';
                ctx.lineWidth = 1;
                ctx.strokeRect(ox + 4, oy + 4, w - 8, h - 8);
                for (let t = 20; t < w - 10; t += 104) {
                    [[ox + t, oy + 12], [ox + t, oy + h - 12], [ox + 12, oy + t], [ox + w - 12, oy + t]].forEach(([rx, ry]) => {
                        ctx.fillStyle = '#414b55';
                        ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = '#a1a8ac';
                        ctx.fillRect(rx - 1.4, ry - 0.5, 2.8, 1);
                        hctx.fillStyle = '#aaaaaa';
                        hctx.beginPath(); hctx.arc(rx, ry, 2.6, 0, Math.PI * 2); hctx.fill();
                    });
                }
                ctx.fillStyle = 'rgba(205,215,215,0.55)';
                ctx.font = '9px monospace';
                ctx.fillText('H9 / AL-Ti / 07', ox + 25, oy + h - 26);
                ctx.fillStyle = 'rgba(23,34,43,0.5)';
                for (let n = 0; n < 23; n++) {
                    ctx.fillRect(ox + w - 70 + n * 1.7, oy + h - 34, n % 3 === 0 ? 1.4 : 0.7, 9);
                }
            };
            drawRivets(4, 4, 248, 248);
            drawRivets(260, 4, 248, 248);
            drawRivets(4, 260, 248, 248);
            drawRivets(260, 260, 248, 248);

            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.normalMap = heightCanvasToNormalTexture(device, hc, 1.65);
            mat.bumpiness = 0.42;
            applySurfaceResponse(device, mat, hc, 0.65, 0.2);
            mat.useMetalness = true;
            mat.metalness = 0.62;
            mat.gloss = 0.68;
            mat.update();
            mats.titaniumHull = mat;
        }

        // 2. Dark Gunmetal Structural Frame
        {
            const mat = new pc.StandardMaterial();
            mat.diffuse = new pc.Color(0.29, 0.32, 0.35);
            // Approximate low-level interior bounce absent from the space IBL.
            mat.emissive = new pc.Color(0.012, 0.014, 0.017);
            mat.normalMap = mats.titaniumHull.normalMap;
            mat.bumpiness = 0.2;
            mat.glossMap = mats.titaniumHull.glossMap;
            mat.glossMapChannel = 'g';
            mat.useMetalness = true;
            mat.metalness = 0.46;
            mat.gloss = 0.58;
            mat.update();
            mats.darkStructural = mat;
        }

        // 3. Industrial Metallic Floor Grating
        {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const ctx = c.getContext('2d');
            const hc = document.createElement('canvas');
            hc.width = 256; hc.height = 256;
            const hctx = hc.getContext('2d');

            ctx.fillStyle = '#45515b';
            ctx.fillRect(0, 0, 256, 256);
            hctx.fillStyle = '#929292';
            hctx.fillRect(0, 0, 256, 256);

            // Long recessed traction slots read as machined deck plates at eye level.
            for (let y = 20; y < 242; y += 24) {
                for (let x = 18; x < 230; x += 78) {
                    ctx.fillStyle = '#222c34';
                    ctx.fillRect(x, y, 62, 6);
                    ctx.fillStyle = 'rgba(160,176,181,0.4)';
                    ctx.fillRect(x, y + 6, 62, 1);
                    hctx.fillStyle = '#555555';
                    hctx.fillRect(x, y, 62, 6);
                }
            }
            ctx.strokeStyle = '#222b32';
            ctx.lineWidth = 2;
            ctx.strokeRect(3, 3, 250, 250);
            hctx.strokeStyle = '#404040';
            hctx.lineWidth = 3;
            hctx.strokeRect(3, 3, 250, 250);
            ctx.strokeStyle = 'rgba(183,195,198,0.36)';
            ctx.lineWidth = 1;
            ctx.strokeRect(6, 6, 244, 244);
            for (let i = 0; i < 220; i++) {
                const sx = hash2(i, 3.4) * 256;
                const sy = hash2(i, 12.7) * 256;
                ctx.fillStyle = 'rgba(180,194,197,0.07)';
                ctx.fillRect(sx, sy, 3 + hash2(i, 1.7) * 15, 0.65);
            }
            [[12, 12], [244, 12], [12, 244], [244, 244]].forEach(([sx, sy]) => {
                ctx.fillStyle = '#19242b';
                ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#8d9a9f';
                ctx.fillRect(sx - 1.5, sy - 0.5, 3, 1);
            });

            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.normalMap = heightCanvasToNormalTexture(device, hc, 1.8);
            mat.diffuseMapTiling = new pc.Vec2(5, 5);
            mat.normalMapTiling = new pc.Vec2(5, 5);
            applySurfaceResponse(device, mat, hc, 0.95, 0.32);
            mat.aoMapTiling = new pc.Vec2(5, 5);
            mat.glossMapTiling = new pc.Vec2(5, 5);
            mat.bumpiness = 0.46;
            mat.useMetalness = true;
            mat.metalness = 0.56;
            mat.gloss = 0.46;
            mat.update();
            mats.floorGrating = mat;
        }

        // 4. Clean White ISS Acoustic Padded Bulkhead
        {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 512;
            const ctx = c.getContext('2d');
            const hc = document.createElement('canvas');
            hc.width = 512; hc.height = 512;
            const hctx = hc.getContext('2d');

            ctx.fillStyle = '#8f9b9f';
            ctx.fillRect(0, 0, 512, 512);
            hctx.fillStyle = '#aaaaaa';
            hctx.fillRect(0, 0, 512, 512);

            ctx.strokeStyle = '#8c9a9f';
            ctx.lineWidth = 1.5;
            hctx.strokeStyle = '#717171';
            hctx.lineWidth = 4;

            for (let i = -512; i < 1024; i += 64) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 512, 512); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(i + 512, 0); ctx.lineTo(i, 512); ctx.stroke();
                hctx.beginPath(); hctx.moveTo(i, 0); hctx.lineTo(i + 512, 512); hctx.stroke();
                hctx.beginPath(); hctx.moveTo(i + 512, 0); hctx.lineTo(i, 512); hctx.stroke();
            }

            // Fine woven fibre and low-contrast stitch detail keep the insulation tactile.
            ctx.fillStyle = 'rgba(237,241,231,0.075)';
            for (let i = 0; i < 512; i += 4) {
                ctx.fillRect(i, 0, 1, 512);
                ctx.fillRect(0, i, 512, 1);
            }
            ctx.strokeStyle = '#4c606a';
            ctx.lineWidth = 5;
            ctx.strokeRect(4, 4, 504, 504);

            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.normalMap = heightCanvasToNormalTexture(device, hc, 1.4);
            mat.bumpiness = 0.38;
            applySurfaceResponse(device, mat, hc, 0.6, 0.4);
            mat.useMetalness = true;
            mat.metalness = 0.0;
            mat.gloss = 0.24;
            mat.update();
            mats.paddedBulkhead = mat;
        }

        // 5. Multi-Layer Crinkled Gold Kapton Foil (MLI Thermal Blanket)
        //    Large faceted crinkles (jittered Voronoi cells + crease lines) keep the
        //    detail well below texel frequency so the metal never sparkles/aliases.
        {
            const S = 256;
            const c = document.createElement('canvas');
            c.width = S; c.height = S;
            const ctx = c.getContext('2d');
            const hc = document.createElement('canvas');
            hc.width = S; hc.height = S;
            const hctx = hc.getContext('2d');

            const img = ctx.createImageData(S, S);
            const hImg = hctx.createImageData(S, S);

            const G = 7; // cells per side
            const cell = S / G;
            const pts = [];
            for (let j = 0; j < G; j++) {
                for (let i = 0; i < G; i++) {
                    pts.push({
                        x: (i + 0.15 + hash2(i, j) * 0.7) * cell,
                        y: (j + 0.15 + hash2(j + 17, i + 3) * 0.7) * cell,
                        tilt: hash2(i * 3.1, j * 7.7)
                    });
                }
            }
            for (let y = 0; y < S; y++) {
                for (let x = 0; x < S; x++) {
                    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
                    let f1 = 1e9, f2 = 1e9, tilt = 0;
                    for (let dj = -1; dj <= 1; dj++) {
                        for (let di = -1; di <= 1; di++) {
                            const ii = (ci + di + G) % G, jj = (cj + dj + G) % G;
                            const p = pts[jj * G + ii];
                            const px = p.x + (ci + di - ii) * cell;
                            const py = p.y + (cj + dj - jj) * cell;
                            const d = Math.hypot(x - px, y - py);
                            if (d < f1) { f2 = f1; f1 = d; tilt = p.tilt; }
                            else if (d < f2) { f2 = d; }
                        }
                    }
                    const crease = Math.min(1, (f2 - f1) / 7);
                    const soft = fbm(x * 0.02, y * 0.02, 3);
                    const shade = 0.72 + tilt * 0.34 + (soft - 0.5) * 0.12;
                    const dark = 0.55 + 0.45 * crease;
                    const idx = (y * S + x) * 4;
                    img.data[idx]     = Math.min(255, Math.floor(214 * shade * dark));
                    img.data[idx + 1] = Math.min(255, Math.floor(156 * shade * dark));
                    img.data[idx + 2] = Math.min(255, Math.floor(42 * shade * dark));
                    img.data[idx + 3] = 255;
                    const hv = Math.floor((tilt * 0.55 + crease * 0.35 + soft * 0.1) * 255);
                    hImg.data[idx] = hImg.data[idx + 1] = hImg.data[idx + 2] = hv;
                    hImg.data[idx + 3] = 255;
                }
            }
            ctx.putImageData(img, 0, 0);
            hctx.putImageData(hImg, 0, 0);

            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.normalMap = heightCanvasToNormalTexture(device, hc, 1.6);
            mat.bumpiness = 0.45;
            applySurfaceResponse(device, mat, hc, 0.6, 0.18);
            mat.useMetalness = true;
            mat.metalness = 0.78;
            mat.gloss = 0.68;
            mat.update();
            mats.goldKapton = mat;
        }

        // 6. Carbon-Phenolic Ablative Heat Shield Hex Tiles
        {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const ctx = c.getContext('2d');
            const hc = document.createElement('canvas');
            hc.width = 256; hc.height = 256;
            const hctx = hc.getContext('2d');

            ctx.fillStyle = '#1c1f24';
            ctx.fillRect(0, 0, 256, 256);
            hctx.fillStyle = '#c8c8c8';
            hctx.fillRect(0, 0, 256, 256);

            ctx.strokeStyle = '#0c0e11';
            ctx.lineWidth = 2;
            hctx.strokeStyle = '#151515';
            hctx.lineWidth = 3;

            const r = 18;
            const dx = r * 1.5;
            const dy = r * Math.sqrt(3);
            for (let row = -1; row < 12; row++) {
                for (let col = -1; col < 14; col++) {
                    const cx = col * dx;
                    const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2);
                    ctx.beginPath();
                    hctx.beginPath();
                    for (let k = 0; k < 6; k++) {
                        const a = (Math.PI / 3) * k;
                        const px = cx + r * Math.cos(a);
                        const py = cy + r * Math.sin(a);
                        if (k === 0) { ctx.moveTo(px, py); hctx.moveTo(px, py); }
                        else { ctx.lineTo(px, py); hctx.lineTo(px, py); }
                    }
                    ctx.closePath(); ctx.stroke();
                    hctx.closePath(); hctx.stroke();
                }
            }

            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.normalMap = heightCanvasToNormalTexture(device, hc, 1.8);
            mat.bumpiness = 0.52;
            applySurfaceResponse(device, mat, hc, 0.75, 0.32);
            mat.useMetalness = true;
            mat.metalness = 0.1;
            mat.gloss = 0.32;
            mat.update();
            mats.carbonAblative = mat;
        }

        // 7. Hazard Caution Stripes
        {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#b88c32';
            ctx.fillRect(0, 0, 256, 256);
            ctx.fillStyle = '#181a1d';
            for (let i = -256; i < 512; i += 64) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i + 32, 0);
                ctx.lineTo(i + 32 + 256, 256);
                ctx.lineTo(i + 256, 256);
                ctx.closePath();
                ctx.fill();
            }
            // A worn safety coating rather than mirror-polished yellow metal.
            for (let i = 0; i < 360; i++) {
                ctx.fillStyle = i % 4 === 0 ? 'rgba(178,188,184,0.2)' : 'rgba(20,29,33,0.12)';
                ctx.fillRect(hash2(i, 6.8) * 256, hash2(i, 11.4) * 256, 2 + hash2(i, 21.1) * 12, 1);
            }
            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.useMetalness = true;
            mat.metalness = 0.18;
            mat.gloss = 0.36;
            mat.update();
            mats.hazardStripe = mat;
        }

        // 8. Anti-Glare Optical Spacecraft Viewport Glass (ultra-clear so flashlight doesn't wash out Earth)
        {
            const mat = new pc.StandardMaterial();
            mat.diffuse = new pc.Color(0.02, 0.06, 0.10);
            mat.useMetalness = false;
            mat.specular = new pc.Color(0.04, 0.08, 0.12);
            mat.gloss = 0.35;
            mat.opacity = 0.06;
            mat.blendType = pc.BLEND_NORMAL;
            mat.depthWrite = false;
            mat.update();
            mats.glassVisor = mat;
        }

        // 9. Solar Array Photovoltaic Cells
        {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#081838';
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = '#c89e32';
            ctx.lineWidth = 2;
            for (let x = 0; x <= 256; x += 32) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
            }
            ctx.strokeStyle = '#1f4480';
            ctx.lineWidth = 1;
            for (let y = 0; y <= 256; y += 16) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
            }
            const mat = new pc.StandardMaterial();
            mat.diffuseMap = canvasToTexture(device, c);
            mat.diffuseMapTiling = new pc.Vec2(4, 1);
            mat.useMetalness = true;
            mat.metalness = 0.78;
            mat.gloss = 0.9;
            mat.update();
            mats.solarPanel = mat;
        }

        // 10. Create Custom WebGL2 Photorealistic Earth, Atmosphere Limb & Moon Materials
        createEarthCustomMaterials(app, mats);

        mats.createEmissive = (r, g, b, intensity = 2.5) => {
            const m = new pc.StandardMaterial();
            m.diffuse = new pc.Color(r * 0.2, g * 0.2, b * 0.2);
            m.emissive = new pc.Color(r, g, b);
            m.emissiveIntensity = intensity;
            m.useMetalness = true;
            m.metalness = 0.5;
            m.gloss = 0.8;
            m.update();
            return m;
        };

        mats.createScreenMaterial = (title, lines, accentColor = '#00f0ff') => {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 256;
            const ctx = c.getContext('2d');

            const draw = (newTitle, newLines, newAccent) => {
                ctx.fillStyle = '#091419';
                ctx.fillRect(0, 0, 512, 256);
                ctx.strokeStyle = 'rgba(133,172,183,0.07)';
                ctx.lineWidth = 1;
                for (let x = 16; x < 512; x += 32) {
                    ctx.beginPath(); ctx.moveTo(x, 46); ctx.lineTo(x, 238); ctx.stroke();
                }
                for (let y = 46; y < 242; y += 32) {
                    ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(504, y); ctx.stroke();
                }
                ctx.strokeStyle = newAccent || accentColor;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.55;
                ctx.strokeRect(6, 6, 500, 244);
                ctx.globalAlpha = 1;

                ctx.fillStyle = newAccent || accentColor;
                ctx.fillRect(7, 7, 3, 35);
                ctx.fillRect(18, 43, 476, 1);
                ctx.fillStyle = '#c9dce0';
                ctx.font = 'bold 18px Consolas, monospace';
                ctx.fillText(newTitle || title, 20, 31, 472);

                ctx.fillStyle = '#a5c2cc';
                ctx.font = '16px Consolas, monospace';
                (newLines || lines).forEach((ln, idx) => {
                    ctx.fillText(ln, 22, 74 + idx * 30, 468);
                });
                ctx.fillStyle = '#53737d';
                ctx.font = '10px Consolas, monospace';
                ctx.fillText('HELIOS-9 // LOCAL CONTROL BUS', 22, 238);
                ctx.fillStyle = newAccent || accentColor;
                ctx.fillRect(468, 231, 6, 6);
                ctx.globalAlpha = 0.4;
                ctx.fillRect(479, 231, 6, 6);
                ctx.globalAlpha = 1;
            };
            draw(title, lines, accentColor);

            const tex = canvasToTexture(device, c);
            const mat = new pc.StandardMaterial();
            mat.diffuse = new pc.Color(0.05, 0.08, 0.12);
            mat.emissiveMap = tex;
            mat.emissive = new pc.Color(1, 1, 1);
            mat.emissiveIntensity = 1.05;
            mat.gloss = 0.58;
            mat.update();

            mat.updateScreen = (t, l, a) => {
                draw(t, l, a);
                tex.upload();
            };
            return mat;
        };

        return mats;
    }

    window.OrbitalGame.Textures = {
        setupOrbitalEnvironment,
        createMaterialLibrary
    };
})();

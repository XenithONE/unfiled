window.OrbitalGame = window.OrbitalGame || {};

// =============================================================================
// CINEMATIC VISOR POST-PROCESSING (WebGL2, multi-pass)
//   Pass 1  : bright-pass + 4-tap downsample to 1/4 resolution
//   Pass 2-5: separable 9-tap gaussian blur (two radii -> tight + wide glow)
//   Pass 6  : composite — bloom, anamorphic streak, heat haze, chromatic
//             aberration, flash / fade, hypoxia tunnel vision, colour grading,
//             vignette and film grain.
// =============================================================================
(function () {
    const VS_QUAD = [
        'attribute vec2 vertex_position;',
        'varying vec2 vUv0;',
        'void main(void) {',
        '    gl_Position = vec4(vertex_position, 0.5, 1.0);',
        '    vUv0 = vertex_position.xy * 0.5 + 0.5;',
        '}'
    ].join('\n');

    const FS_BRIGHT = `
        precision highp float;
        varying vec2 vUv0;
        uniform sampler2D uColorBuffer;
        uniform vec4 uBright; // x: 1/srcW, y: 1/srcH, z: threshold, w: knee
        vec3 tap(vec2 uv) {
            vec3 c = texture2D(uColorBuffer, clamp(uv, 0.001, 0.999)).rgb;
            float l = max(c.r, max(c.g, c.b));
            float soft = clamp(l - uBright.z + uBright.w, 0.0, 2.0 * uBright.w);
            soft = soft * soft / (4.0 * uBright.w + 0.00001);
            float contrib = max(soft, l - uBright.z) / max(l, 0.00001);
            return c * clamp(contrib, 0.0, 1.0);
        }
        void main(void) {
            vec2 o = uBright.xy;
            vec3 c = tap(vUv0 + vec2(-o.x, -o.y)) + tap(vUv0 + vec2(o.x, -o.y))
                   + tap(vUv0 + vec2(-o.x,  o.y)) + tap(vUv0 + vec2(o.x,  o.y));
            gl_FragColor = vec4(c * 0.25, 1.0);
        }
    `;

    const FS_BLUR = `
        precision highp float;
        varying vec2 vUv0;
        uniform sampler2D uSource;
        uniform vec2 uDir; // texel step * radius
        void main(void) {
            vec3 c = texture2D(uSource, vUv0).rgb * 0.2270270270;
            c += texture2D(uSource, vUv0 + uDir * 1.3846153846).rgb * 0.3162162162;
            c += texture2D(uSource, vUv0 - uDir * 1.3846153846).rgb * 0.3162162162;
            c += texture2D(uSource, vUv0 + uDir * 3.2307692308).rgb * 0.0702702703;
            c += texture2D(uSource, vUv0 - uDir * 3.2307692308).rgb * 0.0702702703;
            gl_FragColor = vec4(c, 1.0);
        }
    `;

    const FS_COMPOSITE = `
        precision highp float;
        varying vec2 vUv0;
        uniform sampler2D uColorBuffer;
        uniform sampler2D uBloomTight;
        uniform sampler2D uBloomWide;
        uniform vec4 uParams;     // x: bloom, y: chroma, z: vignette, w: time
        uniform vec4 uRes;        // x: 1/w, y: 1/h, z: hypoxia, w: shake
        uniform vec4 uFx;         // x: flash, y: fadeBlack, z: heatHaze, w: anamorphic
        uniform vec3 uFlashColor;
        uniform vec4 uGrade;      // x: saturation, y: contrast, z: exposure, w: temperature (-1 cold .. +1 warm)
        uniform vec2 uShake;      // uv offset

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main(void) {
            vec2 uv = vUv0;
            vec2 centered = uv - 0.5;
            float distSq = dot(centered, centered);

            // Shake: tiny zoom so offset never reveals clamped edges
            float shakeMag = length(uShake);
            uv = 0.5 + centered * (1.0 - min(0.04, shakeMag * 1.5)) + uShake;

            // Heat haze (re-entry plasma shimmer) — rising sinusoidal refraction
            if (uFx.z > 0.001) {
                float t = uParams.w;
                vec2 hz = vec2(
                    sin(uv.y * 46.0 + t * 9.0) * 0.6 + sin(uv.y * 117.0 - t * 14.0) * 0.4,
                    cos(uv.x * 38.0 + t * 7.0) * 0.5
                );
                uv += hz * 0.0032 * uFx.z * (0.45 + distSq * 2.0);
            }

            // Visor barrel distortion
            vec2 c2 = uv - 0.5;
            vec2 warpedUv = uv + c2 * dot(c2, c2) * (0.008 + uRes.w * 0.05);

            // Radial chromatic aberration — confined to the visor periphery
            float chroma = dot(c2, c2) * 0.0055 * uParams.y + uRes.w * 0.002;
            vec2 dir = c2 * chroma;
            vec3 col;
            col.r = texture2D(uColorBuffer, clamp(warpedUv + dir, 0.001, 0.999)).r;
            col.g = texture2D(uColorBuffer, clamp(warpedUv,       0.001, 0.999)).g;
            col.b = texture2D(uColorBuffer, clamp(warpedUv - dir, 0.001, 0.999)).b;

            // Bloom (tight + wide) and anamorphic horizontal streak
            vec3 bt = texture2D(uBloomTight, warpedUv).rgb;
            vec3 bw = texture2D(uBloomWide, warpedUv).rgb;
            vec3 streak = vec3(0.0);
            float sx = uRes.x * 4.0;
            for (int i = 1; i <= 6; i++) {
                float fi = float(i);
                float w = exp(-fi * 0.42);
                streak += texture2D(uBloomTight, warpedUv + vec2(sx * fi * 3.0, 0.0)).rgb * w;
                streak += texture2D(uBloomTight, warpedUv - vec2(sx * fi * 3.0, 0.0)).rgb * w;
            }
            streak *= vec3(0.35, 0.65, 1.0) * 0.16 * uFx.w;
            col += (bt * 0.65 + bw * 0.42) * uParams.x + streak;

            // Exposure / contrast / saturation / temperature grading
            col *= uGrade.z;
            // Contrast pivots around the midtones, keeping black detail stable.
            col = max(vec3(0.0), (col - 0.18) * uGrade.y + 0.18);
            float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(luma), col, uGrade.x);
            vec3 warm = vec3(1.08, 0.98, 0.86);
            vec3 cold = vec3(0.86, 0.97, 1.10);
            col *= mix(vec3(1.0), uGrade.w > 0.0 ? warm : cold, abs(uGrade.w));
            // Filmic split-tone: cool shadows, warm highlights
            col = mix(col * vec3(0.98, 1.0, 1.025), col * vec3(1.015, 1.0, 0.985), smoothstep(0.15, 0.85, luma));

            // Hypoxia: desaturation, tunnel vision and heartbeat pulse
            float hyp = uRes.z;
            if (hyp > 0.001) {
                float pulse = 0.5 + 0.5 * sin(uParams.w * 6.2);
                float l2 = dot(col, vec3(0.299, 0.587, 0.114));
                col = mix(col, vec3(l2) * vec3(0.95, 0.9, 0.95), hyp * 0.75);
                float tunnel = smoothstep(0.05 - hyp * 0.04, 0.42 - hyp * 0.3 - pulse * 0.04 * hyp, distSq);
                col *= 1.0 - tunnel * min(1.0, hyp * 1.25);
            }

            // Vignette
            float vig = 1.0 - smoothstep(0.16, 0.75, distSq);
            col *= mix(1.0, vig, uParams.z);

            // Film grain
            float grain = hash(uv * (uParams.w * 0.37 + 1.7)) - 0.5;
            col += grain * 0.004;

            // Flash (detonation / impact) and fade-to-black
            col = mix(col, uFlashColor, clamp(uFx.x, 0.0, 1.0));
            col *= 1.0 - clamp(uFx.y, 0.0, 1.0);

            gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        }
    `;

    function makeRT(device, w, h) {
        const tex = new pc.Texture(device, {
            width: Math.max(1, w),
            height: Math.max(1, h),
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: false,
            minFilter: pc.FILTER_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE
        });
        return new pc.RenderTarget({ colorBuffer: tex, depth: false });
    }

    class CinematicVisorEffect extends pc.PostEffect {
        constructor(graphicsDevice) {
            super(graphicsDevice);
            const attrs = { vertex_position: pc.SEMANTIC_POSITION };
            this.brightShader = pc.createShaderFromCode(graphicsDevice, VS_QUAD, FS_BRIGHT, 'VisorBrightPass', attrs);
            this.blurShader = pc.createShaderFromCode(graphicsDevice, VS_QUAD, FS_BLUR, 'VisorGaussianBlur', attrs);
            this.compositeShader = pc.createShaderFromCode(graphicsDevice, VS_QUAD, FS_COMPOSITE, 'VisorComposite', attrs);

            // Tunables
            this.bloomIntensity = 0.26;
            this.bloomThreshold = 0.82;
            this.chromaStrength = 0.26;
            this.vignette = 0.27;
            this.anamorphic = 0.28;
            this.time = 0;
            this.hypoxiaFactor = 0.0;
            this.gForceShake = 0.0;
            this.flash = 0.0;
            this.flashColor = [1, 1, 1];
            this.fadeBlack = 0.0;
            this.heatHaze = 0.0;
            this.saturation = 0.98;
            this.contrast = 1.025;
            this.exposure = 1.0;
            this.temperature = 0.0;
            this.shakeOffset = [0, 0];

            this._rtW = 0; this._rtH = 0;
            this._rtA = null; this._rtB = null; this._rtWide = null;
            this._v4a = new Float32Array(4);
            this._v4b = new Float32Array(4);
            this._v4c = new Float32Array(4);
            this._v4d = new Float32Array(4);
            this._v4e = new Float32Array(4);
            this._v2 = new Float32Array(2);
            this._v3 = new Float32Array(3);
        }

        // Backwards-compatible aliases used by main.js
        get hypoxiaAmount() { return this.hypoxiaFactor; }
        set hypoxiaAmount(v) { this.hypoxiaFactor = v; }
        get shakeAmount() { return this.gForceShake; }
        set shakeAmount(v) { this.gForceShake = v; }

        _ensureTargets(w, h) {
            const qw = Math.max(1, Math.floor(w / 4));
            const qh = Math.max(1, Math.floor(h / 4));
            if (this._rtA && this._rtW === qw && this._rtH === qh) return;
            [this._rtA, this._rtB, this._rtWide].forEach(rt => {
                if (rt) { rt.colorBuffer.destroy(); rt.destroy(); }
            });
            this._rtA = makeRT(this.device, qw, qh);
            this._rtB = makeRT(this.device, qw, qh);
            this._rtWide = makeRT(this.device, qw, qh);
            this._rtW = qw; this._rtH = qh;
        }

        render(inputTarget, outputTarget, rect) {
            const device = this.device;
            const scope = device.scope;
            const w = inputTarget.width, h = inputTarget.height;
            this._ensureTargets(w, h);
            const qx = 1 / this._rtW, qy = 1 / this._rtH;

            // 1. Bright pass + downsample
            this._v4a[0] = 1 / w; this._v4a[1] = 1 / h;
            this._v4a[2] = this.bloomThreshold; this._v4a[3] = 0.1;
            scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
            scope.resolve('uBright').setValue(this._v4a);
            this.drawQuad(this._rtA, this.brightShader);

            // 2-3. Tight blur
            const dirId = scope.resolve('uDir');
            const srcId = scope.resolve('uSource');
            this._v2[0] = qx; this._v2[1] = 0;
            srcId.setValue(this._rtA.colorBuffer); dirId.setValue(this._v2);
            this.drawQuad(this._rtB, this.blurShader);
            this._v2[0] = 0; this._v2[1] = qy;
            srcId.setValue(this._rtB.colorBuffer); dirId.setValue(this._v2);
            this.drawQuad(this._rtA, this.blurShader);

            // 4-5. Wide blur (from tight result)
            this._v2[0] = qx * 3.2; this._v2[1] = 0;
            srcId.setValue(this._rtA.colorBuffer); dirId.setValue(this._v2);
            this.drawQuad(this._rtB, this.blurShader);
            this._v2[0] = 0; this._v2[1] = qy * 3.2;
            srcId.setValue(this._rtB.colorBuffer); dirId.setValue(this._v2);
            this.drawQuad(this._rtWide, this.blurShader);

            // 6. Composite
            this._v4b[0] = this.bloomIntensity;
            this._v4b[1] = this.chromaStrength;
            this._v4b[2] = this.vignette;
            this._v4b[3] = this.time % 1000.0;

            this._v4c[0] = 1 / w; this._v4c[1] = 1 / h;
            this._v4c[2] = this.hypoxiaFactor;
            this._v4c[3] = this.gForceShake;

            this._v4d[0] = this.flash;
            this._v4d[1] = this.fadeBlack;
            this._v4d[2] = this.heatHaze;
            this._v4d[3] = this.anamorphic;

            this._v4e[0] = this.saturation;
            this._v4e[1] = this.contrast;
            this._v4e[2] = this.exposure;
            this._v4e[3] = this.temperature;

            this._v3[0] = this.flashColor[0]; this._v3[1] = this.flashColor[1]; this._v3[2] = this.flashColor[2];
            this._v2[0] = this.shakeOffset[0]; this._v2[1] = this.shakeOffset[1];

            scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
            scope.resolve('uBloomTight').setValue(this._rtA.colorBuffer);
            scope.resolve('uBloomWide').setValue(this._rtWide.colorBuffer);
            scope.resolve('uParams').setValue(this._v4b);
            scope.resolve('uRes').setValue(this._v4c);
            scope.resolve('uFx').setValue(this._v4d);
            scope.resolve('uGrade').setValue(this._v4e);
            scope.resolve('uFlashColor').setValue(this._v3);
            scope.resolve('uShake').setValue(this._v2);

            this.drawQuad(outputTarget, this.compositeShader, rect);
        }

        // Reset every cinematic/gameplay modifier back to neutral
        resetModifiers() {
            this.hypoxiaFactor = 0;
            this.gForceShake = 0;
            this.flash = 0;
            this.fadeBlack = 0;
            this.heatHaze = 0;
            this.temperature = 0;
            this.exposure = 1.0;
            this.saturation = 0.98;
            this.contrast = 1.025;
            this.shakeOffset[0] = 0;
            this.shakeOffset[1] = 0;
            this.flashColor = [1, 1, 1];
        }
    }

    function attachPostEffects(app, cameraEntity) {
        try {
            const effect = new CinematicVisorEffect(app.graphicsDevice);
            cameraEntity.camera.postEffects.addEffect(effect);
            app.on('update', (dt) => {
                effect.time += dt;
            });
            return effect;
        } catch (err) {
            console.warn('PostFX init failed, continuing without post-processing:', err);
            return null;
        }
    }

    window.OrbitalGame.PostFX = {
        CinematicVisorEffect,
        attachPostEffects
    };
})();

window.OrbitalGame = window.OrbitalGame || {};

(function () {
    class SoundEngine {
        constructor() {
            this.ctx = null;
            this.muted = false;
            this.masterGain = null;
            this.ambientNodes = null;
            this.reentryNode = null;
            this.alarmTimer = null;
        }

        init() {
            if (this.ctx) {
                if (this.ctx.state === 'suspended') {
                    this.ctx.resume();
                }
                return;
            }
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            this.ctx = new AudioCtx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.65;
            this.masterGain.connect(this.ctx.destination);
        }

        toggleMute() {
            this.init();
            this.muted = !this.muted;
            if (this.masterGain && this.ctx) {
                this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.65, this.ctx.currentTime, 0.05);
            }
            return this.muted;
        }

        createNoiseBuffer(duration = 2.0) {
            if (!this.ctx) return null;
            const bufferSize = Math.floor(this.ctx.sampleRate * duration);
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
                b6 = white * 0.115926;
            }
            return buffer;
        }

        startStationAmbience() {
            this.init();
            if (!this.ctx || this.ambientNodes) return;

            const now = this.ctx.currentTime;
            // Deep hull hum
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();
            const humGain = this.ctx.createGain();

            osc1.type = 'sawtooth';
            osc1.frequency.value = 54;
            osc2.type = 'sine';
            osc2.frequency.value = 108.5;

            lfo.type = 'sine';
            lfo.frequency.value = 0.4;
            lfoGain.gain.value = 12;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 135;

            humGain.gain.value = 0.14;

            lfo.connect(lfoGain);
            lfoGain.connect(filter.frequency);
            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(humGain);
            humGain.connect(this.masterGain);

            osc1.start(now);
            osc2.start(now);
            lfo.start(now);

            this.ambientNodes = { osc1, osc2, lfo, humGain, filter };
        }

        setReactorOverloadMode(armed) {
            if (!this.ambientNodes || !this.ctx) return;
            const now = this.ctx.currentTime;
            this.ambientNodes.lfo.frequency.setTargetAtTime(armed ? 2.2 : 0.4, now, 0.3);
            this.ambientNodes.osc1.frequency.setTargetAtTime(armed ? 68 : 54, now, 0.3);
            this.ambientNodes.filter.frequency.setTargetAtTime(armed ? 240 : 135, now, 0.3);
        }

        stopStationAmbience() {
            if (!this.ambientNodes) return;
            try {
                this.ambientNodes.osc1.stop();
                this.ambientNodes.osc2.stop();
                this.ambientNodes.lfo.stop();
            } catch (e) {}
            this.ambientNodes = null;
        }

        playFootstep(sprint = false) {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            // Metallic grating clink + low thud
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            const baseFreq = sprint ? 115 : 95;
            osc.frequency.setValueAtTime(baseFreq + Math.random() * 25, now);
            osc.frequency.exponentialRampToValueAtTime(32, now + 0.09);

            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 0.11);
        }

        playPickup() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [587.33, 880, 1174.66];
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.065);
                gain.gain.setValueAtTime(0.18, now + idx * 0.065);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.22);
                osc.connect(gain);
                gain.connect(this.masterGain);
                osc.start(now + idx * 0.065);
                osc.stop(now + idx * 0.065 + 0.24);
            });
        }

        playInstallModule() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            // Heavy mechanical clamp + power-up chord
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, now);
            osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
            gain.gain.setValueAtTime(0.28, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 0.21);

            [440, 659.25, 880, 1318.5].forEach((f, i) => {
                const o = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                o.type = 'triangle';
                o.frequency.setValueAtTime(f, now + 0.12 + i * 0.05);
                g.gain.setValueAtTime(0.15, now + 0.12 + i * 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.45 + i * 0.05);
                o.connect(g);
                g.connect(this.masterGain);
                o.start(now + 0.12 + i * 0.05);
                o.stop(now + 0.48 + i * 0.05);
            });
        }

        playDoorSlide() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.createNoiseBuffer(0.5);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(400, now);
            filter.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
            filter.frequency.exponentialRampToValueAtTime(300, now + 0.45);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            noise.start(now);
            noise.stop(now + 0.5);
        }

        playAlarmPulse() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(620, now);
            osc.frequency.linearRampToValueAtTime(880, now + 0.28);
            osc.frequency.linearRampToValueAtTime(540, now + 0.55);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 1400;

            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 0.6);
        }

        playStationDetonation(highYield = true) {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            // 1. Massive Sub-Bass Thermonuclear Drop
            const sub = this.ctx.createOscillator();
            const subGain = this.ctx.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(highYield ? 130 : 75, now);
            sub.frequency.exponentialRampToValueAtTime(18, now + (highYield ? 3.5 : 1.4));
            subGain.gain.setValueAtTime(highYield ? 0.85 : 0.35, now);
            subGain.gain.exponentialRampToValueAtTime(0.001, now + (highYield ? 3.8 : 1.5));
            sub.connect(subGain);
            subGain.connect(this.masterGain);
            sub.start(now);
            sub.stop(now + 3.9);

            // 2. Explosion Roar (Filtered Pink Noise)
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.createNoiseBuffer(4.0);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(highYield ? 2600 : 800, now);
            filter.frequency.exponentialRampToValueAtTime(90, now + 3.6);

            const nGain = this.ctx.createGain();
            nGain.gain.setValueAtTime(highYield ? 0.9 : 0.35, now);
            nGain.gain.exponentialRampToValueAtTime(0.001, now + 3.8);

            noise.connect(filter);
            filter.connect(nGain);
            nGain.connect(this.masterGain);
            noise.start(now);
            noise.stop(now + 3.9);
        }

        playShockwaveImpact(survived = true) {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            // Heavy metallic hull clang + G-force rattle
            const clang = this.ctx.createOscillator();
            const cGain = this.ctx.createGain();
            clang.type = 'square';
            clang.frequency.setValueAtTime(survived ? 220 : 140, now);
            clang.frequency.exponentialRampToValueAtTime(35, now + 0.65);
            cGain.gain.setValueAtTime(0.5, now);
            cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
            clang.connect(cGain);
            cGain.connect(this.masterGain);
            clang.start(now);
            clang.stop(now + 0.75);

            if (!survived) {
                this.playStationDetonation(true);
            }
        }

        startReentryPlasmaSound() {
            this.init();
            if (!this.ctx || this.reentryNode) return;
            const now = this.ctx.currentTime;
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.createNoiseBuffer(3.0);
            noise.loop = true;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 520;
            filter.Q.value = 1.4;

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.01, now);
            gain.gain.linearRampToValueAtTime(0.45, now + 1.2);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            noise.start(now);

            this.reentryNode = { noise, filter, gain };
        }

        stopReentryPlasmaSound() {
            if (!this.reentryNode || !this.ctx) return;
            try {
                const now = this.ctx.currentTime;
                this.reentryNode.gain.gain.setTargetAtTime(0.001, now, 0.25);
                setTimeout(() => {
                    try {
                        if (this.reentryNode) {
                            this.reentryNode.noise.stop();
                            this.reentryNode = null;
                        }
                    } catch (e) {}
                }, 400);
            } catch (e) {
                this.reentryNode = null;
            }
        }

        playParachuteDeploy() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.createNoiseBuffer(1.0);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1600, now);
            filter.frequency.exponentialRampToValueAtTime(280, now + 0.7);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.55, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            noise.start(now);
            noise.stop(now + 0.8);
        }

        playSplashdown() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.createNoiseBuffer(2.5);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1100, now);
            filter.frequency.exponentialRampToValueAtTime(220, now + 2.2);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.6, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 2.3);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            noise.start(now);
            noise.stop(now + 2.4);
        }

        _noiseBurst(duration, type, f0, f1, g0, q = 1.0) {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const src = this.ctx.createBufferSource();
            src.buffer = this.createNoiseBuffer(duration + 0.1);
            const filter = this.ctx.createBiquadFilter();
            filter.type = type;
            filter.Q.value = q;
            filter.frequency.setValueAtTime(f0, now);
            filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + duration);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(g0, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            src.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            src.start(now);
            src.stop(now + duration + 0.05);
        }

        playHeartbeat(strength = 1.0) {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [0, 0.22].forEach((off, i) => {
                const osc = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(i === 0 ? 62 : 52, now + off);
                osc.frequency.exponentialRampToValueAtTime(32, now + off + 0.16);
                g.gain.setValueAtTime(0.0001, now + off);
                g.gain.exponentialRampToValueAtTime((i === 0 ? 0.55 : 0.38) * strength, now + off + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.2);
                osc.connect(g);
                g.connect(this.masterGain);
                osc.start(now + off);
                osc.stop(now + off + 0.25);
            });
        }

        playRcsPuff() {
            this.init();
            this._noiseBurst(0.16, 'highpass', 2600, 1400, 0.22, 0.7);
        }

        playRetroBurn() {
            this.init();
            this._noiseBurst(0.9, 'lowpass', 1800, 160, 0.75, 0.8);
        }

        playMetalCrunch() {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            for (let i = 0; i < 3; i++) {
                const osc = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180 + i * 77, now + i * 0.05);
                osc.frequency.exponentialRampToValueAtTime(40, now + i * 0.05 + 0.5);
                g.gain.setValueAtTime(0.25, now + i * 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.55);
                osc.connect(g);
                g.connect(this.masterGain);
                osc.start(now + i * 0.05);
                osc.stop(now + i * 0.05 + 0.6);
            }
            this._noiseBurst(0.7, 'bandpass', 900, 200, 0.5, 1.2);
        }

        playTremor(intensity = 1.0) {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(44, now);
            osc.frequency.linearRampToValueAtTime(28, now + 1.6);
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(0.5 * intensity, now + 0.12);
            g.gain.exponentialRampToValueAtTime(0.001, now + 1.7);
            osc.connect(g);
            g.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 1.8);
            this._noiseBurst(1.4, 'lowpass', 420, 60, 0.45 * intensity, 0.9);
            // metallic creak
            this._noiseBurst(0.5, 'bandpass', 1300, 700, 0.12 * intensity, 6.0);
        }

        startWindRush() {
            this.init();
            if (!this.ctx || this.windNode) return;
            const now = this.ctx.currentTime;
            const src = this.ctx.createBufferSource();
            src.buffer = this.createNoiseBuffer(3.0);
            src.loop = true;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 380;
            filter.Q.value = 0.6;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.8);
            src.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            src.start(now);
            this.windNode = { src, filter, gain };
        }

        setWindLevel(level) {
            if (!this.windNode || !this.ctx) return;
            const now = this.ctx.currentTime;
            this.windNode.gain.gain.setTargetAtTime(Math.max(0.001, 0.42 * level), now, 0.2);
            this.windNode.filter.frequency.setTargetAtTime(220 + level * 600, now, 0.2);
        }

        stopWindRush() {
            if (!this.windNode || !this.ctx) return;
            const node = this.windNode;
            this.windNode = null;
            try {
                node.gain.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.25);
                setTimeout(() => { try { node.src.stop(); } catch (e) {} }, 500);
            } catch (e) {}
        }
    }

    window.OrbitalGame.Audio = new SoundEngine();
})();

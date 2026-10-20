window.OrbitalGame = window.OrbitalGame || {};

(function () {
    const ESCAPE_MODULES = [
        {
            id: 'plasma_cell',
            name: '高純度重水素プラズマ増強セル',
            engName: 'HIGH-YIELD D-T PLASMA CATALYST',
            zone: '東区画：機関・プラズマ触媒保管室',
            pos: [21.2, 1.15, 0],
            color: [0.0, 0.95, 1.0],
            massKg: 120,
            powerReqKw: 35,
            desc: '中央トカマク反応炉の爆縮出力を臨界突破させ、脱出ポッドを地球帰還軌道へ弾き飛ばす指向性プラズマ衝撃波（目標 ΔV = 3.20 km/s）を発生させる触媒コア。',
            missingRisk: '【未装着・出力不足リスク】爆発威力が不足し、反動推力不足（ΔV < 3.05 km/s）で地球軌道に届かず宇宙空間を永久漂流する。'
        },
        {
            id: 'blast_dampener',
            name: '爆風反動プッシャープレート＆油圧ダンパー',
            engName: '28G BLAST PUSHER-PLATE & DAMPENERS',
            zone: '西区画：構造整備・重機ベイ',
            pos: [-21.2, 1.15, 0],
            color: [1.0, 0.68, 0.0],
            massKg: 380,
            powerReqKw: 40,
            desc: '宇宙ステーション爆破時の強烈な爆縮衝撃波（最大28G）を金カプトン装甲プレートと4基の油圧シリンダーで受け止め、船体圧壊を防ぎつつ推進力へ変換する機構。',
            missingRisk: '【未装着・減衰不備リスク】ステーション爆発の衝撃波（44G超）にポッド船体が耐えきれず、軌道上で木っ端微塵に圧壊・爆散する。'
        },
        {
            id: 'nav_gyro',
            name: '軌道計算ジャイロ・アストロナビコア',
            engName: 'ORBITAL TRAJECTORY GYRO & ASTRO-CORE',
            zone: '北区画：司令ブリッジ・地球展望ドーム',
            pos: [4.2, 1.15, -20.2],
            color: [0.2, 1.0, 0.55],
            massKg: 85,
            powerReqKw: 25,
            desc: '爆風推進時のスピンをミリ秒単位で制動し、地球大気圏への極狭な再突入回廊（目標進入角 γ = -6.20° ±0.5°）へ精密誘導する慣性航法ユニット。',
            missingRisk: '【未装着・角度計算ミス】浅すぎる進入角（>-5.2°）で大気圏上端を水切りスキップして深宇宙へ消えるか、急角度（<-7.5°）で高G焼失する。'
        },
        {
            id: 'heat_shield',
            name: 'ハニカム炭素複合アブレーション耐熱シールド',
            engName: 'HEX-CARBON ABLATIVE HEAT SHIELD',
            zone: '北西区画：熱制御ラボ・エアロック',
            pos: [-17.2, 1.15, -18.0],
            color: [1.0, 0.28, 0.2],
            massKg: 420,
            powerReqKw: 30,
            desc: '大気圏再突入時のマッハ24・3,200℃（熱流束 1,420 W/cm²）の超高熱断熱圧縮プラズマからポッド船殻を防護する六角ハニカム炭素複合装甲。',
            missingRisk: '【未装着リスク】大気圏突入時の3,200℃の空力加熱に船殻が耐えられず、高度74kmで白熱融解・空中分解して流れ星となる。'
        },
        {
            id: 'retro_chute',
            name: '3連超音速パラシュート＆固体逆噴射ロケット',
            engName: 'TRIPLE SUPERSONIC CHUTES & RETRO-ROCKETS',
            zone: '南区画：脱出ポッド整備ハンガー',
            pos: [5.2, 1.15, 17.5],
            color: [0.75, 0.45, 1.0],
            massKg: 250,
            powerReqKw: 30,
            desc: '大気圏突破後の終端速度からドローグ＆メインシュート3基を開傘し、着水直前（高度25m）の固体逆噴射ロケット点火で秒速6.8mへ軟着水させる減速機構。',
            missingRisk: '【未装着・開傘高度ミス】減速できず時速880kmで地表に激突大爆発するか、高高度（マッハ4）で開傘してキャノピーが吹き飛び墜落する。'
        }
    ];

    // Raw interior room & corridor rectangles with generous overlap across all doorways!
    const WALKABLE_RECTS = [
        // Central Tokamak Reactor Hub
        { id: 'hub', name: '中央ハブ：トカマク対消滅反応炉コア [TR-1]', minX: -7.1, maxX: 7.1, minZ: -7.1, maxZ: 7.1 },
        // North Corridor (overlaps Hub [-7.1..-5.0] and Bridge [-14.5..-12.5])
        { id: 'ncorr', name: '北連絡通路（ブリッジ接続シャフト）', minX: -2.1, maxX: 2.1, minZ: -14.8, maxZ: -5.5 },
        // Command Bridge & Cupola
        { id: 'bridge', name: '北区画：司令ブリッジ・地球展望ドーム [OP-1]', minX: -6.3, maxX: 6.3, minZ: -22.2, maxZ: -13.2 },
        // NW Corridor (overlaps Bridge [-6.3..-4.8] and Thermal Lab [-12.0..-10.6])
        { id: 'nwcorr', name: '北西エアロック連絡通路', minX: -12.2, maxX: -5.0, minZ: -19.9, maxZ: -16.1 },
        // NW Thermal Dynamics Lab & Airlock
        { id: 'thermal', name: '北西区画：熱制御ラボ・EVAエアロック [RL-1]', minX: -19.1, maxX: -10.9, minZ: -22.1, maxZ: -13.9 },
        // East Corridor (overlaps Hub [5.5..7.1] and Engineering [12.1..14.0])
        { id: 'ecorr', name: '東連絡通路（機関区画シャフト）', minX: 5.5, maxX: 13.8, minZ: -2.1, maxZ: 2.1 },
        // East Cryo-Engineering Bay
        { id: 'eng', name: '東区画：機関・極低温プラズマ触媒室 [HB-2]', minX: 12.3, maxX: 23.1, minZ: -5.3, maxZ: 5.3 },
        // West Corridor (overlaps Hub [-7.1..-5.5] and Maintenance [-14.0..-12.1])
        { id: 'wcorr', name: '西連絡通路（整備区画シャフト）', minX: -13.8, maxX: -5.5, minZ: -2.1, maxZ: 2.1 },
        // West Heavy Structural Maintenance Bay
        { id: 'maint', name: '西区画：構造整備・重機ガントリーベイ [CH-1]', minX: -23.1, maxX: -12.3, minZ: -5.3, maxZ: 5.3 },
        // South Corridor (overlaps Hub [5.5..7.1] and Hangar [13.0..14.8])
        { id: 'scorr', name: '南連絡通路（爆縮衝撃波導入チューブ）', minX: -2.1, maxX: 2.1, minZ: 5.5, maxZ: 14.8 },
        // South Escape Pod Hangar
        { id: 'hangar', name: '南区画：脱出ポッド発射ハンガー [KESTREL-01]', minX: -6.4, maxX: 6.4, minZ: 13.2, maxZ: 22.8 }
    ];

    const OBSTACLE_CIRCLES = [
        { x: 0, z: 0, r: 2.55 },     // Central Tokamak Reactor pedestal
        { x: 0, z: 21.0, r: 2.05 }   // Escape Pod hull in Hangar
    ];

    function isRawPointInUnion(px, pz) {
        for (let i = 0; i < WALKABLE_RECTS.length; i++) {
            const r = WALKABLE_RECTS[i];
            if (px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ) {
                return true;
            }
        }
        return false;
    }

    // Seamless union-of-rectangles + obstacle collision test (zero doorway seam traps!)
    function isPositionWalkable(x, z, radius = 0.34) {
        if (!isRawPointInUnion(x, z)) return false;
        // Check 8 points on player's collision cylinder perimeter against union of rooms
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            const px = x + Math.cos(a) * radius;
            const pz = z + Math.sin(a) * radius;
            if (!isRawPointInUnion(px, pz)) return false;
        }
        for (let i = 0; i < OBSTACLE_CIRCLES.length; i++) {
            const c = OBSTACLE_CIRCLES[i];
            const dx = x - c.x;
            const dz = z - c.z;
            const minDist = c.r + radius * 0.5;
            if (dx * dx + dz * dz < minDist * minDist) return false;
        }
        return true;
    }

    function addPrimitive(parent, type, name, pos, scale, rot, material, castShadows = false, receiveShadows = true) {
        const e = new pc.Entity(name);
        e.addComponent('render', {
            type: type,
            material: material,
            castShadows: castShadows,
            receiveShadows: receiveShadows
        });
        if (pos) e.setLocalPosition(pos[0], pos[1], pos[2]);
        if (scale) e.setLocalScale(scale[0], scale[1], scale[2]);
        if (rot) e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
        parent.addChild(e);
        return e;
    }

    // Build detailed architectural room enclosure with chamfered ceiling coves, pipe trenches, and clear doorways
    function buildRoomShell(root, mats, x, z, width, depth, height, options = {}) {
        const room = new pc.Entity(options.name || `Room_${x}_${z}`);
        room.setLocalPosition(x, 0, z);
        root.addChild(room);

        // Keep the deck's machining at a consistent world scale in every room.
        const deckMaterial = mats.floorGrating.clone();
        ['diffuseMapTiling', 'normalMapTiling', 'aoMapTiling', 'glossMapTiling'].forEach(key => {
            deckMaterial[key] = new pc.Vec2(width / 2.6, depth / 2.6);
        });
        deckMaterial.update();
        addPrimitive(room, 'box', 'Floor', [0, -0.1, 0], [width, 0.2, depth], [0, 0, 0], deckMaterial, false, true);

        // Illuminated sub-floor plasma/coolant conduit strips
        const stripColor = options.stripColor || [0.0, 0.72, 1.0];
        const stripGlow = mats.createEmissive(stripColor[0], stripColor[1], stripColor[2], 0.92);
        addPrimitive(room, 'box', 'FloorStripX', [0, -0.008, 0], [width * 0.88, 0.02, 0.045], [0, 0, 0], stripGlow);
        addPrimitive(room, 'box', 'FloorStripZ', [0, -0.008, 0], [0.045, 0.02, depth * 0.88], [0, 0, 0], stripGlow);

        // Ceiling Hull + Angled Chamfer Coves along upper edges
        addPrimitive(room, 'box', 'Ceiling', [0, height + 0.1, 0], [width, 0.2, depth], [0, 0, 0], mats.titaniumHull, true, true);
        addPrimitive(room, 'box', 'CoveW', [-width * 0.5 + 0.35, height - 0.35, 0], [0.9, 0.22, depth - 0.4], [0, 0, -38], mats.darkStructural);
        addPrimitive(room, 'box', 'CoveE', [ width * 0.5 - 0.35, height - 0.35, 0], [0.9, 0.22, depth - 0.4], [0, 0,  38], mats.darkStructural);

        // Overhead emissive light panels
        const ceilGlow = mats.createEmissive(0.88, 0.93, 0.96, 1.35);
        [-1, 1].forEach(side => {
            const fixtureX = side * width * 0.22;
            addPrimitive(room, 'box', `LightHousing_${side}`, [fixtureX, height - 0.04, 0], [0.64, 0.1, depth * 0.62], [0, 0, 0], mats.darkStructural);
            addPrimitive(room, 'box', side < 0 ? 'LightPanel1' : 'LightPanel2', [fixtureX, height - 0.105, 0], [0.38, 0.025, depth * 0.59], [0, 0, 0], ceilGlow);
        });

        // Room Point Light
        const lightEnt = new pc.Entity('RoomLight');
        const lc = options.lightColor || [0.78, 0.9, 1.0];
        lightEnt.addComponent('light', {
            type: 'point',
            color: new pc.Color(0.84 + lc[0] * 0.16, 0.84 + lc[1] * 0.16, 0.84 + lc[2] * 0.16),
            intensity: (options.lightIntensity || 1.5) * 0.72,
            range: Math.max(width, depth) * 1.15,
            castShadows: false
        });
        lightEnt.setLocalPosition(0, height - 0.45, 0);
        room.addChild(lightEnt);

        const addWall = (side, wallLen, isZ) => {
            const mode = options[side] || 'solid';
            if (mode === 'open') return;

            const wallMat = (options.wallMat || mats.paddedBulkhead).clone();
            ['diffuseMapTiling', 'normalMapTiling', 'aoMapTiling', 'glossMapTiling'].forEach(key => {
                wallMat[key] = new pc.Vec2(wallLen / 3.2, height / 3.2);
            });
            wallMat.update();
            const posOffset = side === 'north' ? [0, height / 2, -depth / 2] :
                              side === 'south' ? [0, height / 2,  depth / 2] :
                              side === 'east'  ? [ width / 2, height / 2, 0] :
                                                 [-width / 2, height / 2, 0];

            const wallGroup = new pc.Entity(`Wall_${side}`);
            wallGroup.setLocalPosition(posOffset[0], posOffset[1], posOffset[2]);
            if (!isZ) wallGroup.setLocalEulerAngles(0, 90, 0);
            room.addChild(wallGroup);

            if (mode === 'solid') {
                addPrimitive(wallGroup, 'box', 'Panel', [0, 0, 0], [wallLen, height, 0.25], [0, 0, 0], wallMat, true);
                addPrimitive(wallGroup, 'box', 'Baseboard', [0, -height / 2 + 0.25, 0], [wallLen, 0.45, 0.32], [0, 0, 0], mats.darkStructural);
                addPrimitive(wallGroup, 'cylinder', 'Handrail', [0, -0.35, 0.18], [0.06, wallLen * 0.82, 0.06], [0, 0, 90], mats.goldKapton);
            } else if (mode === 'door') {
                const doorW = options.doorWidth || 4.5;
                const sideW = Math.max(0.4, (wallLen - doorW) / 2);
                addPrimitive(wallGroup, 'box', 'LeftSeg', [-(doorW / 2 + sideW / 2), 0, 0], [sideW, height, 0.28], [0, 0, 0], wallMat, true);
                addPrimitive(wallGroup, 'box', 'RightSeg', [(doorW / 2 + sideW / 2), 0, 0], [sideW, height, 0.28], [0, 0, 0], wallMat, true);
                addPrimitive(wallGroup, 'box', 'DoorHeader', [0, height / 2 - 0.55, 0], [doorW, 1.1, 0.36], [0, 0, 0], mats.darkStructural, true);
                addPrimitive(wallGroup, 'box', 'PillarL', [-doorW / 2 - 0.15, 0, 0], [0.3, height, 0.4], [0, 0, 0], mats.hazardStripe);
                addPrimitive(wallGroup, 'box', 'PillarR', [ doorW / 2 + 0.15, 0, 0], [0.3, height, 0.4], [0, 0, 0], mats.hazardStripe);
                // Glowing cyan bulkhead portal strip above doorway
                addPrimitive(wallGroup, 'box', 'DoorPortalLED', [0, height / 2 - 1.08, 0], [doorW - 0.4, 0.08, 0.42], [0, 0, 0], stripGlow);
            } else if (mode === 'window') {
                // Observation Cupola Window (matching helios9_reference_sheet.jpg OP-1)
                addPrimitive(wallGroup, 'box', 'LowerBulkhead', [0, -height / 2 + 0.55, 0], [wallLen, 1.1, 0.34], [0, 0, 0], mats.darkStructural);
                addPrimitive(wallGroup, 'box', 'UpperBulkhead', [0, height / 2 - 0.4, 0], [wallLen, 0.8, 0.34], [0, 0, 0], mats.darkStructural);
                addPrimitive(wallGroup, 'box', 'GoldCollarTrim', [0, -height / 2 + 1.12, 0], [wallLen, 0.12, 0.38], [0, 0, 0], mats.goldKapton);
                addPrimitive(wallGroup, 'box', 'GlassPane', [0, 0.1, 0], [wallLen - 0.4, height - 1.8, 0.08], [0, 0, 0], mats.glassVisor);
                for (let mx = -wallLen / 2 + 2.8; mx < wallLen / 2 - 1.0; mx += 3.2) {
                    addPrimitive(wallGroup, 'box', 'Mullion', [mx, 0.1, 0], [0.24, height - 1.7, 0.38], [0, 0, 0], mats.titaniumHull);
                }
            }
        };

        addWall('north', width, true);
        addWall('south', width, true);
        addWall('east', depth, false);
        addWall('west', depth, false);

        // Structural steel ribs along East/West walls — NEVER place a rib inside an East/West doorway (|rz| < 2.5)!
        const ribCount = Math.max(2, Math.floor(depth / 3.5));
        for (let i = 0; i <= ribCount; i++) {
            const rz = -depth / 2 + (i / ribCount) * depth;
            const skipWest = (options.west === 'door' || options.west === 'open') && Math.abs(rz) < 2.6;
            const skipEast = (options.east === 'door' || options.east === 'open') && Math.abs(rz) < 2.6;
            if (!skipWest) {
                addPrimitive(room, 'box', `RibW_${i}`, [-width / 2 + 0.14, height / 2, rz], [0.24, height, 0.24], [0, 0, 0], mats.darkStructural);
            }
            if (!skipEast) {
                addPrimitive(room, 'box', `RibE_${i}`, [ width / 2 - 0.14, height / 2, rz], [0.24, height, 0.24], [0, 0, 0], mats.darkStructural);
            }
        }

        return { room, lightEnt };
    }

    function buildSpaceStationScene(app, mats) {
        const root = new pc.Entity('StationWorldRoot');
        app.root.addChild(root);

        const Arch = window.OrbitalGame.MeshArchitect;
        const emergencyLights = [];
        const collectibleNodes = {};

        // =========================================================================
        // 1. EXTERIOR ORBITAL VISTA (ROTATING 3D EARTH, SUN, EXTERNAL LATTICE TRUSSES & RADIATORS)
        // =========================================================================
        const vistaRoot = new pc.Entity('ExteriorVista');
        root.addChild(vistaRoot);

        const sunLight = new pc.Entity('OrbitalSunLight');
        sunLight.addComponent('light', {
            type: 'directional',
            color: new pc.Color(1.0, 0.96, 0.88),
            intensity: 1.85,
            castShadows: true,
            shadowResolution: 2048,
            shadowDistance: 65,
            shadowType: pc.SHADOW_PCF3,
            normalOffsetBias: 0.05,
            shadowBias: 0.2
        });
        sunLight.setLocalEulerAngles(32, -35, 0);
        vistaRoot.addChild(sunLight);

        // Colossal Low-Earth Orbit (LEO) Planet Earth with Custom WebGL2 Surface, Cloud Shadow, City Lights & Fresnel Rayleigh Limb Shader
        const earthGroup = new pc.Entity('PlanetEarthGroup');
        earthGroup.setLocalPosition(-6, -104, -145);
        vistaRoot.addChild(earthGroup);

        const earthSphere = addPrimitive(earthGroup, 'sphere', 'EarthBody', [0, 0, 0], [224, 224, 224], [78, -25, -16], mats.earthSurface, false, false);
        addPrimitive(earthGroup, 'sphere', 'EarthAtmosphereHalo', [0, 0, 0], [227.6, 227.6, 227.6], [0, 0, 0], mats.earthAtmosphere, false, false);

        // 3D Moon (Luna) with Mare Basalt Plains & Impact Craters in Deep Space
        const moonSphere = addPrimitive(vistaRoot, 'sphere', 'OrbitalMoonLuna', [-26, 15, -168], [11.5, 11.5, 11.5], [12, 40, -8], mats.moonSurface, false, false);

        // 3D Astrophysical Sun & Anamorphic Solar Corona in Deep Space (aligned with uSunDir)
        const sunStarGroup = new pc.Entity('AstrophysicalSun');
        sunStarGroup.setLocalPosition(36, 18, -162);
        vistaRoot.addChild(sunStarGroup);
        const sunCoreMat = mats.createEmissive(1.0, 0.98, 0.92, 8.0);
        const sunHaloMat = mats.createEmissive(1.0, 0.72, 0.35, 2.2);
        sunHaloMat.opacity = 0.28;
        sunHaloMat.blendType = pc.BLEND_ADDITIVE;
        sunHaloMat.depthWrite = false;
        sunHaloMat.update();
        addPrimitive(sunStarGroup, 'sphere', 'SolarPhotosphere', [0, 0, 0], [3.8, 3.8, 3.8], [0, 0, 0], sunCoreMat, false, false);
        addPrimitive(sunStarGroup, 'sphere', 'SolarCoronaInner', [0, 0, 0], [10.5, 10.5, 10.5], [0, 0, 0], sunHaloMat, false, false);
        addPrimitive(sunStarGroup, 'box', 'SolarAnamorphicStreakH', [0, 0, 0], [28.0, 0.24, 0.24], [0, 0, 0], sunHaloMat, false, false);
        addPrimitive(sunStarGroup, 'box', 'SolarAnamorphicStreakV', [0, 0, 0], [0.24, 12.0, 0.24], [0, 0, 0], sunHaloMat, false, false);

        // Holo-Globe material for Command Bridge tactical table
        const atmoMat = new pc.StandardMaterial();
        atmoMat.diffuse = new pc.Color(0.02, 0.15, 0.35);
        atmoMat.emissive = new pc.Color(0.05, 0.55, 1.0);
        atmoMat.emissiveIntensity = 1.4;
        atmoMat.opacity = 0.42;
        atmoMat.blendType = pc.BLEND_ADDITIVE;
        atmoMat.depthWrite = false;
        atmoMat.update();

        // External Station Lattice Truss Wings, Solar Arrays (PV-4), and White Accordion Radiators (matching helios9_reference_sheet.jpg)
        const extTruss = new pc.Entity('ExternalStationWings');
        extTruss.setLocalPosition(0, 1.0, -34);
        vistaRoot.addChild(extTruss);

        Arch.createLatticeTruss(extTruss, mats, 'PortLatticeBoom', [-18, -0.8, 0], [0, 90, 0], 24, 1.4, 8);
        Arch.createLatticeTruss(extTruss, mats, 'StarboardLatticeBoom', [18, -0.8, 0], [0, 90, 0], 24, 1.4, 8);

        for (let side of [-1, 1]) {
            addPrimitive(extTruss, 'box', `SolarWingA_${side}`, [side * 16, 0, -5.5], [14, 0.08, 4.2], [25, 0, 0], mats.solarPanel);
            addPrimitive(extTruss, 'box', `SolarWingB_${side}`, [side * 16, 0,  5.5], [14, 0.08, 4.2], [25, 0, 0], mats.solarPanel);
            addPrimitive(extTruss, 'box', `GoldHub_${side}`, [side * 8.8, -1.4, 0], [2.4, 2.2, 2.6], [0, 0, 0], mats.goldKapton);
            // White Accordion Heat Radiator Fins at 45 degrees
            addPrimitive(extTruss, 'box', `RadiatorFin_${side}`, [side * 10.5, 3.2, 4.0], [6.5, 0.08, 2.4], [45, side * 35, 0], mats.paddedBulkhead);
        }

        // =========================================================================
        // 2. CENTRAL HUB & TOROIDAL TOKAMAK FUSION REACTOR [0, 0, 0]
        // =========================================================================
        const hub = buildRoomShell(root, mats, 0, 0, 15, 15, 5.8, {
            name: 'CentralHub',
            north: 'door',
            south: 'door',
            east: 'door',
            west: 'door',
            lightColor: [0.55, 0.85, 1.0],
            lightIntensity: 1.65
        });
        emergencyLights.push(hub.lightEnt);

        // Overhead Lattice Gantry Beams inside Central Hub
        Arch.createLatticeTruss(hub.room, mats, 'HubOverheadTrussX', [0, 4.9, 0], [0, 90, 0], 14.2, 0.75, 6);
        Arch.createLatticeTruss(hub.room, mats, 'HubOverheadTrussZ', [0, 4.9, 0], [0, 0, 0], 14.2, 0.75, 6);

        // Toroidal Tokamak Reactor Assembly (TR-1)
        const tokamak = Arch.createTokamakReactorAssembly(app, mats, root);
        tokamak.plasmaOuterMat.emissiveIntensity = 0.48;
        tokamak.plasmaOuterMat.opacity = 0.2;
        tokamak.plasmaOuterMat.update();
        tokamak.reactorLight.light.range = 9.5;

        // A warm service light gives the containment drum readable curved metal
        // without letting the plasma light flatten the entire room to cyan.
        const maintenanceFill = new pc.Entity('ReactorMaintenanceFill');
        maintenanceFill.addComponent('light', {
            type: 'point',
            color: new pc.Color(1.0, 0.88, 0.72),
            intensity: 1.05,
            range: 10.5,
            castShadows: false
        });
        maintenanceFill.setLocalPosition(2.8, 2.3, 4.7);
        hub.room.addChild(maintenanceFill);

        // Small mechanical collars and service studs add readable scale to the
        // existing pedestal; these decorative meshes have no collision bodies.
        const pedestalRim = Arch.createTorusMesh(app.graphicsDevice, 2.275, 0.026, 64, 8);
        [0.1, 0.6].forEach((rimY, index) => {
            Arch.addCustomMeshEntity(tokamak.reactorGroup, `PedestalRim_${index}`, pedestalRim, mats.titaniumHull, [0, rimY, 0]);
        });
        for (let i = 0; i < 16; i++) {
            const angle = i * Math.PI / 8;
            const px = Math.sin(angle) * 2.305;
            const pz = Math.cos(angle) * 2.305;
            addPrimitive(tokamak.reactorGroup, 'box', `ServiceStud_${i}`, [px, 0.36, pz], [0.075, 0.22, 0.045], [0, i * 22.5, 0], mats.titaniumHull);
        }

        // Reactor Detonation & Delta-V Calculation Console at [0, 0, -3.55]
        const reactorConsole = new pc.Entity('ReactorOverloadConsole');
        reactorConsole.setLocalPosition(0, 0, -3.55);
        root.addChild(reactorConsole);
        addPrimitive(reactorConsole, 'box', 'ConsoleStand', [0, 0.6, 0], [1.65, 1.2, 0.75], [0, 0, 0], mats.darkStructural);
        const reactorScreenMat = mats.createScreenMaterial(
            'TOKAMAK TR-1 // BLAST IMPULSE CALC',
            [
                'TARGET dV : 3.20 km/s (G-LIMIT <30G)',
                'CATALYST  : OFFLINE',
                'YIELD SET : UNCALIBRATED',
                'PRESS [E] TO OPEN IMPULSE CALCULATOR'
            ],
            '#00f0ff'
        );
        addPrimitive(reactorConsole, 'box', 'ConsoleScreen', [0, 1.32, 0.05], [1.5, 0.72, 0.08], [-22, 0, 0], reactorScreenMat);

        // Station Emergency Power Bus Breaker Console at [4.2, 0, -5.8]
        const powerConsole = new pc.Entity('PowerDistributionConsole');
        powerConsole.setLocalPosition(4.2, 0, -5.8);
        powerConsole.setLocalEulerAngles(0, -25, 0);
        root.addChild(powerConsole);
        addPrimitive(powerConsole, 'box', 'PowerStand', [0, 0.6, 0], [1.4, 1.2, 0.65], [0, 0, 0], mats.hazardStripe);
        const powerScreenMat = mats.createScreenMaterial(
            'EMERGENCY POWER BUS // 120 kW MAX',
            [
                'AVAILABLE : 120 kW GENERATOR',
                'ROUTE POWER TO SECTOR TERMINALS',
                'AND ESCAPE POD UMBILICAL CHARGER',
                'PRESS [E] OR [P] TO ALLOCATE POWER'
            ],
            '#ffae00'
        );
        addPrimitive(powerConsole, 'box', 'PowerScreen', [0, 1.3, 0.05], [1.28, 0.66, 0.08], [-20, 0, 0], powerScreenMat);

        // =========================================================================
        // 3. NORTH CORRIDOR & COMMAND BRIDGE / OBSERVATION CUPOLA [0, 0, -18]
        // =========================================================================
        buildRoomShell(root, mats, 0, -10.2, 4.6, 6.2, 3.8, {
            name: 'NorthCorridor',
            north: 'open',
            south: 'open',
            wallMat: mats.titaniumHull,
            lightIntensity: 1.15
        });

        const bridge = buildRoomShell(root, mats, 0, -17.8, 13.4, 9.6, 4.6, {
            name: 'CommandBridge',
            north: 'window',
            south: 'door',
            west: 'door',
            lightColor: [0.6, 0.85, 1.0],
            lightIntensity: 1.55
        });
        emergencyLights.push(bridge.lightEnt);

        // Tactical Astrodynamics Holo-Globe in center of Bridge (positioned below eye level for clear Cupola view)
        addPrimitive(bridge.room, 'cylinder', 'HoloTableBase', [0, 0.28, -0.5], [1.9, 0.56, 1.9], [0, 0, 0], mats.darkStructural);
        const holoRingMesh = Arch.createTorusMesh(app.graphicsDevice, 0.62, 0.022, 36, 12);
        const cyanEmit = mats.createEmissive(0.0, 0.95, 1.0, 2.4);
        Arch.addCustomMeshEntity(bridge.room, 'HoloOrbitRing', holoRingMesh, cyanEmit, [0, 0.92, -0.5], [1, 1, 1], [25, 0, -18]);
        const holoGlobe = addPrimitive(bridge.room, 'sphere', 'HoloEarthProj', [0, 0.92, -0.5], [0.56, 0.56, 0.56], [0, 0, 0], atmoMat);

        // Life Support O2 Refill Station on West side of Bridge [-4.2, 0, -20.2]
        addPrimitive(root, 'cylinder', 'O2SupplyTank1', [-4.6, 1.1, -21.2], [0.55, 2.2, 0.55], [0, 0, 0], mats.goldKapton);
        addPrimitive(root, 'cylinder', 'O2SupplyTank2', [-3.8, 1.1, -21.2], [0.55, 2.2, 0.55], [0, 0, 0], mats.titaniumHull);
        addPrimitive(root, 'box', 'O2ConsoleBase', [-4.2, 0.6, -20.2], [1.3, 1.2, 0.8], [0, 18, 0], mats.darkStructural);
        const o2ScreenMat = mats.createScreenMaterial(
            'LIFE SUPPORT // O2 MANIFOLD',
            [
                'HIGH-PRESSURE OXYGEN RESERVOIR',
                'PRESS [E] TO REFILL EVA SUIT O2',
                'AND PRESSURIZE POD LIFE SUPPORT'
            ],
            '#00ff9d'
        );
        addPrimitive(root, 'box', 'O2Screen', [-4.2, 1.28, -20.1], [1.15, 0.55, 0.08], [-18, 18, 0], o2ScreenMat);

        // Right Helm Console for Orbital Trajectory Gyro Core [4.2, 0, -20.2]
        addPrimitive(bridge.room, 'box', 'HelmConsoleRight', [4.2, 0.5, -2.4], [1.5, 1.0, 1.4], [0, 0, 0], mats.darkStructural);

        // =========================================================================
        // 4. NORTH-WEST THERMAL LAB & EVA AIRLOCK [-15, 0, -18]
        // =========================================================================
        buildRoomShell(root, mats, -8.8, -18.0, 4.4, 4.2, 3.6, {
            name: 'NWCorridor',
            east: 'open',
            west: 'open',
            wallMat: mats.titaniumHull,
            lightIntensity: 1.05
        });

        const thermalLab = buildRoomShell(root, mats, -15.0, -18.0, 8.8, 8.8, 4.2, {
            name: 'ThermalLab',
            east: 'door',
            stripColor: [1.0, 0.38, 0.15],
            lightColor: [1.0, 0.65, 0.5],
            lightIntensity: 1.45
        });
        emergencyLights.push(thermalLab.lightEnt);

        addPrimitive(thermalLab.room, 'cylinder', 'ThermalPedestal', [-2.2, 0.5, 0], [1.6, 1.0, 1.6], [0, 0, 0], mats.hazardStripe);
        addPrimitive(thermalLab.room, 'cylinder', 'EVAAirlockHatch', [0, 1.8, -4.1], [2.2, 0.4, 2.2], [90, 0, 0], mats.goldKapton);

        // =========================================================================
        // 5. EAST CORRIDOR & CRYO-ENGINEERING BAY [18, 0, 0]
        // =========================================================================
        buildRoomShell(root, mats, 9.8, 0, 5.6, 4.6, 3.8, {
            name: 'EastCorridor',
            east: 'open',
            west: 'open',
            wallMat: mats.titaniumHull,
            lightIntensity: 1.15
        });

        const engBay = buildRoomShell(root, mats, 17.8, 0, 11.4, 11.4, 4.8, {
            name: 'EngineeringBay',
            west: 'door',
            wallMat: mats.titaniumHull,
            lightColor: [0.4, 0.9, 1.0],
            lightIntensity: 1.55
        });
        emergencyLights.push(engBay.lightEnt);

        const coilGlow = mats.createEmissive(0.0, 0.85, 1.0, 2.4);
        for (let zSide of [-3.5, 3.5]) {
            addPrimitive(engBay.room, 'cylinder', `TurbineBody_${zSide}`, [-1.0, 1.4, zSide], [1.6, 5.2, 1.6], [0, 0, 90], mats.darkStructural);
            addPrimitive(engBay.room, 'cylinder', `TurbineGlow_${zSide}`, [-1.0, 1.4, zSide], [1.72, 1.2, 1.72], [0, 0, 90], coilGlow);
        }
        addPrimitive(engBay.room, 'cylinder', 'CatalystPedestal', [3.4, 0.5, 0], [1.3, 1.0, 1.3], [0, 0, 0], mats.darkStructural);

        // =========================================================================
        // 6. WEST CORRIDOR & HEAVY STRUCTURAL MAINTENANCE BAY [-18, 0, 0]
        // =========================================================================
        buildRoomShell(root, mats, -9.8, 0, 5.6, 4.6, 3.8, {
            name: 'WestCorridor',
            east: 'open',
            west: 'open',
            wallMat: mats.titaniumHull,
            lightIntensity: 1.15
        });

        const maintBay = buildRoomShell(root, mats, -17.8, 0, 11.4, 11.4, 4.8, {
            name: 'MaintenanceBay',
            east: 'door',
            wallMat: mats.titaniumHull,
            stripColor: [1.0, 0.72, 0.1],
            lightColor: [1.0, 0.82, 0.55],
            lightIntensity: 1.55
        });
        emergencyLights.push(maintBay.lightEnt);

        Arch.createLatticeTruss(maintBay.room, mats, 'MaintCraneGantry', [0, 4.1, 0], [0, 0, 0], 10.5, 0.9, 5);
        addPrimitive(maintBay.room, 'box', 'CargoCrate1', [1.2, 0.9, -3.6], [2.4, 1.8, 1.8], [0, 12, 0], mats.goldKapton);
        addPrimitive(maintBay.room, 'box', 'CargoCrate2', [-1.8, 0.7, 3.6], [2.0, 1.4, 2.0], [0, -8, 0], mats.hazardStripe);
        addPrimitive(maintBay.room, 'cylinder', 'DampenerPedestal', [-3.4, 0.5, 0], [1.4, 1.0, 1.4], [0, 0, 0], mats.darkStructural);

        // =========================================================================
        // 7. SOUTH CORRIDOR & ESCAPE POD LAUNCH HANGAR "KESTREL-01" [0, 0, 18]
        // =========================================================================
        buildRoomShell(root, mats, 0, 10.2, 4.6, 6.2, 3.8, {
            name: 'SouthCorridor',
            north: 'open',
            south: 'open',
            wallMat: mats.titaniumHull,
            stripColor: [1.0, 0.55, 0.1],
            lightIntensity: 1.2
        });

        const hangar = buildRoomShell(root, mats, 0, 18.0, 13.6, 10.6, 5.4, {
            name: 'EscapePodHangar',
            north: 'door',
            south: 'window',
            wallMat: mats.titaniumHull,
            stripColor: [0.0, 1.0, 0.65],
            lightColor: [0.7, 0.9, 1.0],
            lightIntensity: 1.8
        });
        emergencyLights.push(hangar.lightEnt);

        // Axial Launch Collar & Umbilical Gantry around Escape Pod [0, 0, 21.0]
        addPrimitive(hangar.room, 'cylinder', 'LaunchBayRing', [0, 0.15, 3.0], [4.4, 0.3, 4.4], [0, 0, 0], mats.hazardStripe);
        const collarTorus = Arch.createTorusMesh(app.graphicsDevice, 2.15, 0.16, 36, 14);
        Arch.addCustomMeshEntity(hangar.room, 'EjectionCollarTorus', collarTorus, mats.goldKapton, [0, 2.3, 3.0]);

        const hangarPod = Arch.createKestrelPodEntity(app, mats, {});
        hangarPod.setLocalPosition(0, 1.65, 21.0);
        root.addChild(hangarPod);

        // Pod Engineering & Blueprint Console at [-3.2, 0, 18.5]
        const podConsole = new pc.Entity('PodDiagnosticConsole');
        podConsole.setLocalPosition(-3.2, 0, 18.5);
        podConsole.setLocalEulerAngles(0, 35, 0);
        root.addChild(podConsole);
        addPrimitive(podConsole, 'box', 'PodConsoleBase', [0, 0.6, 0], [1.6, 1.2, 0.7], [0, 0, 0], mats.darkStructural);
        const podScreenMat = mats.createScreenMaterial(
            'KESTREL-01 // FLIGHT & BLUEPRINT CAD',
            [
                'INSTALLED MODULES: 0 / 5',
                'WET MASS : 1,850 kg | O2: 35%',
                'DESCENT SEQUENCER: UNCALIBRATED',
                'PRESS [E] TO OPEN CAD & SIMULATOR'
            ],
            '#ffae00'
        );
        addPrimitive(podConsole, 'box', 'PodConsoleScreen', [0, 1.32, 0.05], [1.48, 0.72, 0.08], [-20, 0, 0], podScreenMat);

        // Hangar Propellant / O2 / Parachute Sequencer Rack at [5.2, 0, 17.5]
        addPrimitive(root, 'cylinder', 'RetroRackPedestal', [5.2, 0.5, 17.5], [1.35, 1.0, 1.35], [0, 0, 0], mats.darkStructural);

        // =========================================================================
        // 8. BUILD THE 5 COLLECTIBLE / CALIBRATABLE 3D MODULE ENTITIES
        // =========================================================================
        ESCAPE_MODULES.forEach((mod) => {
            const itemRoot = new pc.Entity(`Collectible_${mod.id}`);
            itemRoot.setLocalPosition(mod.pos[0], mod.pos[1], mod.pos[2]);
            root.addChild(itemRoot);

            const glowMat = mats.createEmissive(mod.color[0], mod.color[1], mod.color[2], 2.8);
            const visualGroup = new pc.Entity('VisualModel');
            itemRoot.addChild(visualGroup);

            if (mod.id === 'plasma_cell') {
                addPrimitive(visualGroup, 'cylinder', 'CellCore', [0, 0.25, 0], [0.42, 0.75, 0.42], [0, 0, 0], glowMat);
                addPrimitive(visualGroup, 'cylinder', 'CellCapT', [0, 0.65, 0], [0.52, 0.12, 0.52], [0, 0, 0], mats.goldKapton);
                addPrimitive(visualGroup, 'cylinder', 'CellCapB', [0, -0.15, 0], [0.52, 0.12, 0.52], [0, 0, 0], mats.goldKapton);
            } else if (mod.id === 'blast_dampener') {
                addPrimitive(visualGroup, 'cylinder', 'DampPlate', [0, 0.1, 0], [0.85, 0.14, 0.85], [0, 0, 0], mats.goldKapton);
                addPrimitive(visualGroup, 'cylinder', 'DampPiston', [0, 0.38, 0], [0.36, 0.55, 0.36], [0, 0, 0], mats.titaniumHull);
                addPrimitive(visualGroup, 'cylinder', 'DampRing', [0, 0.38, 0], [0.52, 0.12, 0.52], [0, 0, 0], glowMat);
            } else if (mod.id === 'nav_gyro') {
                addPrimitive(visualGroup, 'sphere', 'GyroCore', [0, 0.28, 0], [0.36, 0.36, 0.36], [0, 0, 0], glowMat);
                addPrimitive(visualGroup, 'cylinder', 'GyroOuter', [0, 0.28, 0], [0.68, 0.08, 0.68], [35, 0, 20], mats.goldKapton);
            } else if (mod.id === 'heat_shield') {
                addPrimitive(visualGroup, 'cylinder', 'ShieldDisc', [0, 0.25, 0], [0.95, 0.16, 0.95], [25, 0, 0], mats.carbonAblative);
                addPrimitive(visualGroup, 'cylinder', 'ShieldRim', [0, 0.25, 0], [1.02, 0.06, 1.02], [25, 0, 0], glowMat);
            } else if (mod.id === 'retro_chute') {
                addPrimitive(visualGroup, 'box', 'ChutePack', [0, 0.25, 0], [0.58, 0.58, 0.45], [0, 0, 0], mats.hazardStripe);
                addPrimitive(visualGroup, 'cone', 'Thruster1', [-0.36, 0.2, 0], [0.24, 0.45, 0.24], [0, 0, 15], glowMat);
                addPrimitive(visualGroup, 'cone', 'Thruster2', [ 0.36, 0.2, 0], [0.24, 0.45, 0.24], [0, 0, -15], glowMat);
            }

            addPrimitive(itemRoot, 'cylinder', 'BeaconRing', [0, -0.1, 0], [0.95, 0.04, 0.95], [0, 0, 0], glowMat);
            const itemLight = new pc.Entity('ItemLight');
            itemLight.addComponent('light', {
                type: 'point',
                color: new pc.Color(mod.color[0], mod.color[1], mod.color[2]),
                intensity: 1.8,
                range: 5.5
            });
            itemLight.setLocalPosition(0, 0.6, 0);
            itemRoot.addChild(itemLight);

            collectibleNodes[mod.id] = { root: itemRoot, visualGroup, meta: mod };
        });

        const updateStation = (dt, time, reactorArmed) => {
            if (mats.earthSurface && mats.earthSurface.setParameter) {
                mats.earthSurface.setParameter('uTime', time);
            }
            earthSphere.rotateLocal(0, dt * 0.75, 0);
            moonSphere.rotateLocal(0, dt * 0.35, 0);
            holoGlobe.rotateLocal(0, dt * 18, 0);

            const speedMult = reactorArmed ? 4.2 : 1.0;
            tokamak.gimbalRing1.rotateLocal(dt * 42 * speedMult, dt * 60 * speedMult, 0);
            tokamak.gimbalRing2.rotateLocal(-dt * 50 * speedMult, 0, dt * 38 * speedMult);
            tokamak.plasmaCore.rotateLocal(0, dt * 95 * speedMult, 0);

            if (reactorArmed) {
                tokamak.plasmaCoreMat.emissive.set(1.0, 0.32, 0.1);
                tokamak.plasmaCoreMat.emissiveIntensity = 1.25 + Math.sin(time * 16) * 0.25;
                tokamak.plasmaCoreMat.update();
                tokamak.reactorLight.light.color.set(1.0, 0.28, 0.15);
                tokamak.reactorLight.light.intensity = 1.15 + Math.sin(time * 16) * 0.35;
            } else {
                tokamak.plasmaCoreMat.emissive.set(0.07, 0.4, 0.62);
                tokamak.plasmaCoreMat.emissiveIntensity = 0.9;
                tokamak.plasmaCoreMat.update();
                tokamak.reactorLight.light.color.set(0.18, 0.64, 1.0);
                tokamak.reactorLight.light.intensity = 0.72;
            }

            Object.values(collectibleNodes).forEach((node, idx) => {
                if (node.root.enabled) {
                    node.visualGroup.setLocalPosition(0, Math.sin(time * 2.8 + idx) * 0.09, 0);
                    node.visualGroup.rotateLocal(0, dt * 55, 0);
                }
            });
        };

        return {
            root,
            hangarPod,
            reactorScreenMat,
            powerScreenMat,
            podScreenMat,
            collectibleNodes,
            emergencyLights,
            updateStation,
            createEscapePodEntity: (inst) => Arch.createKestrelPodEntity(app, mats, inst)
        };
    }

    window.OrbitalGame.StationBuilder = {
        ESCAPE_MODULES,
        WALKABLE_RECTS,
        OBSTACLE_CIRCLES,
        isPositionWalkable,
        buildSpaceStationScene,
        createEscapePodEntity: (app, mats, inst) => window.OrbitalGame.MeshArchitect.createKestrelPodEntity(app, mats, inst)
    };
})();

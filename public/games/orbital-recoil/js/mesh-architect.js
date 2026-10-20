window.OrbitalGame = window.OrbitalGame || {};

(function () {
    // Create a custom revolved (lathe) mesh from an array of [r, y] profile points
    function createLatheMesh(device, profile, segments = 32) {
        const positions = [];
        const uvs = [];
        const indices = [];

        const rows = profile.length;
        for (let i = 0; i < rows; i++) {
            const r = profile[i][0];
            const y = profile[i][1];
            const v = i / Math.max(1, rows - 1);

            for (let j = 0; j <= segments; j++) {
                const u = j / segments;
                const theta = u * Math.PI * 2;
                const x = r * Math.cos(theta);
                const z = r * Math.sin(theta);
                positions.push(x, y, z);
                uvs.push(u * 2.0, v * 2.0);
            }
        }

        const stride = segments + 1;
        for (let i = 0; i < rows - 1; i++) {
            for (let j = 0; j < segments; j++) {
                const a = i * stride + j;
                const b = (i + 1) * stride + j;
                const c = (i + 1) * stride + (j + 1);
                const d = i * stride + (j + 1);
                // Two triangles (both windings if double-sided or outward normal)
                indices.push(a, b, d);
                indices.push(b, c, d);
                indices.push(a, d, b);
                indices.push(b, d, c);
            }
        }

        const normals = pc.calculateNormals(positions, indices);
        const tangents = pc.calculateTangents(positions, normals, uvs, indices);
        return pc.createMesh(device, positions, { normals, uvs, tangents, indices });
    }

    // Create a smooth 3D Torus mesh
    function createTorusMesh(device, majorRadius = 1.8, minorRadius = 0.42, tubularSegments = 40, radialSegments = 20) {
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        for (let j = 0; j <= radialSegments; j++) {
            for (let i = 0; i <= tubularSegments; i++) {
                const u = (i / tubularSegments) * Math.PI * 2;
                const v = (j / radialSegments) * Math.PI * 2;

                const cx = majorRadius * Math.cos(u);
                const cz = majorRadius * Math.sin(u);

                const x = (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u);
                const y = minorRadius * Math.sin(v);
                const z = (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u);

                positions.push(x, y, z);

                const nx = x - cx;
                const ny = y;
                const nz = z - cz;
                const len = Math.hypot(nx, ny, nz) || 1;
                normals.push(nx / len, ny / len, nz / len);

                uvs.push((i / tubularSegments) * 4.0, (j / radialSegments) * 2.0);
            }
        }

        for (let j = 1; j <= radialSegments; j++) {
            for (let i = 1; i <= tubularSegments; i++) {
                const a = (tubularSegments + 1) * j + i - 1;
                const b = (tubularSegments + 1) * (j - 1) + i - 1;
                const c = (tubularSegments + 1) * (j - 1) + i;
                const d = (tubularSegments + 1) * j + i;
                indices.push(a, b, d);
                indices.push(b, c, d);
            }
        }

        const tangents = pc.calculateTangents(positions, normals, uvs, indices);
        return pc.createMesh(device, positions, { normals, uvs, tangents, indices });
    }

    function addCustomMeshEntity(parent, name, mesh, material, pos, scale, rot, castShadows = false) {
        const ent = new pc.Entity(name);
        const mi = new pc.MeshInstance(mesh, material);
        mi.castShadow = castShadows;
        ent.addComponent('render', {
            meshInstances: [mi],
            castShadows: castShadows,
            receiveShadows: true
        });
        if (pos) ent.setLocalPosition(pos[0], pos[1], pos[2]);
        if (scale) ent.setLocalScale(scale[0], scale[1], scale[2]);
        if (rot) ent.setLocalEulerAngles(rot[0], rot[1], rot[2]);
        parent.addChild(ent);
        return ent;
    }

    function addPrim(parent, type, name, pos, scale, rot, material, castShadows = false) {
        const e = new pc.Entity(name);
        e.addComponent('render', {
            type: type,
            material: material,
            castShadows: castShadows,
            receiveShadows: true
        });
        if (pos) e.setLocalPosition(pos[0], pos[1], pos[2]);
        if (scale) e.setLocalScale(scale[0], scale[1], scale[2]);
        if (rot) e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
        parent.addChild(e);
        return e;
    }

    // Build open-lattice 3D structural truss girder (matching helios9_reference_sheet.jpg)
    function createLatticeTruss(parent, mats, name, pos, rot, length = 8.0, width = 1.6, bays = 4) {
        const root = new pc.Entity(name);
        if (pos) root.setLocalPosition(pos[0], pos[1], pos[2]);
        if (rot) root.setLocalEulerAngles(rot[0], rot[1], rot[2]);
        parent.addChild(root);

        const hw = width * 0.5;
        const beamThick = 0.09;
        // 4 longitudinal corner chords along Z
        [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]].forEach(([cx, cy], idx) => {
            addPrim(root, 'cylinder', `Chord_${idx}`, [cx, cy, 0], [beamThick, length, beamThick], [90, 0, 0], mats.titaniumHull);
        });

        // Cross-bracing frames and diagonals per bay
        const bayLen = length / bays;
        const diagLen = Math.hypot(width, bayLen);
        const diagAngle = (Math.atan2(width, bayLen) * 180) / Math.PI;

        for (let b = 0; b <= bays; b++) {
            const z = -length * 0.5 + b * bayLen;
            addPrim(root, 'box', `FrameT_${b}`, [0,  hw, z], [width, beamThick, beamThick], [0, 0, 0], mats.darkStructural);
            addPrim(root, 'box', `FrameB_${b}`, [0, -hw, z], [width, beamThick, beamThick], [0, 0, 0], mats.darkStructural);
            addPrim(root, 'box', `FrameL_${b}`, [-hw, 0, z], [beamThick, width, beamThick], [0, 0, 0], mats.darkStructural);
            addPrim(root, 'box', `FrameR_${b}`, [ hw, 0, z], [beamThick, width, beamThick], [0, 0, 0], mats.darkStructural);

            if (b < bays) {
                const mz = z + bayLen * 0.5;
                addPrim(root, 'box', `DiagT_${b}`, [0,  hw, mz], [beamThick * 0.75, beamThick * 0.75, diagLen], [0,  diagAngle, 0], mats.darkStructural);
                addPrim(root, 'box', `DiagB_${b}`, [0, -hw, mz], [beamThick * 0.75, beamThick * 0.75, diagLen], [0, -diagAngle, 0], mats.darkStructural);
                addPrim(root, 'box', `DiagL_${b}`, [-hw, 0, mz], [beamThick * 0.75, beamThick * 0.75, diagLen], [ diagAngle, 0, 0], mats.darkStructural);
                addPrim(root, 'box', `DiagR_${b}`, [ hw, 0, mz], [beamThick * 0.75, beamThick * 0.75, diagLen], [-diagAngle, 0, 0], mats.darkStructural);
            }
        }
        return root;
    }

    // Build Blueprint-Accurate Toroidal Tokamak Fusion Reactor (TR-1)
    function createTokamakReactorAssembly(app, mats, parent) {
        const device = app.graphicsDevice;
        const reactorGroup = new pc.Entity('TokamakReactor_TR1');
        parent.addChild(reactorGroup);

        // Heavy lower containment pedestal + hazard collar + gold MLI blanket
        addPrim(reactorGroup, 'cylinder', 'BasePedestal', [0, 0.35, 0], [4.6, 0.7, 4.6], [0, 0, 0], mats.darkStructural);
        addPrim(reactorGroup, 'cylinder', 'HazardRing', [0, 0.72, 0], [4.76, 0.14, 4.76], [0, 0, 0], mats.hazardStripe);
        addPrim(reactorGroup, 'cylinder', 'GoldCollarB', [0, 0.92, 0], [4.1, 0.28, 4.1], [0, 0, 0], mats.goldKapton);

        // Upper Cryo-Manifold Dome
        addPrim(reactorGroup, 'cylinder', 'TopCap', [0, 5.15, 0], [4.4, 0.65, 4.4], [0, 0, 0], mats.darkStructural);
        addPrim(reactorGroup, 'cylinder', 'GoldCollarT', [0, 4.75, 0], [3.9, 0.28, 3.9], [0, 0, 0], mats.goldKapton);

        // Central Solenoid Column
        addPrim(reactorGroup, 'cylinder', 'CentralSolenoid', [0, 2.85, 0], [1.15, 3.9, 1.15], [0, 0, 0], mats.titaniumHull);

        // Glowing Cyan Toroidal Plasma Vessel (Torus)
        const plasmaTorusMesh = createTorusMesh(device, 1.55, 0.42, 48, 24);
        const innerCoreTorusMesh = createTorusMesh(device, 1.55, 0.22, 40, 18);

        const plasmaOuterMat = mats.createEmissive(0.0, 0.82, 1.0, 2.8);
        plasmaOuterMat.opacity = 0.65;
        plasmaOuterMat.blendType = pc.BLEND_ADDITIVE;
        plasmaOuterMat.depthWrite = false;
        plasmaOuterMat.update();

        const plasmaCoreMat = mats.createEmissive(0.65, 0.96, 1.0, 4.5);

        const plasmaVessel = addCustomMeshEntity(reactorGroup, 'PlasmaTorusOuter', plasmaTorusMesh, plasmaOuterMat, [0, 2.85, 0]);
        const plasmaCore = addCustomMeshEntity(reactorGroup, 'PlasmaTorusCore', innerCoreTorusMesh, plasmaCoreMat, [0, 2.85, 0]);

        // 12 Radial Toroidal Field (TF) Coils around the Plasma Torus
        const tfCoilMesh = createTorusMesh(device, 0.56, 0.075, 24, 12);
        for (let i = 0; i < 12; i++) {
            const angleDeg = i * 30;
            const rad = (angleDeg * Math.PI) / 180;
            const cx = Math.cos(rad) * 1.55;
            const cz = Math.sin(rad) * 1.55;
            const coilMat = i % 3 === 0 ? mats.goldKapton : mats.titaniumHull;
            addCustomMeshEntity(
                reactorGroup,
                `TFCoil_${i}`,
                tfCoilMesh,
                coilMat,
                [cx, 2.85, cz],
                [1, 1.25, 1],
                [0, -angleDeg + 90, 90]
            );
        }

        // 2 Counter-Rotating Poloidal Stabilizer Rings
        const poloidalMesh = createTorusMesh(device, 2.25, 0.06, 40, 12);
        const gimbalRing1 = addCustomMeshEntity(reactorGroup, 'PoloidalRing1', poloidalMesh, mats.goldKapton, [0, 2.85, 0], [1, 1, 1], [18, 0, 0]);
        const gimbalRing2 = addCustomMeshEntity(reactorGroup, 'PoloidalRing2', poloidalMesh, mats.titaniumHull, [0, 2.85, 0], [1.06, 1.06, 1.06], [-18, 45, 0]);

        // Dynamic Point Light inside Reactor
        const reactorLight = new pc.Entity('ReactorCoreLight');
        reactorLight.addComponent('light', {
            type: 'point',
            color: new pc.Color(0.05, 0.88, 1.0),
            intensity: 3.2,
            range: 19
        });
        reactorLight.setLocalPosition(0, 2.85, 0);
        reactorGroup.addChild(reactorLight);

        return {
            reactorGroup,
            plasmaVessel,
            plasmaCore,
            plasmaOuterMat,
            plasmaCoreMat,
            gimbalRing1,
            gimbalRing2,
            reactorLight
        };
    }

    // Build Blueprint-Accurate Escape Pod "KESTREL-01" (matching blueprint_escape_pod.jpg)
    function createKestrelPodEntity(app, mats, installedMap = {}) {
        const device = app.graphicsDevice;
        const podRoot = new pc.Entity('EscapePod_KESTREL01');

        // 1. Contoured Conical-Blunt Crew Capsule Monocoque Hull (Lathe Mesh)
        const hullProfile = [
            [1.34, -0.68],
            [1.38, -0.45],
            [1.32, -0.10],
            [1.12,  0.45],
            [0.82,  1.10],
            [0.54,  1.62],
            [0.48,  1.72],
            [0.00,  1.74]
        ];
        const hullMesh = createLatheMesh(device, hullProfile, 36);
        addCustomMeshEntity(podRoot, 'MonocoqueHull', hullMesh, mats.titaniumHull, [0, 0, 0], [1, 1, 1], [0, 0, 0], true);

        // 8 Longitudinal Titanium Stiffening Ribs around the Conical Hull
        for (let i = 0; i < 8; i++) {
            const angle = i * 45;
            if (angle === 180) continue; // Leave space for Forward Armored Viewport at -Z
            const rad = (angle * Math.PI) / 180;
            addPrim(
                podRoot, 'box', `StiffenerRib_${i}`,
                [Math.sin(rad) * 1.06, 0.35, Math.cos(rad) * 1.06],
                [0.09, 1.75, 0.14],
                [-20 * Math.cos(rad), angle, 20 * Math.sin(rad)],
                mats.darkStructural
            );
        }

        // Forward Armored Fused-Silica Viewport (at -Z)
        addPrim(podRoot, 'box', 'ViewportFrame', [0, 0.52, -1.04], [0.86, 0.62, 0.22], [22, 0, 0], mats.darkStructural);
        const glassGlow = mats.createEmissive(0.12, 0.68, 0.95, 1.4);
        addPrim(podRoot, 'box', 'ViewportGlass', [0, 0.53, -1.11], [0.70, 0.46, 0.12], [22, 0, 0], glassGlow);

        // 4 Quad Hydrazine RCS Thruster Blocks
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2 + Math.PI / 4;
            addPrim(
                podRoot, 'box', `RCSQuad_${i}`,
                [Math.cos(a) * 1.18, 0.12, Math.sin(a) * 1.18],
                [0.24, 0.28, 0.24], [0, (i * 90) + 45, 0], mats.darkStructural
            );
        }

        // MODULE A: Carbon-Phenolic Hexagonal Honeycomb Ablative Heat Shield (Base Dome)
        const heatShieldGroup = new pc.Entity('Module_HeatShield');
        const shieldProfile = [
            [0.00, -1.04],
            [0.55, -1.01],
            [1.05, -0.92],
            [1.36, -0.78],
            [1.44, -0.66],
            [1.36, -0.62]
        ];
        const shieldMesh = createLatheMesh(device, shieldProfile, 36);
        addCustomMeshEntity(heatShieldGroup, 'AblativeHeatShieldDome', shieldMesh, mats.carbonAblative);
        const copperJointMat = mats.createEmissive(0.95, 0.48, 0.12, 1.2);
        const jointTorus = createTorusMesh(device, 1.40, 0.035, 36, 12);
        addCustomMeshEntity(heatShieldGroup, 'ExpansionJointRing', jointTorus, copperJointMat, [0, -0.67, 0]);
        podRoot.addChild(heatShieldGroup);

        // MODULE B: Rear Gold Kapton Blast Pusher-Plate & 4 Massive Hydraulic Shock-Absorber Pistons
        const dampenerGroup = new pc.Entity('Module_BlastDampener');
        // Heavy Gold Kapton Pusher Plate at base (-Y)
        addPrim(dampenerGroup, 'cylinder', 'GoldPusherPlate', [0, -1.42, 0], [2.95, 0.16, 2.95], [0, 0, 0], mats.goldKapton);
        addPrim(dampenerGroup, 'box', 'PusherCrossBrace1', [0, -1.32, 0], [2.6, 0.1, 0.22], [0, 45, 0], mats.darkStructural);
        addPrim(dampenerGroup, 'box', 'PusherCrossBrace2', [0, -1.32, 0], [2.6, 0.1, 0.22], [0, -45, 0], mats.darkStructural);
        // 4 Massive Hydraulic Shock-Absorber Dampener Pistons (angled between hull and pusher plate)
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2 + Math.PI / 4;
            const px = Math.cos(a) * 0.98;
            const pz = Math.sin(a) * 0.98;
            addPrim(dampenerGroup, 'cylinder', `HydraulicCylinder_${i}`, [px, -1.02, pz], [0.28, 0.62, 0.28], [0, 0, 0], mats.titaniumHull);
            addPrim(dampenerGroup, 'cylinder', `HydraulicRod_${i}`, [px, -1.22, pz], [0.16, 0.45, 0.16], [0, 0, 0], mats.goldKapton);
        }
        podRoot.addChild(dampenerGroup);

        // MODULE C: Triple Supersonic Parachute Mortar Canisters & 4 Angled Solid Retro-Thruster Nozzles
        const retroGroup = new pc.Entity('Module_RetroChute');
        for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3;
            addPrim(
                retroGroup, 'cylinder', `MortarCanister_${i}`,
                [Math.cos(a) * 0.26, 1.78, Math.sin(a) * 0.26],
                [0.34, 0.48, 0.34], [0, 0, 0], mats.hazardStripe
            );
        }
        const bellProfile = [
            [0.08,  0.22],
            [0.14,  0.05],
            [0.22, -0.18],
            [0.28, -0.36]
        ];
        const bellMesh = createLatheMesh(device, bellProfile, 20);
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            addCustomMeshEntity(
                retroGroup, `RetroBellNozzle_${i}`, bellMesh, mats.darkStructural,
                [Math.cos(a) * 1.28, -0.18, Math.sin(a) * 1.28],
                [1, 1, 1],
                [Math.sin(a) * 22, 0, -Math.cos(a) * 22]
            );
        }
        podRoot.addChild(retroGroup);

        // MODULE D: Orbital Trajectory Gyro Core Indicator Ring
        const gyroGroup = new pc.Entity('Module_NavGyro');
        const gyroRingMesh = createTorusMesh(device, 1.16, 0.04, 36, 12);
        const cyanGlow = mats.createEmissive(0.0, 0.95, 1.0, 2.8);
        addCustomMeshEntity(gyroGroup, 'GyroTelemetryRing', gyroRingMesh, cyanGlow, [0, 0.38, 0]);
        podRoot.addChild(gyroGroup);

        podRoot.syncModules = (installed) => {
            heatShieldGroup.enabled = !!installed.heat_shield;
            dampenerGroup.enabled = !!installed.blast_dampener;
            retroGroup.enabled = !!installed.retro_chute;
            gyroGroup.enabled = !!installed.nav_gyro;
        };
        podRoot.syncModules(installedMap);

        return podRoot;
    }

    window.OrbitalGame.MeshArchitect = {
        createLatheMesh,
        createTorusMesh,
        addCustomMeshEntity,
        createLatticeTruss,
        createTokamakReactorAssembly,
        createKestrelPodEntity
    };
})();

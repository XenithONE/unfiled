window.OrbitalGame = window.OrbitalGame || {};

(function () {
    const ENDING_DEFINITIONS = {
        EARTH_RETURN_SUCCESS: {
            id: 'EARTH_RETURN_SUCCESS',
            code: 'TRUE ENDING // 10',
            rank: 'S+ RANK : CHIEF ASTRO-ENGINEER SURVIVAL',
            rankColor: '#00ff9d',
            title: '爆縮反動推進・奇跡の地球完全生還',
            subtitle: 'OPERATION BLAST-SAIL COMPLETE — 全物理演算・軌道回廊・減速シーケンス完全一致',
            report: 'トカマク反応炉 [TR-1] の臨界爆縮出力と離脱ディレイを精密計算し、ポッド総質量に対する理想的な反動速度（ΔV = 3.20 km/s・最大衝撃 26.4G）を獲得。油圧ダンパーが衝撃波を完全吸収し、軌道計算ジャイロにより進入角 -6.20° の極狭な大気圏再突入回廊へ突入。ハニカム炭素耐熱シールドが 3,180℃ のプラズマを防ぎ抜き、高度 15km でドローグシュート、4.2km でメインシュート3基が開傘。高度 26m での逆噴射ロケット点火により秒速 6.4m で朝日輝く太平洋へ軟着水した！'
        },
        WEAK_BLAST_DRIFT: {
            id: 'WEAK_BLAST_DRIFT',
            code: 'BAD ENDING // 01',
            rank: 'MISSION FAILED : INSUFFICIENT DELTA-V',
            rankColor: '#00f0ff',
            title: '反動推力不足・地球へ届かず軌道永久漂流',
            subtitle: 'DELTA-V SHORTAGE (< 3.05 km/s) — 爆発出力不足により地球帰還軌道への遷移失敗',
            report: '【原因：プラズマ増強セル未装着 または 反応炉起爆出力の計算不足】宇宙ステーションを爆破したものの、ポッドの総質量に対して爆縮インパルスが不足し、得られた減速量は地球大気圏へ降下するための必要値（ΔV = 3.20 km/s）に届かなかった。脱出ポッドは高度 390km の楕円軌道に取り残され、眼下の青い地球へ永遠に降りられぬまま永久漂流となった。'
        },
        SHOCKWAVE_CRUSH: {
            id: 'SHOCKWAVE_CRUSH',
            code: 'BAD ENDING // 02',
            rank: 'MISSION FAILED : 44.8G STRUCTURAL CRUSH',
            rankColor: '#ff2a4b',
            title: '爆風直撃・耐G限界突破による軌道上木っ端微塵',
            subtitle: 'SHOCKWAVE OVERLOAD (> 30.5G) — 爆発の反動衝撃にポッド構造が耐えきれず爆散',
            report: '【原因：爆風反動ダンパー未装着・油圧減衰設定ミス・または離脱ディレイ過小】ステーションの超臨界爆発による凄まじいプラズマ衝撃波（40G超）がポッド後部を直撃した瞬間、油圧ダンパーのストロークが底突き（ボトムアウト）を起こしチタンモノコック船体が座屈・圧壊。推進力を得るどころか軌道上で木っ端微塵に吹き飛んだ。'
        },
        ORBIT_SKIP_LOST: {
            id: 'ORBIT_SKIP_LOST',
            code: 'BAD ENDING // 03',
            rank: 'MISSION FAILED : ATMOSPHERIC SKIP-OFF',
            rankColor: '#ffae00',
            title: '軌道逸脱・大気圏水切りスキップで深宇宙喪失',
            subtitle: 'ENTRY ANGLE TOO SHALLOW (> -5.3°) — 大気圏上端で弾かれ地球へ届かず深宇宙へ',
            report: '【原因：軌道計算ナビコア未装着 または 再突入ピッチ角が浅すぎた】ステーション爆発の反動で高速推進したものの、大気圏突入回廊（目標 -6.20°）に対して進入角が浅すぎたため、高度 95km の熱圏上端で水切り石のように猛烈なプラズマ火花を散らして大気圏外へスキップ（跳躍）。地球重力圏を振り切って暗黒の深宇宙へと永久に放り出された。'
        },
        ATMOS_BURNUP: {
            id: 'ATMOS_BURNUP',
            code: 'BAD ENDING // 04',
            rank: 'MISSION FAILED : 3,200°C THERMAL INCINERATION',
            rankColor: '#ff5500',
            title: '大気圏突入・超高熱プラズマによる空中分解大破',
            subtitle: 'HEAT SHIELD FAILURE / STEEP BALLISTIC ENTRY — 大気圏内で白熱融解し流れ星と化す',
            report: '【原因：ハニカム炭素耐熱シールド未装着 または 進入角が急すぎた（<-7.2°）】マッハ24で地球大気圏へ突入した際、1,420 W/cm² を超える断熱圧縮プラズマの猛烈な空力加熱に船殻が耐えられず、高度 72km で船体温度が 3,240℃ を突破。外装が白熱・融解して内部へ高熱ガスが流入し、夜空を焦がす無数の流星となって大気圏内で空中分解した。'
        },
        GROUND_CRASH: {
            id: 'GROUND_CRASH',
            code: 'BAD ENDING // 05',
            rank: 'MISSION FAILED : TERMINAL VELOCITY IMPACT',
            rankColor: '#ff2a4b',
            title: '減速不能・時速880kmで地表激突し墜落大爆発',
            subtitle: 'DECELERATION SYSTEM FAILURE — 大気圏突破後、減速できず地表へ垂直墜落',
            report: '【原因：パラシュート＆逆噴射モジュール未装着 または メインシュート開傘高度が低すぎた】ステーション爆発の反動推進と灼熱の大気圏再突入を乗り切ったものの、終端減速機構が作動せず。ポッドは時速 880km（マッハ 0.75）のまま雲海を突き抜けて沿岸の島嶼部へ垂直に激突し、巨大な火柱を上げて墜落大爆発した。'
        },
        SUPERSONIC_CHUTE_SHRED: {
            id: 'SUPERSONIC_CHUTE_SHRED',
            code: 'BAD ENDING // 06',
            rank: 'MISSION FAILED : SUPERSONIC CANOPY SHRED',
            rankColor: '#ff6b35',
            title: '超音速開傘・パラシュート空中断裂＆海面激突',
            subtitle: 'DROGUE DEPLOYED ABOVE 19.5km (MACH 4.5) — 超音速気流でシュートが吹き飛び墜落',
            report: '【原因：ドローグシュート開傘高度の設定が高すぎた（>19.5km）】大気圏減速が完了する前の高高度・マッハ4.5の超音速領域でパラシュートを強制射出したため、開傘した瞬間に凄まじい空力動圧でケブラー製ライザーとキャノピーがズタズタに断裂！減速手段を失ったポッドはそのまま自由落下し、海面へ激突して大破・爆散した。'
        },
        RETRO_TIMING_CRASH: {
            id: 'RETRO_TIMING_CRASH',
            code: 'BAD ENDING // 07',
            rank: 'MISSION FAILED : RETRO-ROCKET MISFIRE',
            rankColor: '#ffae00',
            title: '逆噴射高度ミス・着水寸前の失速落下で大破',
            subtitle: 'RETRO IGNITION ALTITUDE ERROR — 逆噴射ロケットの点火タイミング失策によりハードランディング',
            report: '【原因：固体逆噴射ロケットの点火高度設定ミス（適正 20m〜35m）】パラシュートでの減速には成功したものの、最終クッションとなる固体逆噴射ロケットを高すぎる高度（または着水後の0m）で点火設定していたため、海面激突時の衝撃（18G）を殺しきれず船底が圧壊・浸水爆発した。'
        },
        HYPOXIA_IN_ORBIT: {
            id: 'HYPOXIA_IN_ORBIT',
            code: 'BAD ENDING // 08',
            rank: 'MISSION FAILED : LIFE SUPPORT / RCS DEPLETION',
            rankColor: '#7fa2c4',
            title: '酸素・推進剤枯渇・地球目前で虚空の棺に',
            subtitle: 'O2 OR RCS PROPELLANT BELOW THRESHOLD — 帰還軌道上で生命維持が尽きサイレント・デス',
            report: '【原因：ポッド酸素タンク（80%未満）またはRCSヒドラジン推進剤（75%未満）の充填不足】ステーション爆発による軌道離脱には成功したものの、地球大気圏へ到達するまでの42分間の遷移飛行中にポッド内の酸素と姿勢制御推進剤が枯渇。窓の外に大きく迫る美しい地球を見つめながら、乗員は静かに意識を失った。'
        },
        STATION_MELTDOWN_TIMEOUT: {
            id: 'STATION_MELTDOWN_TIMEOUT',
            code: 'BAD ENDING // 09',
            rank: 'MISSION FAILED : CONSUMED BY MELTDOWN',
            rankColor: '#ff2a4b',
            title: '脱出遅延・臨界炉心融解と運命を共に',
            subtitle: 'CONTAINMENT BREACH OR SUIT HYPOXIA — 脱出前に宇宙ステーションが完全爆縮',
            report: '【原因：カウントダウン時間切れ または EVAスーツ酸素枯渇】脱出ポッドを発射する前に中央トカマク反応炉が磁場崩壊を起こし、宇宙ステーション HELIOS-9 全域が超新星さながらのプラズマ火球に呑み込まれた。'
        }
    };

    // Evaluate which of the 10 endings occurs based on modules + physics calculations
    function evaluateEnding(installed, isTimeout = false, engState = null) {
        if (isTimeout) return ENDING_DEFINITIONS.STATION_MELTDOWN_TIMEOUT;
        if (!installed.plasma_cell) return ENDING_DEFINITIONS.WEAK_BLAST_DRIFT;

        if (engState) {
            engState.recomputeReactorImpulse(installed);
            engState.recomputeEntryCorridor();

            if (engState.p6.computedDv < 3.05) return ENDING_DEFINITIONS.WEAK_BLAST_DRIFT;
            if (!installed.blast_dampener || !engState.p2.solved || engState.p6.computedG > 30.5) {
                return ENDING_DEFINITIONS.SHOCKWAVE_CRUSH;
            }
            if (engState.podO2 < 80 || engState.podRCS < 75) {
                return ENDING_DEFINITIONS.HYPOXIA_IN_ORBIT;
            }
            if (!installed.nav_gyro || engState.p4.entryAngle > -5.3) {
                return ENDING_DEFINITIONS.ORBIT_SKIP_LOST;
            }
            if (!installed.heat_shield || !engState.p3.solved || engState.p4.entryAngle < -7.2) {
                return ENDING_DEFINITIONS.ATMOS_BURNUP;
            }
            if (!installed.retro_chute) {
                return ENDING_DEFINITIONS.GROUND_CRASH;
            }
            if (engState.p5.drogueAltKm > 19.5) {
                return ENDING_DEFINITIONS.SUPERSONIC_CHUTE_SHRED;
            }
            if (engState.p5.drogueAltKm < 9.0 || engState.p5.mainAltKm < 2.2) {
                return ENDING_DEFINITIONS.GROUND_CRASH;
            }
            if (engState.p5.retroAltM > 55 || engState.p5.retroAltM < 10) {
                return ENDING_DEFINITIONS.RETRO_TIMING_CRASH;
            }
            return ENDING_DEFINITIONS.EARTH_RETURN_SUCCESS;
        }

        // Fallback when called with module map only
        if (!installed.blast_dampener) return ENDING_DEFINITIONS.SHOCKWAVE_CRUSH;
        if (!installed.nav_gyro) return ENDING_DEFINITIONS.ORBIT_SKIP_LOST;
        if (!installed.heat_shield) return ENDING_DEFINITIONS.ATMOS_BURNUP;
        if (!installed.retro_chute) return ENDING_DEFINITIONS.GROUND_CRASH;
        return ENDING_DEFINITIONS.EARTH_RETURN_SUCCESS;
    }

    // CinematicDirector lives in js/cinematic-director.js (loaded right after this file).
    window.OrbitalGame.CinematicEndings = {
        ENDING_DEFINITIONS,
        evaluateEnding,
        CinematicDirector: null
    };
})();

# AlicE ゲーム移行版

旧 alice-system のプレイ可能なゲーム13本をUNFILED内で配信します。

- [NITRO CROWN](nitro-crown.html) — 3Dカートレース（最大4人対戦）
- [RELIC ROAD](relic-road.html) — カード×ボードRPG（2〜4人）
- [THE HOLLOW WARD](hollow-ward.html) — 廃病棟協力型3Dホラー
- [SIGNAL SIEGE](tower-defense.html) — 対戦タワーディフェンス
- [THE EIDOLON](games/the-eidolon.html) — 闇の中の眼
- [RIFT COURIER](games/rift-courier.html) — 崩壊するリフトの配達人
- [I WANNA BE THE SIGNAL](games/iwbtg/index.html) — 全力で騙してくる死にゲー
- [LOCKER HUNT](games/locker-hunt.html) — ロッカーの中の小さな影
- [SIGNAL RUNNER](games/signal-runner.html) — 崩れる信号の隙間を走る
- [CONSTELLATION](games/constellation.html) — 星座の記憶パズル
- [DRAGON'S KEEP](games/dragons-keep.html) — ファンタジーピンボール
- [SCRAP CROWN](scrap-crown.html) — 物理演算ロボット闘技
- [VORTEX CROWN](vortex-crown.html) — 七層機装スピントップバトル

ゲームのルールと保存キーは原版を維持しています。同じブラウザ・同じ https://xenithone.github.io の保存領域に記録が残っていれば引き続き参照されます。別ドメインや別ブラウザの記録は自動移行されません。

オンライン対戦は原版のPeerJS/WebRTCを使用し、接続可否はネットワーク環境にも依存します。3D作品はWebGL対応ブラウザが必要です。操作は各ゲーム内の案内を参照してください。

移行時の修正は、UNFILEDへの戻り先、公開パスとメタ情報、RELIC ROADの画像と音声パス、存在しない任意画像へのリクエスト抑止です。任意画像のないゲームは原版の手続き描画をそのまま使います。

素材出典はASSET_CREDITS.mdとassets/quest/audio/LICENSES.md、実際の依存パッケージのライセンス全文はTHIRD_PARTY_NOTICES.txtに収録しています。パッケージのライセンス表記は後者を優先してください。

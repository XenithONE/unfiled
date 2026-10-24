# UNFILED

**まだ、何者でもないアイデアたち。**

AIと一緒に、思いつくままにつくった世界の入口。テーマの揃わない作品を、ひとつの空間から自由に見つけるための、XenithONEの制作物ポートフォリオです。

React・TypeScript・Viteで構築し、GitHub Pagesへ静的サイトとして公開します。ハブの背景は three.js の `WebGPURenderer` と TSL（Three Shading Language）で動く粒子の場で、最大 1,048,576 個の粒子が作品の表紙や文字を組み立てます。

## ローカルで開く

Node.js 22.12以降を使用してください。このフォルダーを開き、次のコマンドを実行します。

```sh
npm ci
npm run dev
```

ターミナルに表示されたローカルURLで開きます。公開用ファイルの確認は次のとおりです。

```sh
npm run build
npm run preview
```

## 粒子の場（ハブの仕組み）

- 画面全体が1枚の固定キャンバスです。粒子は TSL のコンピュートシェーダーで毎フレーム更新され、WebGPU が無い環境では three.js が WebGL2（transform feedback）へ自動で切り替えます。どちらも無い環境では粒子を描かず、作品一覧に表紙画像を並べます。
- 最初の画面では「UNFILED」の文字を粒子が組み立てます。マウスを動かすと粒子が逃げて渦を巻き、下へスクロールすると文字がほどけて塵に戻ります。
- 作品一覧では、作品名に触れる（タッチ端末では画面中央に来る）と、その作品の表紙を粒子が組み立てます。作品を選ぶと紹介とリンクが開きます。
- 「この場所について」では「好奇心に、完成はない。」の一文を粒子が描きます。
- 粒子数は端末に合わせて 1,048,576 / 589,824 / 262,144 / 147,456 から選び、描画が重いときは自動で粒子数と解像度を落とします。左下の表示（SYS / FIG / BLD）が現在の方式・粒子数・表示中の作品・ビルド時刻です。
- OSの「視差効果を減らす」「アニメーション効果をオフ」の設定では乱流と爆ぜる動きを抑え、右下のボタンで動きを止められます。キーボードでは Tab で作品へ移動でき、フォーカスした作品の表紙も粒子が組み立てます。
- 確認用のクエリ: `?gl=1`（WebGL2 を強制）、`?tier=ultra|high|mid|low`（粒子数の段階を固定）、`?motion=full|reduce`（動きの設定を上書き）。開発中は `window.__unfiled.stage` から `tuning`（明るさ・ブルーム・乱流などの uniform）と `step(dt)`（1フレーム進める）、`readBuffer(name)`（粒子バッファの読み戻し）が使えます。
- 仕組みの要点: 粒子ごとに「目標の座標と色」を持ち、表紙画像や文字を描いた1枚のキャンバス（`src/stage/targets.ts` の `TargetPainter`）から明るい画素だけが粒子を引き寄せます。暗い画素の粒子は束縛を離れ、カールノイズの流れに乗る塵になります。目標の切り替え時は粒子ごとに遅れて弾け、新しい形へ流れ込みます（`src/stage/ParticleStage.ts`）。

## 作品を追加・更新する

`public/projects.json`の配列を編集します。1作品につき1オブジェクトを追加してください。`id`は重複しない値にします。下記は入力形式の例です。

```json
[
  {
    "id": "nagi",
    "title": "NAGI",
    "subtitle": "あの日の、海。",
    "description": "時刻と天候を変えながら、桟橋を歩き、ラジオを聴く海辺。",
    "category": "WORLD",
    "year": "2026",
    "url": "https://xenithone.github.io/nostalgic-sea/",
    "source": "https://github.com/XenithONE/nostalgic-sea",
    "cover": "images/nagi.webp",
    "accent": "#8dd6c1"
  }
]
```

| 項目          | 内容                                    |
| ------------- | --------------------------------------- |
| `id`          | 半角英数字とハイフンの識別子            |
| `title`       | 作品名                                  |
| `subtitle`    | 短い副題                                |
| `description` | 作品の紹介文                            |
| `category`    | 作品の分類名                            |
| `year`        | 制作年                                  |
| `url`         | 実際の作品を開くHTTPS URL               |
| `source`      | 公開ソースコードのHTTPS URL（任意。省略するとソースへのリンクを表示しません） |
| `cover`       | `public/`を基準とした表紙画像の相対パス |
| `accent`      | 作品を表す色（例：`#8dd6c1`）           |

画像は`public/images/`へ置き、`cover`には先頭の`/`を付けずに指定します。表紙は一覧のサムネイルと詳細のほか、粒子が組み立てる目標にもなるので、暗すぎない（明るい部分が形を作る）画像だと粒子の形がはっきり出ます。JSONの末尾の余分なカンマに注意してください。更新後は`npm run build`で確認し、`main`へpushすると公開内容も更新されます。

表紙は、作品の空気感を表現するオリジナルの生成ビジュアルを使用しています。YOHAKU、IGNIS、TIDAL FORGE、PIGMENTの表紙には実際の作品画面を使用しています。TIDAL FORGEはWebGPUで描画したブラックホールのシーンPNGをそのまま掲載しています。PIGMENTは実際に描画した油彩の3D風景を掲載しています。各作品のリンクから実際のサイトを開けます。

## GitHub Pagesへ公開する

公開先の想定は`XenithONE/unfiled`、URLは[UNFILED](https://xenithone.github.io/unfiled/)です。初回デプロイが成功してからアクセスできます。

1. このフォルダーの内容を、GitHubの`XenithONE/unfiled`リポジトリのルートへpushします。`package-lock.json`も含めます。
2. リポジトリの **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択します。[GitHub公式の公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. `main`へのpush、または **Actions → Deploy UNFILED to GitHub Pages → Run workflow** で公開します。成功するとデプロイ結果に公開URLが表示されます。

`.github/workflows/deploy.yml`が`npm ci`と`npm run build`を実行し、`dist/`をPages用アーティファクトとしてアップロードして公開します。公開ジョブはビルドの成功後に実行されます。ワークフローの構成・権限・環境設定は[GitHub公式のカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に基づき、Node.jsの準備には[actions/setup-node](https://github.com/actions/setup-node)を使用しています。

Viteの`base`は`'./'`を使用します。画像とデータも相対パスで参照し、`/unfiled/`のようなプロジェクト配下から開ける構成です。

TIDAL FORGEは、同じPagesサイト内の`experiments/tidal-forge/`で公開します。`public/experiments/tidal-forge/`にはアプリの配布用静的ビルドを置き、UNFILEDのビルド時にそのまま配信先へコピーします。更新時はこのフォルダーを新しい配布用ビルド一式で置き換えます。WASM、WGSLシェーダー、銀河衝突の軌道データを含むため、一部のファイルだけを更新しないでください。元のソースリポジトリは非公開のまま、作品紹介には公開ソースへのリンクを掲載しません。

## 掲載作品

- [NAGI — あの日の、海。](https://xenithone.github.io/nostalgic-sea/)
- [AETHER — Orbital Station](https://xenithone.github.io/aether-orbital-station/)
- [CHRONOSCOPE — Temporal Navigation Instrument](https://xenithone.github.io/chronoscope/)
- [iro — 2D & 3D ペイントスタジオ](https://xenithone.github.io/web3d-painter/)
- [YOHAKU — 余白美術館](https://xenithone.github.io/yohaku-museum/)
- [月の別荘 — Moon Villa](https://xenithone.github.io/moon-villa/)
- [atelier — 油彩のアトリエ](https://xenithone.github.io/atelier-oil/)
- [IGNIS — 火山の鼓動を、目撃する。](https://xenithone.github.io/volcano-eruption/)
- [TIDAL FORGE — 銀河が交わり、光が曲がる。](https://xenithone.github.io/unfiled/experiments/tidal-forge/)
- [PIGMENT — 絵の向こうへ、歩いていこう。](https://xenithone.github.io/pigment-worlds/)
- [天井のむこう — 両親がいなくなった家で、まだ音がする。](https://xenithone.github.io/unfiled/comics/tenjou-no-mukou/)
- [RUSTWHIRL — 敵の攻撃を、自分の武器に。](https://xenithone.github.io/unfiled/games/rustwhirl/)
- [RAKUGAKI — ノートの山道を、ありえない速さで。](https://xenithone.github.io/unfiled/games/rakugaki/)
- [ALPINE LINE — 赤い列車で、氷河の谷へ。](https://xenithone.github.io/unfiled/games/alpine-rail/)
- [SCENE FORGE — 狙った動きを、映像の下絵に。](https://xenithone.github.io/unfiled/tools/scene-forge/)
- [三途の川 — 渡るのは、ひとりだけ。](https://xenithone.github.io/unfiled/films/sanzu-river/)

RUSTWHIRL ENDLESS 0.4は `public/games/rustwhirl/` から配信する独立したGodot製Webゲームです。無限WAVE、7種の通常敵、12種の装備、5WAVEごとのボス、端末内の上位5記録を備えます。WASM・PCK・JavaScript・音声ワークレットを一式で管理し、既存のPagesワークフローが `dist/games/rustwhirl/` へコピーして公開します。シングルスレッド版なので追加の分離ヘッダーやService Workerは不要です。公開前に戦闘・進行・保存・UIの116項目を検証済みです。

更新はローカルの `game/rustwhirl` プロジェクトで `tools/build_web.ps1` を実行し、最新メニューのキャプチャを `builds/web-captures/menu.png` に生成した後、このリポジトリの `tools/sync-rustwhirl.ps1` を実行します。同期スクリプトは配布物のSHA-256を確認してからコピーします。作品一覧の紹介は `public/projects.json`、同梱の操作説明とライセンスはゲームフォルダー内の `README_JA.md` と `THIRD_PARTY_NOTICES.txt` です。スコアはブラウザ内保存で、オンライン共通ランキングではありません。

「天井のむこう」は `public/comics/tenjou-no-mukou/` にある独立した静的Web漫画です。HTMLの台詞、オリジナルのカラー漫画画像、CC0収録素材を編集した割れ物・機械式電話・床板の軋み・喉の声と、Web Audioの効果音を使用します。「読みはじめる」のクリックで音を有効にし、人影を見たあとの新しい下向きスクロールで36コマの高速自動演出を開始します。最後は顔と片手の大きな専用画像に切り替わります。画面を離れる、停止ボタンを押す、Escapeを押すと演出を終了できます。音・動きの切り替えは設けず、毎回の「読みはじめる」で両方を有効にしてから本文を表示します。端末の動きを減らす設定では自動的にOFFにしません。停止後の再読でも両方が有効に戻ります。

接近演出は1本の長い床を実際に自動スクロールし、背景から切り抜いた幽霊を36姿勢で動かします。床は途中から闇に消え、最後は黒背景に顔と伸ばした手が画面いっぱいに迫ります。接近速度は基準の2.4倍設定（前版は1.3倍）。透過素材・生成指示・再現手順は `design/tenjou-no-mukou/frame-direction.md` にあります。

RAKUGAKIは `games/rakugaki/` にソースを置く、Three.js製の手描き風3Dダウンヒル・スケボーゲームです。UNFILED本体と同じViteビルドの追加ページ（`vite.config.ts` の `rollupOptions.input`）として `dist/games/rakugaki/` に出力され、既存のPagesワークフローがそのまま公開します。外部アセットは使わず、地形・ヘアピンの山道・ガードレール・松・岩はすべてコードで生成し、効果音もWeb Audioで合成します。手描きの見た目は、トゥーン素材の描画に加えて、法線と深度から輪郭線を引き、暗部にハッチングと紙の質感を重ね、輪郭を毎秒12回揺らす後処理で作っています。

操作は矢印キー（曲がる・押す・ブレーキ）、SPACE長押し→離してオーリー、J / K / Lでフリップ、SHIFTでタック加速と空中グラブ、ブレーキ＋左右でドリフト（離すとブースト）、Rで道に戻る、ESCで休憩です。スマートフォンでは画面のジョイスティックとボタンで遊べます。転倒は障害物への高速正面衝突だけで、フリップは着地で必ず決まり、空中では進行方向へ自動で向き直ります。コースは雪の山頂のロールインから始まり、ノートの裂け目ギャップ、崖から下の道へ飛ぶハーピンホップとダートシュート、落石、クレヨンのハーフパイプ回廊、谷を渡るジップライン、鳥居ラッシュ、鉛筆トンネルとパイプライン、島のボウル、湖畔のフィニッシュ・メガキッカーが続きます。ヘアピンの外側は放物線のバームで、突っ込んでも止まらず壁走りになります。着地までがワンコンボで、ゴール時のタイムとスコアの自己ベストはブラウザ内に保存します。表紙 `public/images/rakugaki.webp` は実際のゲーム画面です。型検査は `npm run check`、開発は `npm run dev` で `/games/rakugaki/` を開きます。

制作・運営：[XenithONE](https://github.com/XenithONE)

## EVEREST — WHITE RUSH

[EVEREST](https://xenithone.github.io/unfiled/games/everest/)は `games/everest/` のThree.js製スノーボードです。エベレストをイメージした広い山肌を自由に滑り、麓のベースキャンプを目指します。指定コースや必須チェックポイントはありません。自然の雪庇、トリック、ブースト、岩・クレバス、共有シードで変わる雪崩・氷塔崩落・追い風を備えます。オンライン最大4人はPeerJS/WebRTC、ローカル2人は画面分割、ソロはCPUと滑走できます。雪と岩にはCC0のPoly Haven素材を使用しています。

操作・通信条件・素材出典は `games/everest/README_JA.md` と `THIRD_PARTY_NOTICES.md` に記載しています。`npm run test:everest`で16項目のシミュレーション検証を実行し、Pages公開時にも検証します。表紙は実際のゲーム画面です。

## ALPINE LINE — 赤い列車で、氷河の谷へ。

[ALPINE LINE](https://xenithone.github.io/unfiled/games/alpine-rail/)は `games/alpine-rail/` のThree.js製の鉄道運転シミュレーターです。スイスの山岳鉄道をイメージした架空のメーターゲージ路線（湖畔のラグリーナから氷河の終点アルプ・グラッチャーまで12km・標高差約260m・最急勾配45‰・最小半径150m）を、赤い電気機関車とパノラマ客車4両で走ります。路線は直線・円曲線・緩和曲線と縦曲線で組み、地形・湖・谷・アーチ橋の下の渓谷・トンネルの尾根・氷河とホルン型の峰は、すべて線路から逆算して手続き的に生成します。

運転は力行5段・ブレーキ7段・非常の一本ハンドル。引張力（出力2,400kW・起動200kN・粘着限界つき）、走行抵抗と曲線抵抗、勾配、空気ブレーキの遅れ、停車中のずり下がりを計算します。制限を超えるとZUB警報、大きく超えるとATPの非常ブレーキ。ドアが開いている間は力行できず、出発信号が青になってから発車します。3駅の停止位置と時刻表（自動運転の試走から作成）で採点し、自己ベストはブラウザ内に保存します。視点は運転台・外観・沿線・空撮、時間帯は朝・昼・夕暮れ。「車窓を眺める」を選ぶと自動運転で終点まで走ります。

操作は矢印キー（またはW/S）でハンドル、Spaceで非常ブレーキ、Hで警笛、Cで視点、Aで自動運転、Escで一時停止です。スマートフォンでは右側のハンドルとボタンで運転できます。岩と雪の質感にはEVERESTと共用のCC0素材（Poly Haven、出典は `games/everest/THIRD_PARTY_NOTICES.md`）を使い、それ以外の質感・樹木・建物・車両・音はすべてコードで生成しています。車両の塗装と社名「Viafier Alpina」、駅名は架空です。`npm run test:alpine`で制動距離・勾配起動・ATP・ドア連動・信号・全線自動運転（3種の刻み幅）・地形の整合など11項目を検証し、Pages公開時にも実行します。表紙 `public/images/alpine-rail.webp` は実際のゲーム画面です。

## SCENE FORGE — 狙った動きを、映像の下絵に。

[SCENE FORGE](https://xenithone.github.io/unfiled/tools/scene-forge/)は、動画生成AIへ渡す5〜20秒の参照シーンを作るThree.js製ツールです。簡易人型の関節・手の開閉、歩行・戦闘・ジェスチャー、オブジェクト配置、キーフレーム、カメラの回り込み・追従を編集できます。カラー・白モデル・深度をMP4またはPNGで保存できます。シーンファイルの保存・読み込みにも対応します。

公開版はブラウザ内で動作します。MP4はWebCodecsのH.264エンコーダーが利用できる端末で書き出せます。利用できない場合は理由を表示し、PNG保存は引き続き使えます。AIへの指示をコピーして別のAIチャットへ渡し、返されたJSONを検証して読み込む方式です。公開サイトからAI・PCのローカルサーバーへの自動通信は行いません。Codexの直接生成とFFmpeg書き出しは別途起動するPC版の機能です。

`public/tools/scene-forge/`には公開用の静的配布物のみを配置します。更新元はローカルの `Film/scene-forge` です。そこで `npm run build:pages` を実行した後、このリポジトリで `powershell -NoProfile -File tools/sync-scene-forge.ps1` を実行します。公開用ビルドとローカル用ビルドを取り違えないでください。`THIRD_PARTY_NOTICES.txt` にブラウザで使用する依存パッケージのライセンスとソース取得先を含めています。表紙は実際のアプリ画面です。

## 三途の川 — 渡るのは、ひとりだけ。

[三途の川](https://xenithone.github.io/unfiled/films/sanzu-river/)は、31秒・8カットの短編映像をThree.js（r180）がブラウザの中でそのつど描く作品です。彼岸の日の日没直後、流した灯籠は橋の手前で止まり、白装束の旅人を乗せた舟だけが向こう岸へ渡ります。映像はくり返し再生され、音は付きません。描画が重いため、性能の高いPCでの鑑賞を想定しています。

`public/films/sanzu-river/`には再生に必要なファイルだけを置きます。更新元はローカルの `Film/sanzu-river` で、このリポジトリで `node tools/sync-sanzu-river.mjs` を実行すると、`src/main.js` から実際に読み込まれるモジュール、それが使うThree.jsのファイル（作品側の `node_modules` のr180）、決められた素材だけを写します。制作用のスクリプト・Blenderファイル・書き出した動画・v1の人物ファイルは写しません。人物の頭部はこの作品のための自作（MakeHumanの元メッシュと形の素材、CC0）で、素材の出典は同梱の `CREDITS.md` にあります。表紙 `public/images/sanzu-river.webp` は実際の映像の一コマです。

## AlicE sYsTeMから移行したゲーム

旧サイトのプレイ可能な13本を `public/games/alice/` に移行しました。NITRO CROWN、RELIC ROAD、THE HOLLOW WARD、SIGNAL SIEGE、THE EIDOLON、RIFT COURIER、I WANNA BE THE SIGNAL、LOCKER HUNT、SIGNAL RUNNER、CONSTELLATION、DRAGON'S KEEP、SCRAP CROWN、VORTEX CROWNです。作品一覧のカードから直接起動できます。表紙は旧サイトのゲーム用ビジュアルを引き継いでいます。

非公開の原本 `alice-system` の `73d039b` を、原本のロックファイルにある依存バージョンでゲームのみビルドしています。UNFILED本体の依存バージョンからは独立し、既存のPagesワークフローで静的配布物を公開します。開発中で実行ファイルのないUnity作品や、ゲーム以外の旧サイトのコンテンツは含めていません。

再生成は、隣の `WEB/alice-system` に上記コミットをチェックアウトして `npm ci --ignore-scripts` を実行した後、UNFILEDから `node tools/sync-alice-games.mjs` を実行します。既存の配布先がある場合は上書きせず一時ビルドの場所を表示します。更新内容を確認し、古い配布先を退避してから再実行してください。同期スクリプトで公開パスと戻り先を調整し、原本のルールや保存キーを維持します。`npm run test:alice` は13本の掲載・参照ファイル・配布物のSHA-256を確認します。

操作・通信条件・保存の扱いは同梱の `README_JA.md`、素材の出典と依存ライセンスは `ASSET_CREDITS.md` と `THIRD_PARTY_NOTICES.txt` を参照してください。旧サイトと同じブラウザ・同じ `https://xenithone.github.io` の保存領域に残る記録は引き続き参照します。別ドメインや別ブラウザの記録は自動移行されません。

# UNFILED

**まだ、何者でもないアイデアたち。**

AIと一緒に、思いつくままにつくった世界の入口。テーマの揃わない作品を、ひとつの空間から自由に見つけるための、XenithONEの制作物ポートフォリオです。

React・TypeScript・Viteで構築し、GitHub Pagesへ静的サイトとして公開します。

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

## 空間を歩く

- 空間表示では、ドラッグして作品を探し、作品を選択すると紹介とリンクが開きます。タッチ端末ではタップして開き、ページは通常どおりスクロールできます。
- キーボードではTabで操作対象へ移動し、EnterまたはSpaceでボタンを操作できます。
- 一覧表示では、作品を順に読みながら探せます。
- OSの「視差効果を減らす」「アニメーション効果をオフ」などの設定に対応し、動きを抑えます。動きがなくても作品の紹介とリンクを利用できます。

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

画像は`public/images/`へ置き、`cover`には先頭の`/`を付けずに指定します。JSONの末尾の余分なカンマに注意してください。更新後は`npm run build`で確認し、`main`へpushすると公開内容も更新されます。

表紙は、作品の空気感を表現するオリジナルの生成ビジュアルを使用しています。YOHAKU、IGNIS、TIDAL FORGEの表紙には実際の作品画面を使用しています。TIDAL FORGEはWebGPUで描画したブラックホールのシーンPNGをそのまま掲載しています。各作品のリンクから実際のサイトを開けます。

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

制作・運営：[XenithONE](https://github.com/XenithONE)

# VORTEX CROWN の個別更新

初回移行の13作品は `sync-alice-games.mjs` と `public/games/alice/migration.json` に記録しています。VORTEX CROWNだけを改良したときは以下の手順で更新します。ソースは非公開の `alice-system` に置き、公開リポジトリには配信用ビルドだけを保存します。

1. `alice-system` で依存を `npm ci` により復元し、改良版を検証します。少なくとも `npm run typecheck` と `npm run vortex:gates` を実行し、ブラウザーで実際の試合を確認します。
2. 改良内容を `alice-system` にコミットし、`git status --porcelain` が空になるようにします。`git rev-parse HEAD` で完全な40桁のSHAを取得します。
3. `unfiled` で次のコマンドを実行します。`REVIEWED_FULL_SHA` は実際に検証したSHAに置き換えます。

   ```sh
   node tools/sync-vortex-crown.mjs --source-commit REVIEWED_FULL_SHA
   npm run test:alice
   npm run build
   ```

   既定のソース位置は `../alice-system` です。別のチェックアウトには `--source <path>` を指定します。

4. 公開ビルドでも試合開始、衝突とスキル、試合終了と再戦、UNFILEDへ戻る導線を確認してから、生成物を含めてコミットします。

更新スクリプトは、指定SHAとの一致、ソースが未変更であること、更新前の全ファイルのハッシュを確認してからViteを実行します。既存のライセンス一覧と依存のバージョンが異なる場合も中断します。依存を更新した場合は、まず対応するライセンス全文と配信マニフェストを更新してください。

生成するのは `vortex-crown.html` と `assets/vortex-enhanced/<SHAの先頭12桁>/` 内の専用バンドルです。初回移行時の共有バンドルとほかの12作品のファイルは維持します。旧版の専用バンドルも残すため、Pagesの更新中にキャッシュされたHTMLから参照されても壊れません。繰り返し更新による旧バンドルの整理は自動では行いません。

`migration.json` の `sourceCommit` は初回移行の記録です。改良版の正確なソースは `gameOverrides.vortex-crown.sourceCommit`、今回生成したファイル一覧は同項目の `files` に記録します。`files` の全体ハッシュ一覧には旧版の保持ファイルも含み、`test:alice` はファイルの欠損・改変・登録漏れと各HTMLの依存を検査します。

`sync-alice-games.mjs` は初回移行用であり、既存の配信ディレクトリーがあると書き換えを拒否します。改良版の上から初回移行をやり直さないでください。

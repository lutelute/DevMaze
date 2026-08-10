# DevMaze 引き継ぎ

- 保存: 2026-08-11
- リポジトリ: /Users/shigenoburyuto/Documents/GitHub/tool_dev_SGNB/DevMaze
- ブランチ: main / HEAD: 6e9c1ca（origin/main と同期済み・作業ツリーはクリーン）
- 次の一手: ユーザーが実際に触った上での不満点を聞き、CDP で実操作確認しながら潰す

## いまどこ

「開発過程の資産抽出」を軸に3回に分けて実装し、都度 push とインストール（/Applications/DevMaze.app）まで済んでいる。
ユーザーの評価は一貫して「まだ完成度が低い・叩き台」で、直近の指摘は
①表示が直線的すぎる ②ズーム・マップが悪い ③GitHub に自動参照に行かない の3点。
3点とも対応して push（6e9c1ca）・インストール済み。**ユーザーからの次の評価待ち**。

途中で「更新前のまとまった感じが好きだった」という差し戻し要求があり、
均等配置 → 時間密度で塊ができる配置に戻した経緯がある。この好みは今後も効く。

## 次の一手

1. ユーザーが installed 版を触った感想を聞き、指摘を CDP で再現→修正する
2. 未検証のまま残っている操作: レポート保存ダイアログ（`report:export`）、
   ミニマップのクリック移動の見た目、ホットスポットからのファイル追跡
3. 手つかずの改善候補: 沼の判定を「期間」でなく因果で束ねる、差分の中身（関数・行）まで見る、
   GitHub API からの PR/issue/リリース取得（いまはコミットメッセージの `#123` 抽出のみ）
4. `/Applications/DevMaze.app` は 0.4.0 のまま。リリースするならバージョンを上げてタグを打つ

## 鉄則・地雷

- **iCloud 配下ではビルドが必ず失敗する。** `~/Documents` は iCloud 同期対象で、
  `release/` に書いた直後のファイルに `com.apple.fileprovider.fpfs#P` が付き、
  codesign が `resource fork, Finder information, or similar detritus not allowed` で落ちる。
  `xattr -cr` では間に合わない（書き込みのたびに付く）。同期外に出力すれば通る:
  `npx electron-builder --mac -c.directories.output=/tmp/devmaze-release`
- **UI はスクリーンショットだけで検証しない。** 開発時のみ CDP（`localhost:9222`）が開くようにしてある
  （`electron/main.ts`、`app.isPackaged` が false のときだけ）。
  検証用ドライバは `scratchpad/cdp.cjs`（eval / click / key / cmdkey / type / shot / logs）。
  同じ実行コンテキストが使い回されるので、eval の式は必ず `(()=>{...})()` で包む
  （`const` の再宣言でエラーになる）。
- **`osascript` の System Events クリックはハングする**（アクセシビリティ権限）。使わない。
  `tell application "DevMaze" to activate` はインストール版を起こしてしまうことがある。
- 検証用の題材リポジトリ: DevMaze 自身（20コミット・沼0件＝きれいな履歴）と
  `/Users/shigenoburyuto/Documents/GitHub/project_Hayashi/All-Japan-Grid`
  （781コミット・沼30件・オブジェクト欠損あり＝ファイル差分84%）。
  前者は「検出されないこと」、後者は「検出されること」の確認に使える。
- 解析結果は `~/Library/Application Support/devmaze/repo-cache/` にキャッシュされる。
  `AnalysisResult` の形を変えたら `electron/ipc/cache.ts` の `CACHE_VERSION` を上げる（現在3）。
- AtelierX の MCP はセッション途中で切断された。伝言元（AtelierX_Project）への返信が未了。

## 判断待ち

- インストール版を触った上での「どこが完成度が低いか」の具体。
  これまで4回聞いて「全部」「まだ低い」という粒度なので、次は実物を見ながらの指摘が要る。

## 復元手順

```bash
cd /Users/shigenoburyuto/Documents/GitHub/tool_dev_SGNB/DevMaze
npm run dev                                    # 開発起動（CDP は 9222 で開く）
DEVMAZE_REPO=/path/to/repo npm run dev         # 指定リポジトリを開いて起動
npm test                                        # vitest 56件
npm run build:mcp && node dist-mcp/server.js   # MCP サーバー
```

仕様・判定ロジック・アーキテクチャはリポジトリの `README.md` に集約済み（今回のセッションで新規作成）。

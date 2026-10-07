# 引き継ぎ: DevMaze — v1.0 完全改修をブランチ rebuild/v1 で完了（未コミット81件）。Electron 44/React 19/Vite 8、zustand、決定的レイアウト、ナレッジ層+MCP 11ツール。/Applications に 1.0.0 を導入済み

> 保存 2026-10-08 01:26 ／ 状態 **確認待ち**
> ブランチ `rebuild/v1` @ `f88aa6c` ／ **未コミット 81件** ／ 追跡ブランチなし（push先未設定）
> 直近コミット: chore: v0.6.0
>
> **次の一手**: ユーザーの確認を取ってから rebuild/v1 をコミット → main にマージ → v1.0.0 タグ・リリース。ナレッジの蒸留ループ（LLM で教訓化）と横断検索は次の段階

---
## いまどこ

「完全改修したい」を受けて、解析層だけ残し土台から作り直した。ブランチ `rebuild/v1`、**81件すべて未コミット**（ユーザーがコミットを頼んでいないため）。
typecheck 2本・vitest 159件・build・配布物ビルドすべて通過。AtelierX（913件）と DevMaze 自身で実機確認済み。
`/Applications/DevMaze.app` は 1.0.0 に差し替え済み（配布物は `/tmp/devmaze-release/mac-arm64/`）。
追加依頼「RAG化・GraphRAG化・知財化の方法論」は三段階（chunks / graph / lesson）として整理し README「ナレッジ化の考え方」に書いた。実装は抽出・構造化と蒸留用素材の口まで。

## 次の一手

1. ユーザーに見てもらい、OK なら `git add -A && git commit`（Co-Authored-By 付き）→ main へマージ → `git tag v1.0.0` → `gh release create`
2. 残課題（任意）: `detectZones` が同じ開始日・同じ件数のフェーズを2件出すことがある（DevMaze 自身で「機能開発 5/6〜 10」が2行）。旧版からの挙動で未着手
3. ナレッジの次段階: `search_knowledge`（全リポジトリ横断、BM25 で可）、教訓の採用・編集画面、CLAUDE.md/memory への先回り提示

## 鉄則・地雷

- **simple-git 4 の環境ガード**: `.env(k,v)` は `simpleGit(path, { allowEnvironment: ['GIT_NO_LAZY_FETCH'] })` と組でないと拒否される。拒否は catch で「リポジトリが見つかりません」に化ける。共通ヘルパー `shared/analyzer/gitenv.ts` を必ず使う。default export も無い（`{ simpleGit }`）
- **CDP は 9223**（`DEVMAZE_CDP_PORT=9223`）。9222 は TiN が常駐で握っている。ドライバは scratchpad の `cdp.mjs`（shot/eval/click/key/wait/logs/size）
- `scripts/build.mjs` は直接実行時だけビルドする（`dev.mjs` が import するため。ガードを外すと dev 起動のたびに MCP まで全ビルドされ、他セッションが使っている `dist-mcp/server.js` を書き換える）
- `dist-mcp/server.js` は他の Claude セッション 10 本が MCP として使用中。既存8ツールの名前・引数は変えない
- `RowGeometry.mid` は**絶対座標**（最初は相対で返っていて、帯とラベルが全部1行目に重なった）
- 沼の薄い帯は `<g opacity>` でまとめて描く。1枚ずつ重ねると30件が足し合わさって赤い壁になる
- 塊の中（衝突で目標 y からずれた印）には札を出さない。`layout.pos()` との差で判定
- 配布物は `--dir -c.directories.output=/tmp/devmaze-release`。node_modules は含めない（全部 esbuild で束ね済み）
- 電源の都合で `electron` の postinstall がバイナリを落とさないことがある → `node node_modules/electron/install.js`

## 沼ったところ

- 最初の実機起動で「Gitリポジトリが見つかりません」。パスは正しく、素の Node でも通った。原因は simple-git 4 の環境ガード（上記）。エラー文に原因を添える直しを入れてから分かった
- vite-plugin-electron を 1.x に上げる案は捨てた。API が変わっていて、Vite 8 + Electron の組み合わせで検証コストが読めない。esbuild で自前に束ねるほうが構成が単純で、配布物も小さくなる
- 力学シミュレーションの維持は捨てた。1000件で 160 tick 回していたのを決定的なビースウォーム配置に替え、1000件 3〜7ms、テストで「重ならない」を保証できるようになった

## 判断待ち

- コミット・マージ・タグ・リリースの可否
- 凡例は既定で畳んだ（サイドバーの「種別で絞る」が形と色を兼ねる）。元に戻すなら `src/store/index.ts` の `legendOpen: false`

## 復元手順

```bash
cd /Users/shigenoburyuto/dev/github/tool_dev_SGNB/DevMaze
DEVMAZE_CDP_PORT=9223 DEVMAZE_REPO="$HOME/Library/Application Support/devmaze/github-repos/lutelute/AtelierX.git" npm run dev
npm test && npm run typecheck
node scripts/mcpcall.mjs get_lesson_material '{"repo_path":"'$PWD'"}'
```
スクショ: scratchpad の `current-*.png`（旧）/ `v1-*.png`（新）/ `packaged-window.png`（配布版）

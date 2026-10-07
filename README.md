# DevMaze

Git の開発履歴を「迷路」として可視化する Electron アプリ兼 MCP サーバー。
v1.0 で土台から作り直した（Electron 44 / React 19 / Vite 8、決定的レイアウト、ナレッジ出力）。

コミット履歴には、完成したコードには残らないものが埋まっている——どこで巻き戻したか、
どのファイルを何度も直したか、どこで手が止まったか。DevMaze はそれを**捨てずに取り出し**、
読める形（迷路・暦）と、再利用できる形（グラフ・チャンク・vault）の両方で出す。

```
迷路ビュー           暦ビュー                    沼 / ホットスポット        ナレッジ出力
体感時間の道のり      実時間の濃淡                詰まった箇所・荒れた場所    RAG / GraphRAG / 教訓の素材
```

## できること

| | 何を出すか |
|---|---|
| **迷路** | メインラインを横軸に固定し、時間軸を折り返して蛇行させた道。集中した時期が塊、空白が間隔として見える |
| **暦** | 同じ履歴を**実時間**で並べた面。迷路が対数で圧縮した時間を検算できる。曜日・時間帯の分布つき |
| **試行錯誤スコア** | revert×4 + fix×2 + WIP×1 + merge×1 + branch×2 の集計値（4段階） |
| **沼（Struggle）** | *どこで詰まったか* を個別のエピソードとして抽出。根拠つき |
| **ホットスポット** | *どこが荒れているか* をファイル単位で risk 0-100 に |
| **開発フェーズ** | コミット種別の推移から「機能開発期／バグ修正期」等の区間を推定 |
| **働き方** | 時間帯・曜日の分布、夜間率、稼働日数、連続稼働と最長の空白、著者統計 |
| **検索** | ⌘F でメッセージ・ハッシュ・著者・変更ファイルを横断検索 |
| **レポート出力** | 開発過程を Markdown 1本にして保存 |
| **ナレッジ出力** | Obsidian 向け vault（Markdown + wikilink）と、RAG / GraphRAG 向け JSONL（chunks / graph）を書き出す |
| **MCP サーバー** | 上記すべてを他のエージェントから引ける形で公開（11ツール） |

GitHub の `user/repo` 表記を入れると bare clone して解析する（`--filter=blob:limit=100k --depth=1000`）。
ローカルリポジトリは chokidar で監視し、新しいコミットを検出するとヘッダーの札で知らせる。
リポジトリを開くと**リモートに新着が無いかを自分から見に行く**（`git ls-remote` のみ）。
5分ごとに再確認するので、開いたまま放置していても気づける。再スキャンは、まずリモートから
取り込んでから解析し直す。

コミット分類は英語のキーワード（feat / fix / refactor …）に加えて和文（追加 / 修正 / 整理 /
作業中 …）も見る。

## 起動

```bash
npm install

npm run dev                                  # 開発モード（Vite + esbuild watch + Electron）
DEVMAZE_REPO=/path/to/repo npm run dev       # 指定リポジトリを開いた状態で起動
DEVMAZE_CDP_PORT=9223 npm run dev            # CDP のポートを変える（既定 9222）

npm test                                     # vitest（解析層・レイアウト・ナレッジ・ストア）
npm run typecheck                            # tsc（レンダラー / node 側）
npm run build                                # dist/ dist-electron/ dist-mcp/
npm run package:mac                          # macOS の .app を /tmp/devmaze-release に
```

ビルドは Vite がレンダラーだけを担当し、main / preload / MCP サーバーは esbuild で
それぞれ1ファイルに束ねる（`scripts/build.mjs`）。依存はすべて束ねるので、
配布物に `node_modules` は含めない。

## MCP サーバーとして使う

```bash
npm run build:mcp     # dist-mcp/server.js を生成
```

`~/.claude.json` などに登録する:

```json
{
  "mcpServers": {
    "devmaze": {
      "command": "node",
      "args": ["/absolute/path/to/DevMaze/dist-mcp/server.js"]
    }
  }
}
```

解析結果はアプリと同じキャッシュ（`~/Library/Application Support/devmaze/repo-cache/`）を
読み書きする。HEAD が変わっていなければ、どのツールも即座に返る。

### ツール

| ツール | 返すもの |
|---|---|
| `scan_repo` | 統計・スコア・ノード数の概要 |
| `get_summary` | 開発サマリー（Markdown） |
| `get_score` | 試行錯誤スコアと内訳 |
| `get_struggles` | 沼エピソード（`format`, `min_severity`, `limit`, `kind` で絞り込み） |
| `get_struggle_diff` | その沼で実際に書かれたコードの差分。「何を試して何が効いたか」の素材 |
| `get_hotspots` | 荒れているファイル（risk 順） |
| `export_report` | サマリー＋沼＋ホットスポット＋働き方を1本の Markdown に |
| `get_maze_graph` | ノードとエッジの JSON |
| `export_knowledge` | vault（Markdown）と JSONL（chunks / graph）。`out_dir` を渡すと書き出し、無ければインラインで返す |
| `query_graph` | ナレッジグラフを辿る。`find`（種別・部分一致）/ `neighbors`（起点から深さ1〜3）/ `path`（2点間の経路） |
| `get_lesson_material` | 沼1件を「教訓」に蒸留するための素材。根拠・関与ファイル・コミット列・差分・蒸留テンプレートを1本に |

`scripts/mcpcall.mjs` で stdio 越しに直接叩ける（`node scripts/mcpcall.mjs get_struggles '{"repo_path":"/path"}'`）。

## ナレッジ化の考え方

解析結果は、そのままでは「読み物」であって「知識」ではない。知識にするには、
単位を揃え、関係を持たせ、再利用の場面に届ける仕組みが要る。
RAG・GraphRAG・教訓化は別々の技術というより、同じ素材を扱う三段階として捉えている。

**1. RAG = 単位を揃えて検索できる形にする（chunks）**
単位は「沼のエピソード」1件。症状の根拠・関与ファイル・コミット列・抜けた印が揃っていて
自己完結している。`chunks.jsonl` の1行がそれで、`metadata`（repo / kind / severity / files /
期間）と `provenance`（出所のハッシュ）を必ず持つ。答えられる問いは「前にも似た場所で詰まったか」。

**2. GraphRAG = 関係を持たせて多段の問いに答える（graph）**
データは最初からグラフ。Commit が File を触った（TOUCHES）、Commit が Struggle に属する
（PART_OF）、Struggle を Commit が抜けた（ESCAPED_BY）、Struggle が File で再発した
（RECURS_ON）、Commit が Session と Phase に入る、Author が Commit を書いた。
`graph.nodes.jsonl` / `graph.edges.jsonl` に property graph として出し、`query_graph` で
プロセス内で辿れる。1000コミット規模なら Neo4j は要らない。
「CSS で3回詰まっていて毎回効いたのは何か」「繰り返している失敗の型は何か」が、ここで答えられる問いになる。

**3. 教訓化 = エピソードを蒸留し、次に効く場所へ届ける（lesson）**
沼は事実の記録。教訓は「状況・症状・試したこと・効いたこと・一般化した規則・根拠へのリンク」の形に
蒸留して初めて再利用できる。蒸留は LLM にやらせ、素材は `get_lesson_material` が1本の
Markdown で渡す（末尾に埋めるべきテンプレートが付く）。人が採用・修正する工程を1段はさみ、
出所付きで vault に置く。さらに CLAUDE.md や memory に「このファイルを触るならこの教訓」として
流し込むと、次に同じ場所を触る**前に**出てくる。検索を待つ RAG ではなく、先回りの提示になる。

パイプライン全体は 抽出 → 構造化 → 蒸留 → 採用 → 保管 → 想起 → 適用。
DevMaze が担うのは最初の2つと、蒸留に渡す素材まで。

### vault の構成

```
<repo>/
  README.md             索引（沼一覧・ホットスポット一覧・フェーズ・働き方へのリンク）
  struggles/<id>.md     沼1件 = 1ノート。frontmatter（severity / kind / files / 期間 / escaped / recurrence / hashes）
  hotspots/<slug>.md    ファイル1件 = 1ノート
  phases.md             開発フェーズ
  activity.md           働き方
  chunks.jsonl          RAG 用（1行1チャンク）
  graph.nodes.jsonl     GraphRAG 用
  graph.edges.jsonl
```

wikilink は `[[<repo>/struggles/<id>|題名]]` のように vault ルートからのパス付き。
複数リポジトリを同じ vault に入れても衝突しない。

## 沼（Struggle）の判定

沼はスコアと違い、**個別のエピソード**として出る。判定はコミット履歴だけから決まり、
根拠（evidence）を数値で持つので、読んだ側が再判断できる。

| 種別 | 判定 |
|---|---|
| `revert_loop` — やり直しの輪 | revert とその前後で同じファイルに触れたコミットが3件以上 |
| `fix_chain` — 修正の連鎖 | fix 系コミットが24時間以内の間隔で3件以上連続 |
| `file_churn` — 同じファイルの往復 | 同一ファイルを7日以内に4回以上変更、かつ fix/revert/WIP が2割以上 |
| `wip_drift` — WIP の漂流 | WIP 系コミットが48時間以内の間隔で3件以上連続 |
| `stall_burst` — 停滞のあとの再開 | 中央値の8倍かつ3日以上の空白の直後に、修正または大規模変更 |

各エピソードは `escape`（沼を抜けた印 = 同じファイルへの次の前進コミット）を持つ。
同じファイルで14日以上あけて繰り返している場合は `recurrence` が付く。
一度きりの沼と、半年に3回同じ場所で溺れている沼は意味がまったく違う。
各エピソードは `nightRatio`（22-5時の割合）も持つ。

### 誤検出を避けるための除外

- **なぎ払いコミット**（26ファイル以上）は、初回インポートや一括整形なのでファイル単位の判定から外す。
- **自動生成物**（`package-lock.json`、`dist/`、`node_modules/` 等）は除外する。
- **リリースコミット**は版番号の更新でファイルに触るだけなので往復に数えない。
- コミット分類は**件名を主・本文を従**として行う。本文の箇条書きに引きずられない。

### 「検出なし」を信用しないための仕掛け

`git log --all --numstat` は**最初に見つからないオブジェクトで止まる**ので、blob が1つ
欠けるだけで残り全部の差分を道連れにする。分割して取り直す（200件ずつ → 失敗したら
半分に割る → 1件まで割って駄目ならその1件だけ諦める）。実測で 0% → 100%。
そのうえで `stats.fileStatsCoverage`（0-1）として取得率を持ち、50% を下回るときは
レポートとサイドバーに警告を出す。

## ホットスポットの計算

```
risk = 100 × (0.35·log正規化した変更回数 + 0.45·平滑化した修正率 + 0.12·著者数 + 0.08·直近性)
```

変更回数は対数で正規化し（1ファイルだけ極端に多い場合に他が潰れないように）、
修正率はリポジトリ全体の修正比率を事前分布として平滑化する。

## 迷路の読み方

- 時間軸を画面幅で**折り返して蛇行**させる（偶数行は左→右、奇数行は右→左）。
  行数は固定せず、**いちばん大きく映せる折り返し方**を選ぶ。
- 各行の端に**その行が始まった日付**と、その期間の開発フェーズが出る。
- 1件ごとの前進はごく小さく、時間が近いコミットは重なる。重なりは**決定的な配置**で
  上下に逃がす（力学シミュレーションは使わない。同じ入力なら同じ絵になり、1000件で数ms）。
  集中して書いた時期が「塊」として見え、長い空白は間隔として残る。
- 塊の中の印には件名や版番号の札を出さない（重なって読めなくなるだけなので）。
  拡大すると出る文字は倍率で3段階に変わる。
- **破線の縦棒**は3日以上コミットが無かった期間。
- **薄い赤の地面**は沼。選ぶとその1件だけ帯が立つ。終端が閉じていれば抜けた、開いていればまだ。
  薄い帯は重ねて濃くならないよう、まとめて1回だけ不透明度をかけている。
- 種別は**色4種＋形**で持つ。色は物語に効く4種（機能追加・通常・リバート・バグ修正）の
  輝度ラダーに絞り、マージ=◇ / リリース=⬡ / WIP=破線の円 / 周辺作業=□＋1文字（C・D・T・R）。
- 200件を超えると自動で**作業のまとまり**（間隔2時間以内・同じレーン）単位に集約する。
  まとまりをクリックすると、その中のコミットに降りる。

### 操作

| 操作 | 動き |
|---|---|
| スクロール | 拡大・縮小 |
| Shift + スクロール | 横に移動 |
| ドラッグ | 移動 |
| 左下の − / ＋ / ⤢ | 縮小 / 拡大 / 全体表示 |
| ミニマップをクリック | その位置へ飛ぶ（拡大して溢れたときだけ出る） |
| ← → | 時系列を1つ前後へ（注目中はその中だけ） |
| ⌘[ / ⌘] | 戻る / さっきの場所へ（注目・表示単位・カメラをまとめて巻き戻す） |
| ⌘F | 検索 |
| Esc | 手前から1つ閉じる（ヘルプ → 検索 → 詳細 → 注目） |
| ? | キー一覧 |

## アーキテクチャ

```
shared/                 Electron と MCP で共用する純粋層（DOM に触らない）
  types.ts              解析結果・ナレッジグラフの型
  theme.ts              コミット種別の色・形・ラベルの唯一の出どころ
  ipc.ts                レンダラー ⇄ メインの契約（チャンネル名・引数・返り値）
  cache.ts              解析キャッシュ（アプリと MCP で共用、HEAD で判定）
  cache-path.ts         データ置き場（両者で同じ場所を見る）
  analyzer/             git log の取得と解析・分類・沼・ホットスポット・働き方・差分・レポート
  maze/                 迷路のレイアウトエンジン（時間軸・折り返し・決定的配置・まとまり）
  knowledge/            ナレッジ層（graph / chunks / vault / query / lesson）
electron/               メインプロセス。ipc/ は契約に沿った型付きハンドラ（repo / export / watcher / shell）
src/                    React レンダラー
  store/                zustand（リポジトリ・表示・注目・戻る）
  components/           layout / panels / maze / calendar / detail / search / screens / ui
  styles/               デザイントークンと基本スタイル（CSS Modules）
mcp-server/             MCP stdio サーバー（McpServer + zod）
scripts/                build.mjs（esbuild）/ dev.mjs（開発）/ mcpcall.mjs（MCP の手動呼び出し）
tests/                  vitest（解析層・レイアウト・ナレッジ・ストア）
```

解析結果は `~/Library/Application Support/devmaze/repo-cache/` にキャッシュされ、
HEAD が変わったときだけ再スキャンする。

## 技術スタック

Electron 44 / React 19 / Vite 8 / esbuild / zustand / d3-zoom / simple-git 4 /
chokidar 5 / @modelcontextprotocol/sdk / zod 4 / vitest 5

## 開発メモ

- 開発モードでは CDP が開く（既定 9222）。実際に押して確かめるためのもの。
  見た目のスクリーンショットだけでは「押しても何も起きない」が残り続ける。
- simple-git 4 は環境変数の受け渡しに「環境ガード」がある。`.env()` に渡すキーは
  `allowEnvironment` に明示する（`shared/analyzer/gitenv.ts`）。
- `AnalysisResult` の中身が変わったら `shared/cache.ts` の `CACHE_VERSION` を上げる（現在 5）。
- 種別（`CommitType`）が増えたら `shared/theme.ts` がコンパイルで落ちる。それが歯止め。

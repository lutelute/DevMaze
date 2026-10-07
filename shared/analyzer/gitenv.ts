import { simpleGit, type SimpleGit } from 'simple-git'

/**
 * 解析用の git。遅延取得（lazy fetch）を止めるのが要点。
 *
 * 部分クローンでは、手元に無いオブジェクトに触れた瞬間 git が黙ってネットワークへ取りに行く。
 * 解析のたびに数十秒止まる原因になるので禁止する（実測: 896コミットの解析が 78秒 → 2秒）。
 *
 * simple-git 4 は環境変数の受け渡しに「環境ガード」が入った。.env() に渡すキーは
 * allowEnvironment に明示しないと "blocked by the environment guard" で拒否され、
 * 解析が丸ごと「リポジトリが見つかりません」に化ける（実測）。
 * 環境をオブジェクトごと渡す形は PAGER / GIT_EDITOR を含んで別の拒否に当たるので、
 * キー単位で渡す。
 */
export function gitAt(repoPath: string): SimpleGit {
  return simpleGit(repoPath, { allowEnvironment: ['GIT_NO_LAZY_FETCH'] })
    .env('GIT_NO_LAZY_FETCH', '1')
}

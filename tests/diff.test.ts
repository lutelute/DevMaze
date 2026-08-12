import { describe, it, expect } from 'vitest'
import { splitByFile } from '../shared/analyzer/diff'

/**
 * `git show` の出力をファイル単位に切る所だけを試す。
 * ここが壊れると差分が丸ごと空になるのに、型では検出できない。
 */
describe('splitByFile', () => {
  it('複数ファイルを別々に切る', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/b.ts b/src/b.ts',
      'index 333..444 100644',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n')

    const out = splitByFile(raw)
    expect(out.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(out[0].patch).toContain('+new')
    expect(out[0].patch).not.toContain('+y')   // 隣のファイルが混ざらない
  })

  it('新規ファイル（--- が /dev/null）でもパスが取れる', () => {
    const raw = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n')
    expect(splitByFile(raw).map(f => f.path)).toEqual(['new.ts'])
  })

  it('削除ファイル（+++ が /dev/null）でも a/ 側からパスを拾う', () => {
    const raw = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
    ].join('\n')
    expect(splitByFile(raw).map(f => f.path)).toEqual(['gone.ts'])
  })

  it('パスに空白が含まれていても壊れない', () => {
    // `diff --git` 行から切り出すとここで壊れる。+++ から取るのが要点
    const raw = [
      'diff --git a/my docs/a b.md b/my docs/a b.md',
      'index 1..2 100644',
      '--- a/my docs/a b.md',
      '+++ b/my docs/a b.md',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n')
    expect(splitByFile(raw).map(f => f.path)).toEqual(['my docs/a b.md'])
  })

  it('空の出力では何も返さない（マージコミット等）', () => {
    expect(splitByFile('')).toEqual([])
    expect(splitByFile('\n\n')).toEqual([])
  })

  it('モード変更だけのファイル（ハンク無し）も落とさない', () => {
    const raw = [
      'diff --git a/run.sh b/run.sh',
      'old mode 100644',
      'new mode 100755',
      '--- a/run.sh',
      '+++ b/run.sh',
    ].join('\n')
    expect(splitByFile(raw).map(f => f.path)).toEqual(['run.sh'])
  })
})

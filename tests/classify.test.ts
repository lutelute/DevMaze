import { describe, it, expect } from 'vitest'
import { classifyCommit, parseNumstat, salvagePartialOutput } from '../shared/analyzer/git'

describe('classifyCommit', () => {
  it('件名の種別を拾う', () => {
    expect(classifyCommit('fix: crash on startup', '', 1)).toBe('error_fix')
    expect(classifyCommit('feat: add maze view', '', 1)).toBe('feature')
    expect(classifyCommit('docs: update readme', '', 1)).toBe('docs')
    expect(classifyCommit('refactor: extract analyzer', '', 1)).toBe('refactor')
    expect(classifyCommit('test: add unit tests', '', 1)).toBe('test')
    expect(classifyCommit('chore: bump deps', '', 1)).toBe('chore')
    expect(classifyCommit('WIP: trying something', '', 1)).toBe('wip')
  })

  it('親が2つ以上ならマージ', () => {
    expect(classifyCommit('fix: whatever', '', 2)).toBe('merge')
  })

  it('Revert コミットを見分ける', () => {
    expect(classifyCommit('Revert "feat: add maze view"', 'This reverts commit abc1234.', 1))
      .toBe('revert')
  })

  it('本文の箇条書きに引きずられない（件名を優先する）', () => {
    // 初回リリースのように、本文に "fix"/"add" が並ぶコミットが
    // 「バグ修正」に化けると、沼・スコア・ゾーンがまとめて狂う
    const body = [
      '- add maze graph',
      '- fix layout bug',
      '- fix crash',
    ].join('\n')
    expect(classifyCommit('Initial release: DevMaze v0.1.0', body, 1)).toBe('release')
  })

  it('件名で決まらないときだけ本文を見る', () => {
    expect(classifyCommit('update', '- fix broken parser', 1)).toBe('error_fix')
    expect(classifyCommit('update', '', 1)).toBe('normal')
  })
})

describe('parseNumstat', () => {
  const raw = [
    'a'.repeat(40),
    '',
    '3\t1\tsrc/a.ts',
    '0\t5\tsrc/b.ts',
    'b'.repeat(40),
    '',
    '-\t-\tassets/logo.png',
    '2\t2\tsrc/{old.ts => new.ts}',
    '1\t1\tdocs/old.md => docs/new.md',
  ].join('\n')

  it('コミットごとに増減とファイルを集計する', () => {
    const map = parseNumstat(raw)
    const first = map.get('a'.repeat(40))!
    expect(first.filesChanged).toBe(2)
    expect(first.insertions).toBe(3)
    expect(first.deletions).toBe(6)
    expect(first.files).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('バイナリ（-）を0として扱い、リネームは新しいパスに正規化する', () => {
    const second = parseNumstat(raw).get('b'.repeat(40))!
    expect(second.filesChanged).toBe(3)
    expect(second.insertions).toBe(3)
    expect(second.files).toEqual(['assets/logo.png', 'src/new.ts', 'docs/new.md'])
  })

  it('途中で切れた出力でも読めたところまで返す', () => {
    const truncated = raw.slice(0, raw.indexOf('0\t5\tsrc/b.ts'))
    const map = parseNumstat(truncated)
    expect(map.get('a'.repeat(40))!.files).toEqual(['src/a.ts'])
  })
})

describe('salvagePartialOutput', () => {
  it('例外の stdOut を優先する', () => {
    expect(salvagePartialOutput({ stdOut: 'abc' })).toBe('abc')
  })

  it('Buffer の stdOut も読む', () => {
    expect(salvagePartialOutput({ stdOut: Buffer.from('xyz') })).toBe('xyz')
  })

  it('numstat 行を含む message なら救出する', () => {
    const msg = `${'c'.repeat(40)}\n\n1\t2\tsrc/a.ts\nfatal: unable to read deadbeef`
    expect(salvagePartialOutput({ message: msg })).toBe(msg)
  })

  it('numstat 行が無いメッセージは捨てる', () => {
    expect(salvagePartialOutput({ message: 'fatal: not a git repository' })).toBe('')
    expect(salvagePartialOutput(null)).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { salvagePartialOutput } from '../shared/analyzer/git'

/**
 * 部分クローンで `git log --numstat` が途中で落ちたとき、
 * 何を救出できて何を救出できないかを固定しておく。
 *
 * ここを取り違えると「差分が1件も取れていない」のに画面は正常に見え、
 * 沼もホットスポットも静かに0件になる（実測: AtelierX 912コミットで取得率0%）。
 */
describe('salvagePartialOutput', () => {
  it('stdOut に部分出力があれば拾う', () => {
    const err = { stdOut: 'abc123\n\n10\t2\tsrc/a.ts\n' }
    expect(salvagePartialOutput(err)).toContain('src/a.ts')
  })

  it('stdOut が Buffer でも拾う', () => {
    const err = { stdOut: Buffer.from('abc123\n\n1\t1\tb.ts\n') }
    expect(salvagePartialOutput(err)).toContain('b.ts')
  })

  it('message に numstat 行が混ざっていれば拾う', () => {
    const err = { message: 'fatal: ...\nabc123\n\n3\t4\tc.ts\n' }
    expect(salvagePartialOutput(err)).toContain('c.ts')
  })

  it('**stderr だけの例外からは何も救出できない** — ここが実際の失敗モード', () => {
    // simple-git は promisor remote の失敗で stdOut を持たず task だけを載せてくる。
    // 救出できないので、呼ぶ側は分割して取り直すフォールバックを必ず持つこと。
    const err = {
      task: { commands: ['log', '--numstat'] },
      message:
        'warning: lazy fetching disabled; some objects may not be available\n' +
        'fatal: could not fetch dbc27afe from promisor remote',
    }
    expect(salvagePartialOutput(err)).toBe('')
  })

  it('null や undefined でも落ちない', () => {
    expect(salvagePartialOutput(null)).toBe('')
    expect(salvagePartialOutput(undefined)).toBe('')
    expect(salvagePartialOutput({})).toBe('')
  })
})

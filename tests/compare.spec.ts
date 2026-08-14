import { describe, expect, it } from 'vitest'
import { compareEvalRuns } from '../src/compare.ts'
import type { EvalSuiteResult } from '../src/types.ts'

function suite(avgScore: number, results: EvalSuiteResult['results']): EvalSuiteResult {
  return {
    suiteName: 'basic',
    runAt: '2024-01-01T00:00:00Z',
    model: 'm',
    totalTasks: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    avgScore,
    avgDurationMs: 1000,
    totalTokens: 1000,
    results,
  }
}

const result = (taskId: string, passed: boolean): EvalSuiteResult['results'][number] => ({
  taskId,
  taskName: taskId,
  passed,
  score: passed ? 1 : 0,
  durationMs: 1000,
  tokenUsage: { input: 10, output: 10 },
  turnCount: 1,
  toolCallCount: 1,
  errorCount: 0,
  details: passed ? 'ok' : 'fail',
})

describe('compareEvalRuns', () => {
  it('detects a regression when a task flips to fail', () => {
    const base = suite(1, [result('a', true)])
    const curr = suite(0, [result('a', false)])
    const c = compareEvalRuns(base, curr)
    expect(c.verdict).toBe('regressed')
    expect(c.regressions).toHaveLength(1)
  })

  it('detects an improvement when a task flips to pass', () => {
    const base = suite(0, [result('a', false)])
    const curr = suite(1, [result('a', true)])
    const c = compareEvalRuns(base, curr)
    expect(c.verdict).toBe('improved')
    expect(c.improvements).toHaveLength(1)
  })

  it('reports unchanged when nothing flips', () => {
    const base = suite(0.5, [result('a', true), result('b', false)])
    const curr = suite(0.5, [result('a', true), result('b', false)])
    const c = compareEvalRuns(base, curr)
    expect(c.verdict).toBe('unchanged')
    expect(c.regressions).toHaveLength(0)
    expect(c.improvements).toHaveLength(0)
  })

  it('computes score and token deltas', () => {
    const base = suite(0.5, [result('a', true)])
    const curr = suite(0.8, [result('a', true)])
    const c = compareEvalRuns(base, curr)
    expect(c.scoreDelta).toBeCloseTo(0.3)
    expect(c.tokenDelta).toBe(0)
  })
})

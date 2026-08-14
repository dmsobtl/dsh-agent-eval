/**
 * Pure comparison of two eval suite results: detect regressions and
 * improvements between a baseline and a current run.
 */

import type { EvalSuiteResult } from './types.js'

export interface ComparisonResult {
  verdict: 'regressed' | 'improved' | 'unchanged'
  scoreDelta: number
  regressions: string[]
  improvements: string[]
  tokenDelta: number
}

export function compareEvalRuns(base: EvalSuiteResult, curr: EvalSuiteResult): ComparisonResult {
  const regressions: string[] = []
  const improvements: string[] = []

  for (const currResult of curr.results) {
    const baseResult = base.results.find(r => r.taskId === currResult.taskId)
    if (!baseResult) continue
    if (baseResult.passed && !currResult.passed) {
      regressions.push(`${currResult.taskName}: was PASS, now FAIL — ${currResult.details}`)
    } else if (!baseResult.passed && currResult.passed) {
      improvements.push(`${currResult.taskName}: was FAIL, now PASS`)
    }
  }

  const scoreDelta = curr.avgScore - base.avgScore
  const verdict = regressions.length > 0 ? 'regressed' : improvements.length > 0 ? 'improved' : 'unchanged'

  return {
    verdict,
    scoreDelta,
    regressions,
    improvements,
    tokenDelta: curr.totalTokens - base.totalTokens,
  }
}

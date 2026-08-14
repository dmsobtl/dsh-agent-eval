/**
 * dsh-agent-eval
 *
 * Agent performance evaluation framework. Define tasks with expected outcomes,
 * run them in headless mode, score results, and track improvement over time.
 *
 * Tools:
 * - eval_run: Run a single eval task or a suite
 * - eval_compare: Compare two eval runs to detect regressions
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { EvalTask, EvalSuiteResult } from './types.ts'
import { runEvalTask } from './runner.ts'

export type { EvalTask, EvalResult, EvalSuiteResult, ExpectedOutcome } from './types.ts'
export { runEvalTask } from './runner.ts'

export const name = 'agent-eval'
export const inject = ['tools']

export interface Config {
  fixturesDir?: string
  resultsDir?: string
  defaultTimeout?: number
}

export function apply(ctx: Context, config: Config) {
  const fixturesDir = config.fixturesDir ?? './eval/tasks'
  const resultsDir = config.resultsDir ?? './eval/results'
  const defaultTimeout = config.defaultTimeout ?? 120000

  ctx.tools.register({
    name: 'eval_run',
    description: 'Run an eval suite: execute each task in headless mode, check outcomes, and output a scored report. Tasks are defined in JSON files under the fixtures directory.',
    parameters: {
      type: 'object' as const,
      properties: {
        suite: { type: 'string' as const, description: 'Suite name (matches a JSON file in fixturesDir, e.g. "basic" loads basic.json)' },
        tags: { type: 'array' as const, items: { type: 'string' as const }, description: 'Only run tasks with these tags' },
        model: { type: 'string' as const, description: 'Model name to record in results (for comparison)' },
      },
      required: ['suite'] as const,
    },
    async execute(args: { suite: string; tags?: string[]; model?: string }) {
      const suitePath = resolve(process.cwd(), fixturesDir, `${args.suite}.json`)
      let tasks: EvalTask[]
      try {
        const content = await readFile(suitePath, 'utf-8')
        tasks = JSON.parse(content)
      } catch (err: any) {
        return [{ type: 'text' as const, text: JSON.stringify({ error: `Cannot load suite: ${err.message}` }) }]
      }

      if (args.tags?.length) {
        tasks = tasks.filter(t => t.tags?.some(tag => args.tags!.includes(tag)))
      }

      if (tasks.length === 0) {
        return [{ type: 'text' as const, text: JSON.stringify({ error: 'No tasks match the criteria' }) }]
      }

      const workspace = resolve(process.cwd(), '.eval-workspace')
      await mkdir(workspace, { recursive: true })

      const results = []
      for (const task of tasks) {
        task.timeout = task.timeout ?? defaultTimeout
        const result = await runEvalTask(task, workspace)
        results.push(result)
      }

      const passed = results.filter(r => r.passed).length
      const suite: EvalSuiteResult = {
        suiteName: args.suite,
        runAt: new Date().toISOString(),
        model: args.model ?? 'unknown',
        totalTasks: results.length,
        passed,
        failed: results.length - passed,
        avgScore: results.reduce((s, r) => s + r.score, 0) / results.length,
        avgDurationMs: Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length),
        totalTokens: results.reduce((s, r) => s + r.tokenUsage.input + r.tokenUsage.output, 0),
        results,
      }

      const outDir = resolve(process.cwd(), resultsDir)
      await mkdir(outDir, { recursive: true })
      const outFile = join(outDir, `${args.suite}-${Date.now()}.json`)
      await writeFile(outFile, JSON.stringify(suite, null, 2))

      return [{ type: 'text' as const, text: JSON.stringify({
        summary: {
          suite: suite.suiteName,
          model: suite.model,
          score: `${Math.round(suite.avgScore * 100)}%`,
          passed: `${passed}/${results.length}`,
          avgDuration: `${Math.round(suite.avgDurationMs / 1000)}s`,
          totalTokens: suite.totalTokens,
        },
        results: results.map(r => ({
          task: r.taskName,
          passed: r.passed ? '✓' : '✗',
          score: r.score,
          duration: `${Math.round(r.durationMs / 1000)}s`,
          details: r.details,
        })),
        savedTo: outFile,
      }, null, 2) }]
    },
  })

  ctx.tools.register({
    name: 'eval_compare',
    description: 'Compare two eval run results to detect regressions or improvements between model/prompt changes.',
    parameters: {
      type: 'object' as const,
      properties: {
        baseline: { type: 'string' as const, description: 'Path to baseline result JSON' },
        current: { type: 'string' as const, description: 'Path to current result JSON' },
      },
      required: ['baseline', 'current'] as const,
    },
    async execute(args: { baseline: string; current: string }) {
      const [baseData, currData] = await Promise.all([
        readFile(resolve(args.baseline), 'utf-8').then(JSON.parse),
        readFile(resolve(args.current), 'utf-8').then(JSON.parse),
      ])

      const base = baseData as EvalSuiteResult
      const curr = currData as EvalSuiteResult

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

      return [{ type: 'text' as const, text: JSON.stringify({
        verdict,
        baselineModel: base.model,
        currentModel: curr.model,
        scoreDelta: `${scoreDelta > 0 ? '+' : ''}${Math.round(scoreDelta * 100)}%`,
        baselineScore: `${Math.round(base.avgScore * 100)}%`,
        currentScore: `${Math.round(curr.avgScore * 100)}%`,
        regressions,
        improvements,
        tokenDelta: curr.totalTokens - base.totalTokens,
      }, null, 2) }]
    },
  })
}

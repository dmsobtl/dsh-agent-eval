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

import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EvalTask, EvalSuiteResult } from './types.js'
import { runEvalTask } from './runner.js'
import { compareEvalRuns } from './compare.js'
import type { ResolvedConfig } from './config.js'

export type { EvalTask, EvalResult, EvalSuiteResult, ExpectedOutcome } from './types.js'
export { runEvalTask, checkOutcome } from './runner.js'
export { compareEvalRuns } from './compare.js'

export const name = 'agent-eval'
export const inject = ['tools']

export const Config = z.object({
  fixturesDir: z.string().default('./eval/tasks'),
  resultsDir: z.string().default('./eval/results'),
  defaultTimeout: z.number().default(120000),
})

export function apply(ctx: Context, config: ResolvedConfig) {
  ctx.tools.register(evalRunTool(config))
  ctx.tools.register(evalCompareTool())
}

function evalRunTool(config: ResolvedConfig) {
  return defineTool({
    name: 'eval_run',
    description: 'Run an eval suite: execute each task in headless mode, check outcomes, and output a scored report. Tasks are defined in JSON files under the fixtures directory.',
    parameters: {
      suite: { type: 'string', required: true, description: 'Suite name (matches a JSON file in fixturesDir, e.g. "basic" loads basic.json)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Only run tasks with these tags' },
      model: { type: 'string', description: 'Model name to record in results (for comparison)' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const suitePath = resolve(process.cwd(), config.fixturesDir, `${args.suite}.json`)
      let tasks: EvalTask[]
      try {
        tasks = JSON.parse(await readFile(suitePath, 'utf-8'))
      } catch (err) {
        return { error: `Cannot load suite: ${(err as Error).message}` }
      }

      if (args.tags && args.tags.length > 0) {
        tasks = tasks.filter(t => t.tags?.some(tag => args.tags!.includes(tag)))
      }
      if (tasks.length === 0) return { error: 'No tasks match the criteria' }

      const workspace = resolve(process.cwd(), '.eval-workspace')
      await mkdir(workspace, { recursive: true })

      const results = []
      for (const task of tasks) {
        results.push(await runEvalTask(task, workspace, config.defaultTimeout))
      }

      const passed = results.filter(r => r.passed).length
      const suite: EvalSuiteResult = {
        suiteName: args.suite,
        runAt: new Date().toISOString(),
        model: args.model ?? 'unknown',
        totalTasks: results.length,
        passed,
        failed: results.length - passed,
        avgScore: results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0,
        avgDurationMs: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length) : 0,
        totalTokens: results.reduce((s, r) => s + r.tokenUsage.input + r.tokenUsage.output, 0),
        results,
      }

      const outDir = resolve(process.cwd(), config.resultsDir)
      await mkdir(outDir, { recursive: true })
      const outFile = join(outDir, `${args.suite}-${Date.now()}.json`)
      await writeFile(outFile, JSON.stringify(suite, null, 2))

      return JSON.parse(JSON.stringify({
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
      }))
    },
  })
}

function evalCompareTool() {
  return defineTool({
    name: 'eval_compare',
    description: 'Compare two eval run results to detect regressions or improvements between model/prompt changes.',
    parameters: {
      baseline: { type: 'string', required: true, description: 'Path to baseline result JSON' },
      current: { type: 'string', required: true, description: 'Path to current result JSON' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const [base, curr] = await Promise.all([
        readFile(resolve(args.baseline), 'utf-8').then(JSON.parse) as Promise<EvalSuiteResult>,
        readFile(resolve(args.current), 'utf-8').then(JSON.parse) as Promise<EvalSuiteResult>,
      ])

      const comparison = compareEvalRuns(base, curr)
      return JSON.parse(JSON.stringify({
        verdict: comparison.verdict,
        baselineModel: base.model,
        currentModel: curr.model,
        scoreDelta: `${comparison.scoreDelta > 0 ? '+' : ''}${Math.round(comparison.scoreDelta * 100)}%`,
        baselineScore: `${Math.round(base.avgScore * 100)}%`,
        currentScore: `${Math.round(curr.avgScore * 100)}%`,
        regressions: comparison.regressions,
        improvements: comparison.improvements,
        tokenDelta: comparison.tokenDelta,
      }))
    },
  })
}

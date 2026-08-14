/**
 * Eval task runner. Executes tasks via dsh headless mode and scores outcomes.
 */

import { execSync } from 'node:child_process'
import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { EvalTask, EvalResult, ExpectedOutcome } from './types.ts'

export async function runEvalTask(task: EvalTask, workspace: string): Promise<EvalResult> {
  const startTime = Date.now()
  let output = ''
  let turnCount = 0
  let toolCallCount = 0
  let errorCount = 0
  let tokenInput = 0
  let tokenOutput = 0

  try {
    output = execSync(
      `dsh --profile headless "${task.prompt.replace(/"/g, '\\"')}"`,
      {
        cwd: workspace,
        encoding: 'utf-8',
        timeout: task.timeout ?? 120000,
        env: { ...process.env, DSH_HEADLESS_JSON: '1' },
      }
    )

    try {
      const meta = JSON.parse(output)
      turnCount = meta.turnCount ?? 0
      toolCallCount = meta.toolCallCount ?? 0
      errorCount = meta.errorCount ?? 0
      tokenInput = meta.tokenUsage?.input ?? 0
      tokenOutput = meta.tokenUsage?.output ?? 0
      output = meta.response ?? output
    } catch {
      // plain text output, use as-is
    }
  } catch (err: any) {
    output = err.stdout ?? err.message ?? 'execution failed'
    errorCount = 1
  }

  const durationMs = Date.now() - startTime
  const { passed, score, details } = await checkOutcome(task.expectedOutcome, output, workspace)

  return {
    taskId: task.id,
    taskName: task.name,
    passed,
    score,
    durationMs,
    tokenUsage: { input: tokenInput, output: tokenOutput },
    turnCount,
    toolCallCount,
    errorCount,
    details,
  }
}

async function checkOutcome(expected: ExpectedOutcome, output: string, workspace: string): Promise<{ passed: boolean; score: number; details: string }> {
  switch (expected.type) {
    case 'file_exists': {
      const path = resolve(workspace, expected.path)
      try {
        await access(path)
        return { passed: true, score: 1, details: `File exists: ${expected.path}` }
      } catch {
        return { passed: false, score: 0, details: `File not found: ${expected.path}` }
      }
    }

    case 'file_contains': {
      const path = resolve(workspace, expected.path)
      try {
        const content = await readFile(path, 'utf-8')
        const contains = content.includes(expected.content)
        return {
          passed: contains,
          score: contains ? 1 : 0,
          details: contains
            ? `File ${expected.path} contains expected content`
            : `File ${expected.path} does not contain: "${expected.content.slice(0, 50)}"`,
        }
      } catch {
        return { passed: false, score: 0, details: `Cannot read file: ${expected.path}` }
      }
    }

    case 'command_succeeds': {
      try {
        execSync(expected.command, { cwd: workspace, encoding: 'utf-8', timeout: 30000 })
        return { passed: true, score: 1, details: `Command succeeded: ${expected.command}` }
      } catch (err: any) {
        return { passed: false, score: 0, details: `Command failed: ${expected.command}\n${err.message?.slice(0, 200)}` }
      }
    }

    case 'output_contains': {
      const contains = output.includes(expected.substring)
      return {
        passed: contains,
        score: contains ? 1 : 0,
        details: contains
          ? `Output contains: "${expected.substring.slice(0, 50)}"`
          : `Output does not contain: "${expected.substring.slice(0, 50)}"`,
      }
    }

    case 'output_matches': {
      const regex = new RegExp(expected.pattern)
      const matches = regex.test(output)
      return {
        passed: matches,
        score: matches ? 1 : 0,
        details: matches
          ? `Output matches pattern: ${expected.pattern}`
          : `Output does not match pattern: ${expected.pattern}`,
      }
    }

    case 'custom': {
      return { passed: false, score: 0.5, details: `Custom judge required: ${expected.judge}` }
    }
  }
}

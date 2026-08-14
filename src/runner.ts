/**
 * Eval task runner. Executes each task via `dsh --profile headless` and scores
 * the outcome.
 *
 * Note: `dsh --profile headless "task"` writes the last non-empty assistant
 * TEXT to stdout and returns 0 on a completed turn. There is no JSON output
 * channel, so per-task turn/tool/token metadata is not available here and is
 * reported as 0; the score comes from the outcome checker over stdout + the
 * workspace filesystem.
 */

import { execSync } from 'node:child_process'
import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { EvalTask, EvalResult, ExpectedOutcome } from './types.js'

export async function runEvalTask(task: EvalTask, workspace: string, defaultTimeout: number): Promise<EvalResult> {
  const startTime = Date.now()
  let output = ''
  let errorCount = 0

  try {
    output = execSync(
      `dsh --profile headless "${task.prompt.replace(/"/g, '\\"')}"`,
      {
        cwd: workspace,
        encoding: 'utf-8',
        timeout: task.timeout ?? defaultTimeout,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim()
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    output = e.stdout?.trim() || e.stderr?.trim() || e.message || 'execution failed'
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
    tokenUsage: { input: 0, output: 0 },
    turnCount: 0,
    toolCallCount: 0,
    errorCount,
    details,
  }
}

export async function checkOutcome(expected: ExpectedOutcome, output: string, workspace: string): Promise<{ passed: boolean; score: number; details: string }> {
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
        execSync(expected.command, { cwd: workspace, encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
        return { passed: true, score: 1, details: `Command succeeded: ${expected.command}` }
      } catch (err) {
        const e = err as { message?: string }
        return { passed: false, score: 0, details: `Command failed: ${expected.command}\n${e.message?.slice(0, 200)}` }
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
      let regex: RegExp
      try {
        regex = new RegExp(expected.pattern)
      } catch {
        return { passed: false, score: 0, details: `Invalid regex pattern: ${expected.pattern}` }
      }
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

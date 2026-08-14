/**
 * Eval task and result types.
 */

export interface EvalTask {
  id: string
  name: string
  prompt: string
  expectedOutcome: ExpectedOutcome
  timeout?: number
  tags?: string[]
}

export type ExpectedOutcome =
  | { type: 'file_exists'; path: string }
  | { type: 'file_contains'; path: string; content: string }
  | { type: 'command_succeeds'; command: string }
  | { type: 'output_contains'; substring: string }
  | { type: 'output_matches'; pattern: string }
  | { type: 'custom'; judge: string }

export interface EvalResult {
  taskId: string
  taskName: string
  passed: boolean
  score: number
  durationMs: number
  tokenUsage: { input: number; output: number }
  turnCount: number
  toolCallCount: number
  errorCount: number
  details: string
}

export interface EvalSuiteResult {
  suiteName: string
  runAt: string
  model: string
  totalTasks: number
  passed: number
  failed: number
  avgScore: number
  avgDurationMs: number
  totalTokens: number
  results: EvalResult[]
}

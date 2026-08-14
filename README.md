# dsh-agent-eval

DSH 插件：Agent 能力评估框架 — 定义任务、跑 benchmark、评分、跟踪改进。

## 为什么需要

换了 model？改了 prompt？加了新 skill？怎么知道 Agent 变强了还是变弱了？

本插件提供一个自托管的 eval 框架：定义一组任务 + 预期结果，headless 跑完自动评分，对比前后差异。

## 工具

| 工具 | 功能 |
|------|------|
| `eval_run` | 运行一个 eval suite，输出评分报告 |
| `eval_compare` | 对比两次运行结果，找出回归和改进 |

## 快速开始

### 1. 定义 eval 任务

创建 `eval/tasks/basic.json`：

```json
[
  {
    "id": "hello-world",
    "name": "Create hello world script",
    "prompt": "Create a file hello.js that prints 'Hello, World!' to stdout",
    "expectedOutcome": { "type": "file_contains", "path": "hello.js", "content": "Hello, World!" },
    "tags": ["basic"]
  },
  {
    "id": "fix-bug",
    "name": "Fix the add function",
    "prompt": "add.js has a bug: it subtracts instead of adding. Fix it.",
    "expectedOutcome": { "type": "command_succeeds", "command": "node -e \"if(require('./add.js').add(2,3)!==5) throw 'FAIL'\"" },
    "tags": ["basic"]
  }
]
```

### 2. 运行 eval

```
Agent: → eval_run({ suite: "basic", model: "deepseek-v4-flash" })

结果：
{
  "score": "75%",
  "passed": "3/4",
  "results": [
    { "task": "Create hello world", "passed": "✓", "duration": "8s" },
    { "task": "Fix the add function", "passed": "✓", "duration": "12s" },
    { "task": "Find TODO comments", "passed": "✓", "duration": "5s" },
    { "task": "Run tests and report", "passed": "✗", "details": "npm not installed" }
  ]
}
```

### 3. 换模型后对比

```
Agent: → eval_compare({ baseline: "eval/results/basic-old.json", current: "eval/results/basic-new.json" })

{
  "verdict": "improved",
  "scoreDelta": "+25%",
  "improvements": ["Fix the add function: was FAIL, now PASS"],
  "regressions": []
}
```

## 支持的预期结果类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `file_exists` | 文件是否被创建 | `{ "path": "output.txt" }` |
| `file_contains` | 文件是否包含特定内容 | `{ "path": "app.js", "content": "express" }` |
| `command_succeeds` | 执行命令是否成功（exit 0） | `{ "command": "npm test" }` |
| `output_contains` | Agent 输出是否包含关键词 | `{ "substring": "All tests passed" }` |
| `output_matches` | Agent 输出是否匹配正则 | `{ "pattern": "\\d+ tests? passed" }` |
| `custom` | 自定义评判逻辑（未来支持 LLM-as-judge） | `{ "judge": "..." }` |

## 目录结构

```
eval/
├── tasks/           # eval 任务定义（JSON）
│   ├── basic.json
│   ├── coding.json
│   └── testing.json
└── results/         # 运行结果（自动生成）
    ├── basic-1692000000.json
    └── basic-1692100000.json
```

## 配置

```yaml
- insert:
    - id: agent-eval
      name: dsh-agent-eval
      config:
        fixturesDir: ./eval/tasks
        resultsDir: ./eval/results
        defaultTimeout: 120000    # 每个任务最长 2 分钟
```

## 典型用途

1. **Model 选型**：同一套任务，跑 Flash vs Pro，看谁分数高
2. **Prompt 调优**：改完 system prompt 后跑 eval 确认没回归
3. **Skill 验证**：加了新 skill 后跑 eval 看是否提升相关任务分数
4. **CI 集成**：每次 prompt/config 变更后自动跑 eval，分数下降则阻断

## License

MIT

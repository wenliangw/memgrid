# MemGrid

> AI 编程智能体的认知记忆引擎。一个人，一个网格。

<p align="center">
  <a href="https://www.npmjs.com/package/memgrid"><img src="https://img.shields.io/npm/v/memgrid?color=blue" alt="npm"></a>
  <a href="https://github.com/wenliangw/memgrid/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/memgrid" alt="license"></a>
</p>

## 这是什么？

MemGrid 让你的 AI 智能体拥有**持久记忆**。它从你的项目和对话中构建知识网格——方法签名、架构决策、bug 修复方案、代码风格偏好、上周聊过的事情。智能体开始工作前先搜一下网格，带着上下文进来，而不是从零开始。

两层结构，和人脑记忆方式类似：

- **记忆网格** — 快速回忆关键信息、决策、偏好（就像"我记得我们用了 Redis 做缓存"）
- **知识库（Library）** — 完整文档，需要细节时查阅（就像"让我翻一下 PRD"）

## 快速开始

### Claude Code

```bash
npm install -g memgrid
cd your-project
memgrid init
```

搞定。`memgrid init` 自动完成：

- MCP server 注册到 `~/.claude/settings.json`
- 自动同步 hook（PostCompletion + post-commit）
- MemGrid 说明块注入 `CLAUDE.md`

你的 Claude 智能体立刻获得 `memgrid_search`、`memgrid_add`、`memgrid_extract` 等工具。

### OpenClaw Gateway

```bash
npm install -g memgrid
memgrid init --server
```

自动检测你的 OpenClaw 智能体，为每个智能体创建对话记忆域，注册 MCP server 到 `openclaw.json`，注入 MemGrid 指令到各智能体的 `AGENTS.md`。

重启 OpenClaw Gateway 即可。

## 工作方式

```
智能体开始任务
  → memgrid_search("用户认证")
  → 找到：auth service 方法、JWT 配置、安全偏好、上周的 PR #94
  → 智能体带着完整上下文工作，0ms 延迟

智能体完成任务
  → memgrid sync（自动 hook 触发）
  → 检测到新代码模式，关联关系更新

智能体结束对话
  → memgrid_extract（从对话中提取）
  → 决策、偏好、事件被记录为记忆单元
  → 智能体自己精炼（它全程参与了，知道什么重要）
```

## 记忆类型

四种基本类型，代码和对话通用：

| 类型         | 用途                                         |
| ------------ | -------------------------------------------- |
| `fact`       | 方法签名、API 端点、技术栈、配置值           |
| `insight`    | 设计决策、bug 修复、经验教训、架构原理       |
| `event`      | 版本发布、PR 合并、部署上线、重要讨论        |
| `preference` | 代码风格、约定习惯、"一定要用 X"、"禁止用 Y" |

## 实际使用场景

**隔了一周回到项目。** 搜一次——智能体记起了架构、之前的决策、合过的 PR、甚至你们上次讨论时决定用 Kafka 替代 RabbitMQ 的对话。

**新智能体上手。** `memgrid init` → 扫描代码库和规则 → 立刻能用，不需要把整个项目倒进上下文。

**保持 Code Review 一致。** 记忆里存了你的 review 习惯（"别直接返回 JSON，用 ResponseBuilder"、"检查 N+1 查询"）。智能体每次 review 都对照这些偏好。

**跨项目知识复用。** 主人格域存储跨项目的偏好——你怎么处理错误、你的命名风格、你对 ORM 的态度。换个项目，偏好还在。

**防止重复踩坑。** 上个月修过一个 bug？error_solution 在网格里。智能体实现类似代码前先搜——不会犯同一个错误。

## 反馈

MemGrid 正在活跃开发中。发现了 bug？有功能想法？需要某个语言的 Scanner？

👉 [github.com/wenliangw/memgrid/issues](https://github.com/wenliangw/memgrid/issues)

欢迎提 PR。Scanner 接口设计为可扩展——加一个新语言支持只需实现一个接口。

## License

MIT

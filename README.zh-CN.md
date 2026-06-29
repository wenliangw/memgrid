# MemGrid

> 为 AI 编程智能体打造的项目级语义记忆系统。用自演化知识网格取代全量代码库上下文加载。

<p align="center">
  <a href="https://www.npmjs.com/package/memgrid"><img src="https://img.shields.io/npm/v/memgrid?color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/memgrid"><img src="https://img.shields.io/npm/dm/memgrid?color=green" alt="npm downloads"></a>
  <a href="https://github.com/wenliangw/memgrid/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/memgrid" alt="license"></a>
</p>

> 📖 [English README](README.md)

## 🧠 什么是 MemGrid？

MemGrid 为你的项目构建一张**记忆网络**——不是扁平文档，而是互相关联的**知识单元**。每个单元代表一件事：一个方法、一个组件、一个设计模式、一个 Bug 修复方案、一个编码风格偏好，或一条工具使用规则。

当 AI 编程智能体开始一项任务时，MemGrid 不再把整个代码库塞进上下文，而是只检索相关的知识单元——并沿着它们之间的关联，自动拉入更多上下文。

你可以把它理解为**项目的持久大脑**，越用越聪明。

## 🎯 解决什么问题？

当前 AI 编程工具面临上下文困局：

- 加载整个项目 → Token 巨大浪费、响应缓慢、内存溢出
- 只看当前文件 → 没有项目认知、输出通用化、反复犯错
- 每次对话从零开始 → 无法积累经验、风格不一致

MemGrid 的解法：给智能体恰好需要的上下文，不多也不少。

## 🚀 上手 — 一句话就行

你不需要读 CLI 文档，不需要复制粘贴配置文件。让你的 AI 帮你搞定一切。

**对你的 AI 说：**

> 请为这个项目配置 MemGrid —— 安装它、扫描代码库、配置自动同步，让记忆网格保持最新。

就这样。你的 AI 会：

1. 运行 `npm install -g memgrid`（如果还没装）
2. 运行 `memgrid init` 扫描项目并构建知识网络
3. 配置自动同步 Hook，每次任务后自动更新
4. （如果是 MCP 宿主）注册 MemGrid MCP 服务

无需手动编辑配置，无需折腾 YAML。告诉 AI 你想要什么就行。

> **想自己动手？** 下面有传统 CLI 方式。

<details>
<summary>手动配置（CLI）</summary>

```bash
npm install -g memgrid

cd your-project
memgrid init              # 扫描项目，构建记忆网络

memgrid search "..."      # 每次任务前搜索
memgrid sync              # 每次任务后同步
```

</details>

## 🔌 集成 — Claude Code

MemGrid 为 Claude Code 而生。`memgrid init` 自动完成一切配置：

- **MCP 服务** — 自动注册到 `claude.json`。你的 Claude 智能体获得 `memgrid_search` 和 `memgrid_suggest` 两个原生工具。
- **自动同步 Hook** — `PostCompletion` 和 `PostToolUse` Hook 自动注入到 `.claude/settings.json`。每次任务完成、每次文件修改后，网格自动更新。
- **CLAUDE.md** — 添加一段配置，教会你的 Claude 智能体在开始工作前主动搜索记忆（见自动同步 Hook 章节）。

所有注入都是**非破坏性的**——已有配置会被合并，不会被覆盖。

> **使用其他工具？**MemGrid 搜索输出为标准 Markdown 格式。运行 `memgrid search "你的任务"` 并将结果粘贴到任意 AI 工具的 Prompt 或项目指令中即可。需要注意，自动同步（Hook）目前仅支持 Claude Code。

## 📐 架构

```
┌─────────────────────────────────────────┐
│           MemGrid（智能体大脑）            │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  调度层（元认知）                    │  │
│  │  skill_trigger / mcp_trigger      │  │
│  │  rule_trigger                     │  │
│  │  "什么任务该用什么工具"              │  │
│  └──────────┬─────────────────────────┘  │
│             │ 驱动                        │
│  ┌──────────▼─────────────────────────┐  │
│  │  知识层（语义）                      │  │
│  │  method / component / pattern      │  │
│  │  config / error_solution           │  │
│  │  "这个项目是什么"                    │  │
│  └──────────┬─────────────────────────┘  │
│             │ 塑造                        │
│  ┌──────────▼─────────────────────────┐  │
│  │  风格层（你的 DNA）                  │  │
│  │  style_preference                  │  │
│  │  architecture_principle            │  │
│  │  decision（为什么这么做）            │  │
│  │  "你的代码长什么样"                  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 📦 记忆单元类型

| 类型 | 存储内容 | 示例 |
|------|---------|------|
| `method` | 函数/类方法 | `CreationDomainService.create()` |
| `component` | UI 组件 | `CreationCard` |
| `pattern` | 设计模式或约定 | ResponseBuilder 链式模式 |
| `config` | 配置/环境 | Docker 服务、技术栈 |
| `error_solution` | Bug + 修复方案 | "GLM OOM → 切换 DeepSeek" |
| `decision` | 代码决策 + 理由 | "为什么 delete 返回 true 而非 null" |
| `skill_trigger` | 何时使用哪个 Skill | "Figma 相关 → 启用 chakra MCP" |
| `mcp_trigger` | 何时调用哪个 MCP | "新 Chakra 组件 → get_component_example" |
| `rule_trigger` | 何时加载哪个规则 | "服务端代码 → 加载 coding-philosophy" |
| `style_preference` | 你的编码风格 | "函数式管道优于 for 循环" |
| `architecture_principle` | 架构红线 | "Controller 绝不直接调用 Repository" |

## 🔄 自动同步 Hook

`memgrid init` 自动配置 Hook，无需手动维护：

| Hook | 触发时机 | 作用 |
|------|---------|------|
| **PostCompletion** | 智能体完成一项任务 | 运行 `memgrid sync` |
| **PostToolUse** | 文件写入/编辑工具被调用 | 运行 `memgrid sync` |

增量同步机制：只重新扫描变更文件（hash 比对）、修复断裂关联（模糊匹配）、自动学习新模式。所有注入都是**非破坏性的**——已有配置会被合并，不会被覆盖。

## 🌐 语言支持

MemGrid 内核**语言无关**。扫描器是即插即用的插件：

| 扫描器 | 检测方式 | 提取内容 |
|--------|---------|---------|
| **TypeScript** | `tsconfig.json`、`.ts` 文件 | 类、方法、导出函数（AST，基于 ts-morph） |
| **JavaScript** | `package.json`（无 tsconfig）、`.js` 文件 | 导出函数、类、箭头函数（正则） |
| **Python** | `pyproject.toml`、`.py` 文件 | 函数、类、装饰器、文档字符串（正则） |
| **Go** | `go.mod`、`.go` 文件 | 函数、方法、结构体、接口（正则） |
| **Rust** | `Cargo.toml`、`.rs` 文件 | 函数、结构体、枚举、Trait、impl 块（正则） |
| **Markdown** | `.md` 文件 | 标题作为知识单元 |
| **Rules** | `.claude/rules/*.md` | 设计模式、编码规则、触发单元 |
| **Config** | `package.json`、`pyproject.toml`、`go.mod`、`Cargo.toml`、`docker-compose.yml` | 技术栈、依赖、基础设施 |

**添加新语言**只需实现 `Scanner` 接口——核心引擎（存储、检索、学习、同步）无需改动：

```typescript
export class PythonScanner implements Scanner {
  readonly name = 'python';
  detect(projectRoot: string): boolean { ... }
  async scan(options: ScanOptions): Promise<MemoryUnit[]> { ... }
}
```

## 🆚 对比其他方案

| | Claude Auto Memory | Mem0 | Cursor Indexing | **MemGrid** |
|---|---|---|---|---|
| 粒度 | 文档级 | 对话级 | 文件级 | **知识单元级** |
| 结构 | 扁平文本 | 扁平 | 文件树 | **网状（图结构）** |
| 检索 | 全量加载 | 语义 | 语义 | **混合 + 关联遍历** |
| 学习 | 线性追加 | 无 | 无 | **任务后自演化** |
| 增量同步 | 不支持 | 不支持 | 全量重建 | **Hash 差异增量** |
| 工具感知 | 不支持 | 不支持 | 不支持 | **触发单元** |
| 风格感知 | 仅规则 | 不支持 | 不支持 | **风格层** |

## 📊 性能

| 场景 | 耗时 |
|------|------|
| 搜索（关键词） | < 3ms |
| 搜索（重复查询，LRU 缓存） | 0ms |
| 同步（0 变更） | ~5ms |
| 同步（1 文件变更） | ~2s |
| 全量初始化（150 个单元） | ~10s |

Token 消耗相比全量代码库上下文降低约 **40%**（总量 67K → ~55K，Top-10 从 10K → ~6K）。

## 📁 文件格式

记忆单元以 JSON 格式存储在 `.memgrid/units/` — **对 Git 友好，人类也可读**。

```json
{
  "id": "method_creation_create",
  "type": "method",
  "summary": "CreationDomainService.create — 创建新作品",
  "source": {
    "file": "apps/server/src/creation/creation.domain-service.ts",
    "lines": "45-67"
  },
  "signatures": ["CreationDomainService.create"],
  "content": {
    "description": "创建新作品，验证所有权，保存到数据库",
    "inputs": "userId: string, dto: Partial<CreationEntity>",
    "outputs": "ApiResponse{ value: savedEntity }"
  },
  "associations": [
    {
      "to": "pattern_response_builder",
      "relation": "implements_pattern",
      "weight": 0.9
    }
  ],
  "meta": {
    "created": "2026-06-28T00:00:00.000Z",
    "updated": "2026-06-28T00:00:00.000Z",
    "confidence": 0.8,
    "usage_count": 0,
    "status": "active"
  }
}
```

## 💬 用户反馈

这个项目刚起步，我们很想听听你的使用体验——哪里好用、哪里不好用、还希望它做什么。

👉 [github.com/wenliangw/memgrid/issues](https://github.com/wenliangw/memgrid/issues)

## 📝 CLI 参考

```bash
memgrid init                          # 初始化记忆网格
memgrid search <查询词> [--max N] [--hops N] [--semantic 0.5]   # 搜索
memgrid sync                          # 增量同步
memgrid add --type decision --summary "..." --description "..."  # 添加自定义单元
memgrid learn [--description "..."]   # 自然语言学习
memgrid stats                         # 网格统计
memgrid serve                         # 启动 MCP 服务
```

## License

MIT

# MemGrid

> Project-level semantic memory for AI coding agents. Replaces full-codebase context loading with a self-evolving knowledge-mesh.

<p align="center">
  <a href="https://www.npmjs.com/package/memgrid"><img src="https://img.shields.io/npm/v/memgrid?color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/memgrid"><img src="https://img.shields.io/npm/dm/memgrid?color=green" alt="npm downloads"></a>
  <a href="https://github.com/wenliangw/memgrid/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/memgrid" alt="license"></a>
</p>

## 🧠 What is MemGrid?

MemGrid builds a **memory mesh** of your project — not as flat documents, but as interconnected **knowledge units**. Each unit represents one thing: a method, a component, a design pattern, a bug fix, a coding style preference, or a tooling rule.

When an AI coding agent starts a task, instead of dumping your entire codebase into context, MemGrid retrieves only the relevant units — and traverses their associations to pull in related context.

Think of it as **your project's persistent brain** that gets sharper with every task.

## 🎯 The Problem

AI coding tools today face a context dilemma:

- Load the whole project → massive token waste, slow responses, OOM
- Load only open files → no context, generic output, repeated mistakes
- Start fresh every session → no learning, inconsistent style

MemGrid solves this by giving the agent exactly what it needs, nothing it doesn't.

## 🚀 Setup — Just Tell Your AI

You don't need to read CLI docs or copy-paste configs. Your AI agent can set up MemGrid for you.

**Tell your AI agent:**

> Please set up MemGrid for this project — install it, scan the codebase, and configure auto-sync so the memory grid stays up to date.

That's it. Your AI will:

1. Run `npm install -g memgrid` (if not already installed)
2. Run `memgrid init` to scan your project and build the knowledge mesh
3. Configure auto-sync hooks so the grid updates after every task
4. (For MCP hosts) Register the MemGrid MCP server

No manual config editing. No YAML wrangling. Just tell your AI what you want.

> **Prefer to do it yourself?** Classic CLI quick start below.

<details>
<summary>Manual setup (CLI)</summary>

```bash
npm install -g memgrid

cd your-project
memgrid init              # Scan project, build memory mesh

memgrid search "..."      # Search before each task
memgrid sync              # Sync after each task
```

</details>

## 🔌 Integration — Claude Code

MemGrid is built for Claude Code. `memgrid init` handles everything automatically:

- **MCP Server** — auto-registered in `claude.json`. Your Claude agent gets `memgrid_search` and `memgrid_suggest` as native tools.
- **Auto-Sync Hooks** — `PostCompletion` and `PostToolUse` hooks auto-injected into `.claude/settings.json`. Grid stays fresh after every task and every file change.
- **CLAUDE.md** — add a block to teach your Claude agent to search memory before starting work (see Auto-Sync Hooks section).

All injections are **non-destructive** — existing settings are merged, never overwritten.

> **Using other tools?** MemGrid outputs plain Markdown. Run `memgrid search "your task"` and paste the result into any AI tool's prompt or project instructions. Just be aware that automatic sync (hooks) is currently only available for Claude Code.

## 📐 Architecture

```
┌─────────────────────────────────────────┐
│           MemGrid (Agent Brain)          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Scheduler Layer (Meta-Cognition)  │  │
│  │  skill_trigger / mcp_trigger      │  │
│  │  rule_trigger                     │  │
│  │  "What tool for what task"        │  │
│  └──────────┬─────────────────────────┘  │
│             │ drives                     │
│  ┌──────────▼─────────────────────────┐  │
│  │  Knowledge Layer (Semantics)       │  │
│  │  method / component / pattern      │  │
│  │  config / error_solution           │  │
│  │  "What this project is"             │  │
│  └──────────┬─────────────────────────┘  │
│             │ shapes                     │
│  ┌──────────▼─────────────────────────┐  │
│  │  Style Layer (Your DNA)            │  │
│  │  style_preference                  │  │
│  │  architecture_principle            │  │
│  │  decision (why we did this)        │  │
│  │  "What your code looks like"       │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 📦 Memory Unit Types

| Type | What it stores | Example |
|------|---------------|---------|
| `method` | A function/class method | `CreationDomainService.create()` |
| `component` | A UI component | `CreationCard` |
| `pattern` | Design pattern or convention | ResponseBuilder chain pattern |
| `config` | Configuration/env | Docker services, tech stack |
| `error_solution` | A bug + how it was fixed | "GLM OOM → switch to DeepSeek" |
| `decision` | A code decision + rationale | "Why delete returns true, not null" |
| `skill_trigger` | When to use which skill | "Figma work → enable chakra MCP" |
| `mcp_trigger` | When to call which MCP | "New Chakra component → get_component_example" |
| `rule_trigger` | When to load which rule | "Server code → load coding-philosophy" |
| `style_preference` | Your coding style | "functional pipes over for-loops" |
| `architecture_principle` | Architecture red lines | "Controller never calls Repository directly" |

## 🔄 Auto-Sync Hooks

`memgrid init` configures hooks to keep the grid current without manual effort:

| Hook | Trigger | What it does |
|------|---------|--------------|
| **PostCompletion** | Agent finishes a task | Runs `memgrid sync` |
| **PostToolUse** | File write/edit tools | Runs `memgrid sync` |

Incremental sync: only re-scans changed files (hash-diff), repairs broken associations (fuzzy match), and auto-learns new patterns. All injections are **non-destructive** — existing config is merged, never overwritten.

## 🌐 Language Support

MemGrid is **language-agnostic** at its core. Scanners are swappable plugins:

| Scanner | Detects | Extracts |
|---------|---------|----------|
| **TypeScript** | `tsconfig.json`, `.ts` files | Classes, methods, exported functions (AST via ts-morph) |
| **JavaScript** | `package.json` (no tsconfig), `.js` files | Exported functions, classes, arrow functions (regex) |
| **Python** | `pyproject.toml`, `.py` files | Functions, classes, decorators, docstrings (regex) |
| **Go** | `go.mod`, `.go` files | Functions, methods, structs, interfaces (regex) |
| **Rust** | `Cargo.toml`, `.rs` files | Functions, structs, enums, traits, impl blocks (regex) |
| **Markdown** | Any `.md` files | Headings as knowledge units |
| **Rules** | `.claude/rules/*.md` | Design patterns, coding rules, trigger units |
| **Config** | `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `docker-compose.yml` | Tech stack, dependencies, infrastructure |

**Adding a new language** means implementing the `Scanner` interface — the core engine stays untouched:

```typescript
export class PythonScanner implements Scanner {
  readonly name = 'python';
  detect(projectRoot: string): boolean { ... }
  async scan(options: ScanOptions): Promise<MemoryUnit[]> { ... }
}
```

## 🆚 vs Alternatives

| | Claude Auto Memory | Mem0 | Cursor Indexing | **MemGrid** |
|---|---|---|---|---|
| Granularity | Documents | Conversations | Files | **Knowledge units** |
| Structure | Flat text | Flat | File tree | **Mesh (graph)** |
| Retrieval | Full load | Semantic | Semantic | **Hybrid + Traverse** |
| Learning | Linear append | None | None | **Post-task self-evolution** |
| Incremental sync | No | No | Full re-index | **Hash-diff incremental** |
| Tool-aware | No | No | No | **Trigger units** |
| Style-aware | Rules only | No | No | **Style layer** |

## 📊 Performance

| Scenario | Time |
|----------|------|
| Search (keyword) | < 3ms |
| Search (repeated, LRU cache) | 0ms |
| Sync (0 changes) | ~5ms |
| Sync (1 file changed) | ~2s |
| Full init (150 units) | ~10s |

Token consumption reduced **~40%** vs full-codebase context (67K → ~55K total, top-10 from 10K → ~6K).

## 📁 File Format

Memory units are stored as JSON in `.claude/memory-grid/units/` — **Git-friendly and human-readable**.

```json
{
  "id": "method_creation_create",
  "type": "method",
  "summary": "CreationDomainService.create — Create a new work",
  "source": {
    "file": "apps/server/src/creation/creation.domain-service.ts",
    "lines": "45-67"
  },
  "signatures": ["CreationDomainService.create"],
  "content": {
    "description": "Creates a new work, verifies ownership, saves to DB",
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

## 💬 Feedback

This project is in its early days. We'd love to hear about your experience — what works, what doesn't, what you wish it could do.

👉 [github.com/wenliangw/memgrid/issues](https://github.com/wenliangw/memgrid/issues)

## 📝 CLI Reference

```bash
memgrid init                          # Initialize memory grid
memgrid search <query> [--max N] [--hops N] [--semantic 0.5]   # Search
memgrid sync                          # Incremental sync
memgrid add --type decision --summary "..." --description "..."  # Add custom unit
memgrid learn [--description "..."]   # NLP natural-language learning
memgrid stats                         # Grid statistics
memgrid serve                         # Start MCP server
```

## License

MIT

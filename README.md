# MemGrid

> Project-level semantic memory for AI coding agents. Replaces full-codebase context loading with a self-evolving knowledge-mesh.

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

## 🚀 Quick Start

```bash
npm install -g memgrid
# or
pnpm add -g memgrid
```

### Initialize

```bash
cd your-project
memgrid init
```

MemGrid auto-detects your project's languages and scans all relevant source files.

**Supported languages:** TypeScript, JavaScript, Python, Go, Rust, and any Markdown documentation.

```bash
# Example output for a TypeScript + Markdown + Rules project:
# 🔍 Scanning project (typescript, markdown, rules, config)...
```

The grid is stored in `.claude/memory-grid/`.

### Search

```bash
# Hybrid search (keyword + semantic, configurable weight)
memgrid search "add file upload to creation endpoint"

# With options
memgrid search "error handling pattern" --semantic 0.6 --max 5 --hops 2
```

### Incremental Sync

Fast sync after code changes — only re-scans changed files:

```bash
memgrid sync
# Output:
# 📁 Changed files:  3
# 🗑️  Removed files:  0
# 📝 Updated units:  12
# ⚠️  Stale units:    0
# 🔗 Repaired links: 2
# ⏱️  Done in 1834ms
```

### Add Custom Units

```bash
memgrid add \
  --type decision \
  --summary "Why we chose PostgreSQL over MongoDB" \
  --description "ACID compliance for financial data, team expertise, $REASON" \
  --file docs/decisions/database.md
```

### Stats

```bash
memgrid stats
# 📊 MemGrid Statistics
#   Total units:    150
#   Active:         142
#   Archived:       8
#   Last scan:      2026-06-28T10:00:00.000Z
```

### MCP Server

```bash
memgrid serve
```

Exposes MemGrid as an MCP tool — plug into Claude Desktop, VS Code, or any MCP-compatible agent.

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
| Search (repeated, LRU) | 0ms |
| Sync (0 changes) | ~5ms |
| Sync (1 file changed) | ~2s |
| Full init (150 units) | ~10s |

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

`mesh.json` stores the grid metadata including `fileSnapshot` for incremental sync and `edgeIndex` for fast association traversal.

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

**Adding a new language** means implementing the `Scanner` interface — the core engine (storage, retrieval, learning, sync) stays untouched.

```typescript
// src/scanner/python.ts (example)
export class PythonScanner implements Scanner {
  readonly name = 'python';
  detect(projectRoot: string): boolean { ... }
  async scan(options: ScanOptions): Promise<MemoryUnit[]> { ... }
}
```

## 🔌 Integration

MemGrid outputs **standardized Markdown context** consumable by any AI coding tool:

- **Claude Code** — via MCP Server or Hook
- **Cursor / Windsurf** — via Rules file injection
- **GitHub Copilot** — via `.github/copilot-instructions.md`
- **Aider / Cline / Continue** — via custom prompt templates

```bash
# Start MCP Server
memgrid serve
```

## 🗺️ Roadmap

- [x] v0.1 — Core engine (scan, search, store, CLI)
- [x] v0.2 — MCP Server + tests + Septonir integration
- [x] v0.3 — Auto-learning engine (post-task grid evolution)
- [x] v0.4 — Hybrid semantic search
- [x] v0.5 — Incremental sync engine (hash diff + fuzzy repair)
- [ ] v1.0 — Web dashboard + CI/CD integration

## License

MIT

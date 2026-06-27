# MemGrid

> Project-level semantic memory for AI coding agents. Replaces full-codebase context loading with a self-evolving knowledge-mesh.

## 🧠 What is MemGrid?

MemGrid builds a **memory mesh** of your project — not as flat documents, but as interconnected **knowledge units**. Each unit represents one thing: a method, a component, a design pattern, a bug fix, a coding style preference, or a tooling rule.

When an AI coding agent starts a task, instead of dumping your entire codebase into context, MemGrid retrieves only the relevant units — and traverses their associations to pull in context they need.

Think of it as **your project's persistent brain** that gets sharper with every task.

## 🎯 The Problem

AI coding tools today face a context dilemma:

- Load the whole project → massive token waste, slow responses, OOM
- Load only open files → no context, generic output, repeated mistakes
- Start fresh every session → no learning, inconsistent style

MemGrid solves this by giving the agent exactly what it needs, nothing it doesn't.

## 📐 Architecture

```
┌───────────────────────────────────────┐
│         MemGrid (Agent Brain)         │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  Scheduler Layer (Meta-Cognition)│  │
│  │  skill_trigger / mcp_trigger    │  │
│  │  rule_trigger                   │  │
│  │  "What tool for what task"      │  │
│  └──────────┬──────────────────────┘  │
│             │ drives                  │
│  ┌──────────▼──────────────────────┐  │
│  │  Knowledge Layer (Semantics)     │  │
│  │  method / component / pattern   │  │
│  │  config / error_solution        │  │
│  │  "What this project is"          │  │
│  └──────────┬──────────────────────┘  │
│             │ shapes                  │
│  ┌──────────▼──────────────────────┐  │
│  │  Style Layer (Your DNA)          │  │
│  │  style_preference               │  │
│  │  architecture_principle         │  │
│  │  decision (why we did this)     │  │
│  │  "What your code looks like"     │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

## 🚀 Quick Start

```bash
npm install -g memgrid
# or
pnpm add -g memgrid
```

Initialize memory grid for your project:

```bash
cd your-project
memgrid init
```

Search for relevant context:

```bash
memgrid search "add file upload to creation endpoint"
```

## 📦 Memory Unit Types

| Type | What it stores | Example |
|------|---------------|---------|
| `method` | A function/class method | `CreationDomainService.create()` |
| `component` | A UI component | `CreationCard` |
| `pattern` | Design pattern or convention | ResponseBuilder chain pattern |
| `config` | Configuration/env setup | Docker services, database URL |
| `error_solution` | A bug + how it was fixed | "GLM OOM → switch to DeepSeek" |
| `decision` | A code decision + rationale | "Why delete returns true, not null" |
| `skill_trigger` | When to use which skill | "Figma work → enable chakra MCP" |
| `mcp_trigger` | When to call which MCP | "New Chakra component → get_component_example" |
| `rule_trigger` | When to load which rule | "Server code → load coding-philosophy" |
| `style_preference` | Your coding style | "functional pipes over for-loops" |
| `architecture_principle` | Architecture red lines | "Controller never calls Repository directly" |

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

## 🔄 Self-Evolution

MemGrid isn't static — it learns after every task:

```
Task Complete
  → What did we build?      → Add method/component units
  → What mistakes were made? → Add error_solution units
  → What decisions matter?   → Add decision units
  → What tools worked well?  → Update trigger units
  → What style emerged?     → Update preference units
  → Grid density +1
```

## 🆚 vs Alternatives

| | Claude Auto Memory | Mem0 | Cursor Indexing | **MemGrid** |
|---|---|---|---|---|
| Granularity | Documents | Conversations | Files | **Knowledge units** |
| Structure | Flat text | Flat | File tree | **Mesh (graph)** |
| Retrieval | Full load | Semantic | Semantic | **Search + Traverse** |
| Learning | Linear append | None | None | **Self-evolving** |
| Tool-aware | No | No | No | **Trigger units** |
| Style-aware | Rules only | No | No | **Style layer** |

## 📊 Token Savings

```
Without MemGrid: 200K tokens × $2.00/session
With MemGrid:      5K tokens × $0.05/session
Savings: 97.5%
```

## 📁 File Format

Memory units are stored as YAML files in `.claude/memory-grid/units/` — **Git-friendly and human-readable**.

``.json
id: method_creation_create
type: method
summary: "CreationDomainService.create — Create a new work"
source:
  file: apps/server/src/creation/creation.domain-service.ts
  lines: "45-67"
content:
  description: "Creates a new work, verifies ownership, saves to DB"
  inputs: "userId: string, dto: Partial<CreationEntity>"
  outputs: "ApiResponse{ value: savedEntity }"
associations:
  - to: pattern_response_builder
    relation: implements_pattern
    weight: 0.9
```

## 🗺️ Roadmap

- [x] v0.1 — Core engine (scan, search, store, CLI)
- [x] v0.2 — MCP Server (plug into any MCP-compatible tool) + tests
- [x] v0.3 — Auto-learning (post-task grid update)
- [x] v0.4 — Hybrid semantic search (semantic similarity via embedding)
- [ ] v0.5 — Team sharing (project vs personal layers)
- [ ] v1.0 — Web UI + CI/CD integration

## License

MIT

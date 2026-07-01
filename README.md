# MemGrid

> A cognitive memory engine for AI coding agents. One person, one grid.

<p align="center">
  <a href="https://www.npmjs.com/package/memgrid"><img src="https://img.shields.io/npm/v/memgrid?color=blue" alt="npm"></a>
  <a href="https://github.com/wenliangw/memgrid/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/memgrid" alt="license"></a>
</p>

## What is MemGrid?

MemGrid gives your AI agent **persistent memory**. It builds a knowledge mesh from your project and your conversations — methods, architecture decisions, bug fixes, style preferences, and things you said last week. The agent searches this grid before starting work, so it comes in with context instead of starting from zero.

Two layers, like how humans remember:

- **Memory grid** — quick recall of key facts, decisions, preferences (think: "I remember we chose Redis for caching")
- **Library** — full documents when you need details (think: "let me pull up the PRD")

## Quick Start

### Claude Code

```bash
npm install -g memgrid
cd your-project
memgrid init
```

That's it. `memgrid init` auto-configures:

- MCP server registered in `~/.claude/settings.json`
- Auto-sync hooks (PostCompletion + post-commit)
- MemGrid block injected into `CLAUDE.md`

Your Claude agent gets `memgrid_search`, `memgrid_add`, `memgrid_extract`, and more — immediately available.

### OpenClaw Gateway

```bash
npm install -g memgrid
memgrid init --server
```

Auto-detects your OpenClaw agents, creates per-agent session domains for conversation memory, registers MCP server in `openclaw.json`, and injects MemGrid instructions into each agent's `AGENTS.md`.

Restart OpenClaw Gateway — done.

### ⚠️ Note for OpenClaw users migrating from `memory_search`

If your agent's `AGENTS.md` already has instructions for `memory_search`, `memory_get`, or `memory/atoms/`, remove those sections. MemGrid replaces them — keeping both will confuse the agent. See the MemGrid block (`<!-- MEMGRID:START -->`) for the correct instructions.

`memgrid init` does **not** modify your existing content — it only appends the MemGrid block. Manual cleanup of old memory instructions is recommended.

## How It Works

```
Agent starts a task
  → memgrid_search("user authentication")
  → finds: auth service method, JWT config, security preference, last week's PR #94
  → agent now has full context, 0ms

Agent finishes a task
  → memgrid sync (auto-hooked)
  → new code patterns detected, associations updated

Agent ends a conversation
  → memgrid_extract (from conversation)
  → decisions, preferences, events recorded as memory units
  → refined by the agent itself (it knows what mattered)
```

## Memory Types

Four simple types, for both code and conversation:

| Type         | Use for                                                              |
| ------------ | -------------------------------------------------------------------- |
| `fact`       | Methods, API endpoints, tech stack, config values                    |
| `insight`    | Design decisions, bug fixes, lessons learned, architecture rationale |
| `event`      | Releases, PR merges, deployments, important discussions              |
| `preference` | Coding style, conventions, "always do X", "never do Y"               |

## Real-World Use Cases

**Coming back to a project after a week.** Search once — agent remembers the architecture, the decisions made, the PRs you merged, and the conversation where you decided to use Kafka instead of RabbitMQ.

**Onboarding a new agent.** `memgrid init` → agent scans your codebase and rules → instantly productive, no need to dump your entire project into context.

**Keeping code reviews consistent.** Memory stores your review habits ("no raw JSON, use ResponseBuilder", "check for N+1 queries"). Agent reviews against these preferences every time.

**Cross-project knowledge transfer.** Your personality domain stores preferences that carry across all projects — how you like error handling, your naming conventions, your stance on ORMs vs raw SQL.

**Preventing repeated mistakes.** Fixed a bug last month? The error_solution is in the grid. Agent searches before implementing similar code — won't repeat the same mistake.

## Feedback

MemGrid is actively developed. Found a bug? Have a feature idea? Want a scanner for your language?

👉 [github.com/wenliangw/memgrid/issues](https://github.com/wenliangw/memgrid/issues)

Pull requests welcome. The scanner interface is designed to be extended — adding support for a new language is implementing one interface.

## License

MIT

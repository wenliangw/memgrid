# Changelog

All notable changes to MemGrid.

## v0.10.3 — Fix Version Detection in nvm (2026-07-01)

### Fixed
- **`--version` returns correct value in nvm environments**: `readPackageVersion()` was
  resolving `process.argv[1]` through the nvm symlink (`bin/memgrid`) instead of the
  real path, causing it to walk upward from `bin/` and never find the memgrid
  `package.json`. Now uses `fs.realpathSync()` to resolve symlinks before searching.
- **Replaced `__dirname`-based approach**: `__dirname` is `undefined` in ES modules.
  Switched to `searchUpwardForVersion()` that walks directory ancestors.
- **Fallback changed** from hardcoded `'0.10.0'` to `'0.0.0-unknown'` to avoid misleading
  version reports.

## v0.10.2 — Fix Agent Domain Isolation (2026-07-01)

### Fixed
- **AGENTS.md / CLAUDE.md examples now include `domain` param**: memgrid init previously
  injected example calls (search/extract/add/review) without a `domain` argument, which
  could cause agents in multi-domain setups to read the wrong memory domain. The injected
  block now auto-detects the workspace directory and includes `domain="<path>"` in all
  example calls plus a `- **Domain:**` header showing the current domain.
- **Up-to-date detection upgraded**: existing blocks are only considered current when they
  contain both `domain=` and `memgrid_extract` (previously only checked for `memgrid_extract`).

## v0.10.1 — Cross-Domain CRUD + Pre-Commit + Rules Ingestion (2026-07-01)

### Added
- **Cross-domain CRUD**: `memgrid_add` supports optional `domain` parameter for writing
  to any domain (not just the current one). `memgrid_update` and `memgrid_archive` MCP tools added.
- **Pre-commit hook**: `.githooks/pre-commit` auto-formats and lints staged files on every commit.
  `pinst` for disabled-by-default, activated on `npm install`.
- **Rules auto-ingestion**: `memgrid init` now extracts rules from AGENTS.md/CLAUDE.md as
  memory units and auto-updates MemGrid blocks in discovered agent configs.

### Fixed
- Relaxed perf LRU cache threshold to accommodate CI variance.

## v0.10.0 — Cognitive Memory Engine (2026-06-30)

First stable release of the v0.10 architecture. Upgrades MemGrid from a project memory tool to a **personal cognitive grid engine** — one person, one grid, multiple domains.

### Core Architecture
- **Multi-domain**: personality (built-in) + project domains + agent session domains
- **Domain de-typing**: domains derive meaning from content, not classification labels
- **Two-layer memory**: memory grid (quick recall) + library (full documents)

### Cognitive Type System
- **4 cognitive types** replace 11 code-metaphor types: `fact` | `insight` | `event` | `preference`
- Legacy types auto-mapped (method→fact, decision→insight, etc.)
- `narrative` field replaces `content.description` — natural language story
- `keywords` for lightweight indexing, `library_ref` for cross-referencing
- `retentionScore` no longer weighted by type — purely confidence × usage × connectivity

### Library (Knowledge Base)
- Full document storage with MiniSearch full-text index
- CLI: `memgrid library-add/search/list/get/remove`
- `memgrid migrate` — batch-import long documents from existing memory files

### Extract Engine
- Rule-based memory extraction from conversation text
- Chinese text support, auto-dedup, keyword extraction
- `memgrid_extract` MCP tool + `memgrid extract` CLI
- Agent self-refinement: agents refine their own extract results with full context

### Auto-Migration
- `memgrid init --server` detects MEMORY.md, memory/**/*.md
- Short content → memory unit, long content → library
- Idempotent, original files preserved

### Integration
- Claude Code: one-command setup via `memgrid init`
- OpenClaw Gateway: `memgrid init --server` auto-detects agents
- AGENTS.md injection template updated with extract + refine workflow

### Cross-Domain CRUD
- `memgrid_add` supports optional `domain` parameter for cross-domain memory routing
- `memgrid_update` and `memgrid_archive` MCP tools added

### Pre-Commit Hook
- Auto-format + lint on every commit via `.githooks/pre-commit`
- Prettier + ESLint on staged files only

### Rules Ingestion
- `memgrid init` auto-extracts rules from AGENTS.md/CLAUDE.md as memory units
- Auto-updates MemGrid blocks in discovered agent configs

### Polish
- CLI version reads from package.json (no more hardcoded stale versions)
- README rewritten — practical, no comparisons, real use cases
- 91 tests, zero ESLint warnings

---

## v0.10.0-beta.5 — Extract Engine + Migration CLI (2026-06-30)

### Added
- **Extract Engine** (`src/extract/`): rule-based memory extraction from conversation text
  - Detects decisions, preferences, events, and facts via keyword+pattern matching
  - Chinese text support (中文句式识别)
  - Auto-deduplication, keyword extraction, confidence scoring
  - `memgrid_extract` MCP tool for Agent use
  - `memgrid extract` CLI command
  - LLM refinement prompt builder (for future LLM integration)
  - 11 tests covering: decision/preference/event/fact extraction, Chinese, dedup, auto-accept
- **`memgrid migrate` CLI command**: migrate existing long documents (>500 chars) to library
  - `--source <path>` to scan .md files
  - `--domain <name>` target domain
  - `--dry-run` preview mode
  - Auto-updates memory units with `library_ref`
- **ExtractEngine** integrated into `MemGrid` class

### Changed
- MCP server: added `memgrid_extract` tool with conversation/domain/autoAccept params
- MemGrid class: new `extract` property (ExtractEngine instance)

---

## v0.10.0-beta.4 — Auto Migration (2026-06-30)

### Added
- **Auto-migration**: `memgrid init --server` now automatically detects existing
  OpenClaw memory files (MEMORY.md, memory/**/*.md) and migrates them:
  - Short content (≤500 chars) → memory unit
  - Long content (>500 chars) → library document + memory unit with `library_ref`
  - Original files preserved (not deleted)
  - Skips already-migrated content (idempotent)
  - Migration report on completion
- **smart type inference**: auto-detects fact/insight/event/preference from filename
  and content patterns during migration
- **keyword extraction**: automatic TF-based keyword generation for migrated content

### Removed
- Static `MIGRATION.md` guide — replaced by automatic migration

---

## v0.10.0-beta.3 — Cognitive Type System + Library (2026-06-30)

### Breaking Changes
- **Unit type system refactored**: 11 code-metaphor types (method|pattern|config|...) → 4 cognitive types: `fact` | `insight` | `event` | `preference`
  - Legacy types still accepted (auto-mapped on write: method→fact, decision→insight, etc.)
  - Auto-migration in FileStore: old units loaded from disk are upgraded automatically
- **Unit structure simplified**:
  - New `narrative` field replaces `content.description` — natural language story of the memory
  - `code_snippet` promoted to top-level field
  - `keywords` added for lightweight indexing
  - Old `content.*` fields (inputs/outputs/dependencies/style_notes/trigger/action) deprecated but still accepted
- **retentionScore no longer weights by unit type** — all types treated equally, retention based on confidence × usage × connectivity × narrative richness
- **RelationType expanded**: adds `caused_by`, `causes`, `related_to`, `references`, `contradicts`, `supersedes` alongside legacy types

### Added
- **Library (knowledge base)**: new `src/library/` module — stores full documents, separate from memory units
  - `LibraryManager`: add/search/get/list/remove with MiniSearch full-text index
  - CLI: `memgrid library-add` (alias `lib-add`), `library-search` (`lib-search`), `library-list`, `library-get`, `library-remove`
  - Integrated into `MemGrid` class as `mg.library`
  - Memory units can reference library docs via `library_ref` field
  - Backward compat: `content?` field on MemoryUnit for legacy scanner output

### Changed
- **DomainType**: relaxed from enum to `'personality' | string` — domains derive meaning from content, not labels
- NLP parser (`learn/nlp.ts`): updated type detection to use new cognitive types
- Conflict detection: simplified to only check `preference` and `insight` types
- All scanners, sync phases, retrieve engine, MCP server, and CLI adapted to new type system

---

## v0.10.0 — Multi-Domain Architecture (2026-06-30)

### Added
- **Multi-domain architecture**: one person, one cognitive grid, multiple domains
- **DomainManager**: user grid init, domain registration/detection/unregistration
- **Three CLI init modes**:
  - User grid: `memgrid init` → `~/.memgrid/` with personality domain
  - Project domain: `memgrid init` (in project dir) → `.memgrid/` with auto-config
  - OpenClaw server: `memgrid init --server --openclaw` → agent session domains
- **MemoryDomain, UserGrid, CrossDomainAssociation types**
- **Automatic project configuration**:
  - `.gitignore` (excludes personal memories)
  - `.claude/settings.json` (MCP + hooks)
  - `CLAUDE.md` MemGrid block injection (`<!-- MEMGRID:START/END -->`)
  - `.memgrid/README.md` for AI tool discoverability
  - Global Claude Code MCP registration (`~/.claude/settings.json`)
- **`memgrid domains`** CLI command (list/set/unregister)
- **Domain name auto-detection** from package.json, go.mod, Cargo.toml
- **Domain type auto-detection** from project structure
- **OpenClaw server mode**: dynamic agent detection + openclaw-config.json + MIGRATION.md guide
- **Privacy-safe**: zero hardcoded agent names, project names, or workspace paths

### Changed
- `MemoryUnit.meta.status` extended with `candidate` (v0.8)
- `MemoryUnit.meta` extended with `tier` and `lastAccessedAt` (v0.9)
- `SearchOptions` extended with `tiers` filter (v0.9)

### Tests
- 80 tests (68 existing + 12 domain manager tests)

## v0.9.0 — Tiered Storage: Hot/Warm/Cold/Frozen (2026-06-29)

### Added
- **Four-tier memory storage**: hot, warm, cold, frozen — based on access recency + frequency
- **Rebalance engine**: `memgrid rebalance` assigns tiers to all active units
  - hot: usage_count >= 3 AND last accessed within 7 days
  - warm: last accessed within 30 days (default for new units)
  - cold: last accessed 30+ days ago
  - frozen: last accessed 90+ days ago OR cold overflow
- **Cold overflow freezing**: when cold exceeds capacity (max 30% of total, min 100),
  lowest `retention_score` units are frozen
- **retention_score**: weighted by confidence, usage_count, type importance, and associations
- **Frozen recovery**: `memgrid search-frozen` for clue-based recall, `memgrid thaw` to restore
- **Tier-aware search ranking**: hot ×1.0, warm ×0.7, cold ×0.4, frozen excluded by default
- **`memgrid search --tier`** filter + `memgrid stats` tier distribution
- **Auto-rebalance**: `memgrid sync` triggers rebalance when files change
- **MCP tools**: `memgrid_rebalance`, `memgrid_search_frozen`, `memgrid_thaw`

### Changed
- All scanners now set `tier: 'warm'` on new units
- `FileStore.touch()` now updates `lastAccessedAt`
- `MemoryUnit.meta` extended with `tier` and `lastAccessedAt` fields

### Tests
- 68 tests (63 existing + 5 tier tests: promote, demote, freeze overflow, thaw, searchFrozen)

## v0.8.0 — Write Gating + Provenance + Conflict Detection (2026-06-29)

### Added
- **Candidate review workflow**: AI-generated memories now enter `candidate` status — not searchable until confirmed
- **`memgrid review`** CLI command (list/accept/reject/accept-all/reject-all)
- **`memgrid_review`** MCP tool — agents present candidates to users in-conversation
- **Provenance tracking**: `createdBy`, `basedOnTask`, `evidenceUnits`, `timestamp` on every MemoryUnit
- **Conflict detection**: `memgrid conflicts` CLI + `memgrid_conflicts` MCP tool
  - Detects same-type units with high keyword overlap + opposing semantics
  - Heuristics: negation words, "prefer X > Y" patterns, contrasting preferences
- **Hook failure visibility**: sync events logged to `.claude/memory-grid/sync.log`
  - `SYNC_START/SUCCESS/FAILURE` entries with timestamps and hostname
  - Failed syncs now emit visible warnings instead of silent `2>/dev/null || true`

### Changed
- `memgrid_add` and `memgrid_suggest` default to creating `candidate` units
- `memgrid search` and `listUnits` exclude candidate units (unless `includeCandidate: true`)
- `memgrid stats` now shows candidate count separately
- `memgrid sync` output includes candidate count with review hint
- Hook commands (`PostCompletion`, `post-commit`) replaced with structured logging

### Tests
- 63 tests (55 existing + 8 new: 6 candidate workflow + 2 conflict detection)

## v0.7.1 — README Rewrite + Chinese Docs (2026-06-29)

### Changed
- **README overhaul**: AI-native setup flow — tell your agent one sentence, no manual config
- Integration section focused on Claude Code (auto MCP + hooks + CLAUDE.md)
- New `README.zh-CN.md` — full Chinese translation
- Badge row added (npm version, downloads, license)

## v0.7.0 — NLP Learning + Perf Benchmarks + Test Expansion (2026-06-28 → 2026-06-29)

### Added
- **NLP natural language learning** (`memgrid learn`): describe a pattern in plain English, MemGrid auto-detects type and creates the unit (#17)
- **4 performance benchmarks** with contract thresholds: load, search, bulk-save, LRU cache (#22)
- **perf-check CI** — automated benchmark validation in CI pipeline (#21)
- Sync phase unit tests + NLP tests + perf CI integration (#21)

### Changed
- ESLint reduced to **0 warnings** across entire codebase (#18)
- Test suite expanded: 51 → 55 tests across 8 files

### Fixed
- repository.url format for npm Trusted Publishing compatibility (#19)

### Removed
- Failing auto-publish GitHub Actions workflow (#20)

## v0.6.0 — Cognitive Sync Pipeline + Learning Engine (2026-06-28)

### Added
- **Phase 6: Learning engine** — sync auto-creates memory units from detected patterns
  - Patterns -> error_solution/pattern/decision units (confidence-gated)
  - Alerts -> error_solution units for architecture violations
  - Changed files -> +0.05 confidence boost to existing units
- **memgrid_suggest MCP tool** — now calls LearnEngine.analyze + applySuggestions
  - Auto-applies high-confidence suggestions
  - Returns formatted suggestions + applied list

### Changed
- Sync CLI output: shows auto-learned unit count
- SyncResult: new autoLearnedUnits field

## v0.5.4 — Duplicate Rule Fix (2026-06-28)

### Fixed
- **TypeScriptScanner**: removed internal scanRules() (-88 lines), delegates to shared RulesScanner
- Eliminates duplicate rule_trigger units (was generated by both TypeScriptScanner and RulesScanner)
- Real-world test: 184 → 134 units (-27%)

## v0.5.3 — Token Optimization (2026-06-28)

### Changed
- **RulesScanner**: remove pattern units, keep only rule_trigger (reduces redundancy)
- **MarkdownScanner**: exclude README/CHANGELOG/CONTRIBUTING/LICENSE/CODE_OF_CONDUCT
- **TypeScriptScanner**: skip migrations/, Controller methods don't store code_snippet
- code_snippet truncated to 15 lines, description 500→200 characters
- pattern unit weight in search ranking: ×1.0 → ×0.8

### Perf
- Token consumption reduced ~40% (67K → ~55K total, top-10 from 10K → ~6K)

## v0.5.2 — Auto-Sync Hooks (2026-06-28)

### Added
- `memgrid init` auto-configures memory sync hooks:
  - **Claude Code PostCompletion** → runs `memgrid sync` after each task
  - **Git post-commit** → runs `memgrid sync` after each commit
  - All injections are non-destructive (merges with existing config)

### Changed
- README: added Auto-Sync Hooks section + CLAUDE.md integration template

## v0.5.1 — Search Bug Fix (2026-06-28)

### Fixed
- `memgrid search` returning empty results after fresh init
  - Root cause: ES2022 `#private` fields broke internal cache access
  - Fix: `listUnitsSync()` public method replaces direct private field access
  - Also added `store.load()` to `search()`, `sync()`, `stats()` entry points

## v0.5.0 — Multi-Language + Incremental Sync (2026-06-28)

### Added — Language-Agnostic Scanner Architecture
- `Scanner` interface: `name`, `scan()`, `scanFiles?()`, `detect()`
- `CompositeScanner`: auto-detects and composes multiple language scanners
- **TypeScript** — `ts-morph` AST (classes, methods, exported functions, call graph associations)
- **JavaScript** — regex (exported functions, classes, arrow functions)
- **Python** — regex (functions, classes, decorators, docstrings)
- **Go** — regex (functions, methods, structs, interfaces)
- **Rust** — regex (functions, structs, enums, traits, impl blocks)
- **Markdown** — headings as knowledge units from any `.md` file
- **Rules** — `.claude/rules/*.md` → pattern + trigger units (universal, extracted from TS scanner)
- **Config** — `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `docker-compose.yml` (universal)

### Added — Incremental Sync
- `memgrid sync` CLI command for incremental re-scan after code changes
- `mg.sync()` API: hash-based file diff against baseline snapshot
- File snapshots stored in `mesh.json.fileSnapshot` (SHA-256 per scanned file)
- Fuzzy match repair: Jaccard + Dice similarity for fixing broken associations
- Stale detection: marks orphaned units when source files are deleted
- Fast path: 0 changes detected in ~5ms (hash compare only)

### Changed
- `mg.init()` now records initial file snapshot for future syncs
- `MemoryGrid` type extended with optional `fileSnapshot`

### Performance
| Scenario | Time |
|----------|------|
| Sync 0 changes | ~5ms |
| Sync 1 file | ~2s |
| Sync 5 files (typical PR) | ~2-3s |
| Full init (150 units) | ~10s |

## v0.4.0 — Hybrid Semantic Search (2026-06-27)

### Added
- Hybrid search: combines MiniSearch (keyword) with semantic similarity
- Configurable `semanticWeight` (0.0 = pure keyword, 1.0 = pure semantic)
- Keyword embedding provider built-in (no external API required)
- `--semantic` flag on CLI search command

### Performance
- 10 searches: 670ms → 3ms (223x improvement)
- Repeated queries: 0ms (LRU cache)
- Disk reload: 45ms → 5ms (9x, switched from YAML to JSON)

## v0.3.0 — Auto-Learning Engine (2026-06-27)

### Added
- Post-task analysis: `mg.analyzeTask()` detects new methods, patterns, errors, decisions
- `mg.applySuggestions()` writes learning results back to grid
- `mg.formatSuggestions()` renders diff for human review
- Learning suggestion types: `add`, `archive`, `update_confidence`

### Changed
- Memory unit meta fields: `confidence` (0.0-1.0) and `status` (active/stale/archived)

## v0.2.0 — MCP Server + Tests (2026-06-26)

### Added
- Full MCP (Model Context Protocol) server via `memgrid serve`
- MCP tools: `memgrid_search`, `memgrid_context`
- Test suite with Vitest
- Integration test with existing project

## v0.1.0 — Core Engine (2026-06-26)

### Added
- TypeScript AST scanning with `ts-morph`: extracts methods, classes, exported functions
- Rule extraction from `.claude/rules/*.md` (sections → pattern/trigger units)
- Example extraction from `.claude/examples/` (good/bad patterns)
- Config extraction from `package.json`, `docker-compose.yml`
- Association graph building (call graph, pattern matching)
- CLI: `init`, `search`, `add`, `stats`
- File-based storage in `.claude/memory-grid/`

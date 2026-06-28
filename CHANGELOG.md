# Changelog

All notable changes to MemGrid.

## v0.5.0 — Incremental Sync Engine (2026-06-28)

### Added
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
- Septonir project integration test

## v0.1.0 — Core Engine (2026-06-26)

### Added
- TypeScript AST scanning with `ts-morph`: extracts methods, classes, exported functions
- Rule extraction from `.claude/rules/*.md` (sections → pattern/trigger units)
- Example extraction from `.claude/examples/` (good/bad patterns)
- Config extraction from `package.json`, `docker-compose.yml`
- Association graph building (call graph, pattern matching)
- CLI: `init`, `search`, `add`, `stats`
- File-based storage in `.claude/memory-grid/`

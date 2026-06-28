# Contributing to MemGrid

## Branch Strategy

- `main` — protected, no direct commits
- All changes go through feature branches and PRs
- Branch naming: `feat/description`, `fix/description`, `chore/description`, `docs/description`
- Squash merge to `main` (clean history)
- Delete feature branch after merge

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Python scanner support
fix: handle empty rules directory
docs: update API reference
chore: upgrade dependencies
refactor: extract ConfigScanner from TypeScriptScanner
ci: add GitHub Actions CI pipeline
test: add sync engine integration tests
```

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Compile TypeScript
pnpm dev            # Watch mode
pnpm typecheck      # Type check only
pnpm test           # Run tests
pnpm test:watch     # Watch tests
pnpm lint           # ESLint
pnpm format         # Prettier format
pnpm format:check   # Check formatting
pnpm cli -- help    # Run CLI locally
```

## Adding a New Scanner

1. Create `src/scanner/yourlang.ts`
2. Implement the `Scanner` interface (`name`, `detect()`, `scan()`)
3. Register in `src/scanner/index.ts`
4. Add auto-detection in `src/serve/cli.ts`
5. Add language-specific config to `ConfigScanner` if applicable
6. Add tests: create a fixture project and verify extracted units

Scanner interface:

```typescript
export interface Scanner {
  readonly name: string;
  scan(options: ScanOptions): Promise<MemoryUnit[]>;
  scanFiles?(files: string[], options: ScanOptions): Promise<MemoryUnit[]>;
  detect(projectRoot: string): boolean;
}
```

## Testing

```bash
pnpm test
```

Tests live in `tests/`. Each test file focuses on a specific module
(store, retrieve, semantic, learn). Scanners are tested by running
`memgrid init` against fixture projects.

## Release Process

1. Update `CHANGELOG.md`
2. Update version in `package.json`
3. Commit: `chore: bump version to x.y.z`
4. Tag: `git tag -a vx.y.z -m "vx.y.z"`
5. Push: `git push origin main && git push origin vx.y.z`
6. GitHub Actions will auto-publish to npm via Trusted Publishing

#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemGrid } from '../memgrid.js';
import {
  TypeScriptScanner,
  JavaScriptScanner,
  PythonScanner,
  GoScanner,
  RustScanner,
  MarkdownScanner,
  RulesScanner,
  ConfigScanner,
} from '../scanner/index.js';
import { startMCPServer } from './mcp-server.js';
import { injectHooks } from '../hooks.js';
import { parseMemoryInput, createMemoryUnit } from '../learn/nlp.js';
import { DomainManager } from '../domain/domain-manager.js';
import { LibraryManager } from '../library/index.js';
import type { MemoryUnit, MemoryUnitType, MemoryTier, LibraryUnit } from '../shared/types.js';

const program = new Command();

program
  .name('memgrid')
  .description('Project-level semantic memory for AI coding agents')
  .version(readPackageVersion());

program
  .command('init')
  .description('Initialize MemGrid — user grid, project domain, or server mode')
  .option('-d, --domain <name>', 'Domain name (auto-detected from project if omitted)')
  .option(
    '-t, --type <type>',
    'Domain type: project, server, toolkit, personality, agent-session, gateway, custom',
  )
  .option('-f, --force', 'Force re-scan even if grid exists')
  .option('--no-rules', 'Skip scanning .claude/rules/')
  .option('--no-examples', 'Skip scanning .claude/examples/')
  .option('--openclaw', 'Initialize in OpenClaw server mode')
  .option('--server', '[deprecated] Use --openclaw instead')
  .option('--lang <lang>', 'Language environment: en (default) or zh')
  .action(async (options) => {
    const root = process.cwd();
    const dm = new DomainManager();

    // === Mode 3: OpenClaw Server ===
    const isOpenClaw = options.openclaw || options.server;
    if (options.server && !options.openclaw) {
      console.log('⚠️  --server is deprecated. Use --openclaw instead.');
    }
    if (isOpenClaw) {
      console.log('🖥️  OpenClaw Server — MemGrid — OpenClaw Server Mode\n');

      // Init user grid
      const gridResult = dm.initUserGrid();
      console.log(gridResult.created ? '🧠 User grid created' : '🧠 User grid already exists');
      console.log(`   ${dm.gridDir}\n`);

      // Create personality domain
      const personalityPath = path.join(dm.gridDir, 'personality');
      if (!fs.existsSync(personalityPath)) fs.mkdirSync(personalityPath, { recursive: true });

      // Create session domains for agents detected from OpenClaw config
      const agents = detectOpenClawAgents(root);
      const configDomains: Record<string, Record<string, unknown>> = {};

      if (agents.length === 0) {
        console.log(
          '  ⚠️  No agents detected. Use --openclaw-path <path> or create session domains manually.',
        );
        console.log('     Example: memgrid init --openclaw --domain my-agent');
      } else {
        for (const agent of agents) {
          const sessionPath = path.join(dm.gridDir, 'sessions', agent.name);
          fs.mkdirSync(sessionPath, { recursive: true });

          // Create docs/ directory for structured source documents
          const docsDir = path.join(sessionPath, 'docs');
          fs.mkdirSync(docsDir, { recursive: true });

          // Pre-create units/ and archive/ directly under sessionPath
          // so FileStore recognizes it as a grid root (no .memgrid/ nesting)
          fs.mkdirSync(path.join(sessionPath, 'units'), { recursive: true });
          fs.mkdirSync(path.join(sessionPath, 'archive'), { recursive: true });

          // Init MemGrid domain for this agent
          const mg = new MemGrid(sessionPath);
          mg.store.ensureDirs();
          mg.store.load();

          dm.registerDomain({
            name: agent.name,
            type: 'agent-session',
            path: sessionPath,
            description: agent.description || `${agent.name} conversation memory domain`,
            enabled: true,
          });

          // Store agent metadata in session domain
          const agentMetaPath = path.join(sessionPath, 'agent.json');
          fs.writeFileSync(
            agentMetaPath,
            JSON.stringify(
              {
                name: agent.name,
                description: agent.description || '',
                purpose: agent.purpose || '',
                type: 'agent-session',
                createdAt: new Date().toISOString(),
              },
              null,
              2,
            ),
            'utf-8',
          );

          configDomains[agent.name] = { type: 'agent-session', enabled: true };
          console.log(
            `  ✅ ${agent.name} session domain (${agent.purpose || 'no purpose configured'})`,
          );

          // Inject MemGrid block into AGENTS.md
          if (agent.workspaceDir) {
            const agentsMdPath = path.join(agent.workspaceDir, 'AGENTS.md');
            if (fs.existsSync(agentsMdPath)) {
              injectMemGridAgentsBlock(agentsMdPath, agent.name);

              // Ingest existing preferences/rules from AGENTS.md into memory
              const sessionDir = path.join(dm.gridDir, 'sessions', agent.name);
              const ingestResult = ingestRulesFromDoc(agentsMdPath, agent.name, sessionDir);
              if (ingestResult.ingested > 0) {
                console.log(`     📋 Ingested ${ingestResult.ingested} rule(s) from AGENTS.md`);
              }
            }
          }
        }

        // Auto-migrate existing OpenClaw memories into MemGrid
        const migResult = migrateExistingMemories(dm);
        if (migResult.total > 0) {
          console.log(`\n  📋 Auto-migrated ${migResult.total} existing memories:`);
          console.log(`     → ${migResult.memoryUnits} memory unit(s)`);
          console.log(`     → ${migResult.libraryDocs} library document(s)`);
          if (migResult.skipped > 0) {
            console.log(`     → ${migResult.skipped} file(s) skipped (already migrated)`);
          }
          console.log(`     📁 Original files preserved (not deleted)`);
        }
      }

      // Inject metacognitive anchor memory for each agent domain
      const lang = options.lang === 'zh' ? 'zh' : 'en';
      for (const agent of agents) {
        const sessionDir = path.join(dm.gridDir, 'sessions', agent.name);
        injectMetacognitiveAnchor(sessionDir, lang);
      }

      // Migrate data from old nested paths (pre-v0.10.4 bug) to correct locations
      migrateNestedPaths(dm);

      // Generate OpenClaw Gateway config (always in server mode)
      {
        const configPath = path.join(dm.gridDir, 'openclaw-config.json');
        const config = {
          memoryProvider: 'memgrid',
          enabled: true,
          gridPath: dm.gridDir,
          domains: configDomains,
          autoSync: true,
          reviewGate: true,
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`  ✅ OpenClaw config: ${configPath}`);
        console.log('  → Restart OpenClaw Gateway to activate');

        // Auto-register MemGrid MCP in OpenClaw Gateway config
        // root is the working directory — could be ~/.openclaw/ or a workspace-* subdir
        const rootDir = path.resolve(root);
        let openclawDir = rootDir;
        // If inside workspace-* or sessions/ etc, go to ~/.openclaw/
        if (
          path.basename(openclawDir).startsWith('workspace-') ||
          !fs.existsSync(path.join(openclawDir, 'openclaw.json'))
        ) {
          // Try parent, and keep going until we find openclaw.json or root
          let dir = rootDir;
          while (dir !== path.dirname(dir)) {
            if (fs.existsSync(path.join(dir, 'openclaw.json'))) {
              openclawDir = dir;
              break;
            }
            dir = path.dirname(dir);
          }
        }
        const openclawJsonPath = path.join(openclawDir, 'openclaw.json');
        // Pass the first agent's session domain as the MCP serve target
        const firstAgentSessionPath =
          agents.length > 0 ? path.join(dm.gridDir, 'sessions', agents[0].name) : undefined;
        registerOpenClawMcp(openclawJsonPath, firstAgentSessionPath);

        // Auto-register MemGrid auto-memory plugin in OpenClaw
        registerMemGridPlugin(openclawJsonPath);
      }

      console.log('\n✅ Server initialization complete.');
      return;
    }

    // === Mode 1: User Grid Init (not in a project) ===
    const isProject =
      fs.existsSync(path.join(root, 'package.json')) ||
      fs.existsSync(path.join(root, 'pyproject.toml')) ||
      fs.existsSync(path.join(root, 'go.mod')) ||
      fs.existsSync(path.join(root, 'Cargo.toml')) ||
      options.domain;

    if (!isProject) {
      const gridResult = dm.initUserGrid();
      if (!gridResult.created) {
        console.log('🧠 User grid already exists at', gridResult.path);
        console.log('   Use --force to reinitialize, or cd to a project and run memgrid init');
        return;
      }

      console.log('🧠 MemGrid v1.0\n');
      console.log('   ~/.memgrid/           ← Your cognitive grid');
      console.log('     mesh.json            ← Grid map');
      console.log('     personality/         ← Your master personality domain');
      console.log('     sessions/            ← Agent conversation domains');
      console.log('');

      // Register global Claude Code MCP
      registerGlobalMcp(dm.gridDir);

      console.log('✅ User grid initialized.');
      console.log('   Next: cd to a project and run memgrid init');
      console.log('   Example: cd ~/my-project && memgrid init');
      return;
    }

    // === Mode 2: Project Domain Init ===
    const domainName = options.domain || DomainManager.detectDomainName(root);
    const domainType = options.type || DomainManager.detectDomainType(root) || 'project';
    const domainPath = path.join(root, '.memgrid');

    console.log(`📦 Project domain: ${domainName} (${domainType})`);
    console.log(`   ${domainPath}\n`);

    // Create domain directory structure
    fs.mkdirSync(domainPath, { recursive: true });
    fs.mkdirSync(path.join(domainPath, 'units'), { recursive: true });
    fs.mkdirSync(path.join(domainPath, 'personal'), { recursive: true });
    fs.mkdirSync(path.join(domainPath, 'index'), { recursive: true });

    // Auto-detect scanners
    const languageScanners = [
      { name: 'typescript', factory: () => new TypeScriptScanner(null as any, root) },
      { name: 'javascript', factory: () => new JavaScriptScanner(null as any, root) },
      { name: 'python', factory: () => new PythonScanner(null as any, root) },
      { name: 'golang', factory: () => new GoScanner(null as any, root) },
      { name: 'rust', factory: () => new RustScanner(null as any, root) },
    ];

    const detected: string[] = [];
    for (const ls of languageScanners) {
      if (ls.factory().detect(root)) detected.push(ls.name);
    }
    if (new MarkdownScanner(root).detect(root)) detected.push('markdown');
    if (options.rules !== false && new RulesScanner(root).detect(root)) detected.push('rules');
    if (new ConfigScanner(root).detect(root)) detected.push('config');

    const mg = new MemGrid(root);
    console.log(`🔍 Scanning project (${detected.join(', ') || 'typescript'})...\n`);

    await mg.init({
      projectRoot: root,
      includeRules: options.rules !== false,
      includeExamples: options.examples !== false,
      force: options.force || false,
    });

    const stats = await mg.stats();
    console.log('📊 Scan complete!\n');
    console.log('Units generated:');
    for (const [type, count] of Object.entries(stats.typeDistribution)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log(`\n  Total: ${stats.totalUnits} units`);
    console.log(`  Storage: .memgrid/`);

    // Auto-configure gitignore
    const gitignore = path.join(root, '.gitignore');
    const personalIgnore = '.memgrid/personal/';
    let needsGitignore = true;
    if (fs.existsSync(gitignore)) {
      const content = fs.readFileSync(gitignore, 'utf-8');
      needsGitignore = !content.includes(personalIgnore);
    }
    if (needsGitignore) {
      fs.appendFileSync(
        gitignore,
        `\n# MemGrid personal memory (not shared)\n${personalIgnore}\n`,
        'utf-8',
      );
      console.log('\n📝 .gitignore: personal memory excluded');
    }

    // Auto-configure Claude Code
    const claudeSettingsDir = path.join(root, '.claude');
    fs.mkdirSync(claudeSettingsDir, { recursive: true });

    // MCP + Hook via settings.json
    const hookResult = injectHooks(root);
    if (hookResult.actions.length > 0) {
      console.log('\n🔗 Claude Code integration:');
      if (hookResult.actions.includes('claude-post-completion')) {
        const status = hookResult.details.claudeSettings === 'created' ? 'created' : 'merged';
        console.log(`  .claude/settings.json: ${status} — auto-sync hooks`);
      }
      if (hookResult.actions.includes('git-post-commit')) {
        console.log('  post-commit hook: created');
      }
    }

    // Inject CLAUDE.md block
    injectClaudeMdBlock(root, domainName);

    // Ingest existing rules from CLAUDE.md into memory domain
    const claudeMdPath = path.join(root, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      const ingestResult = ingestRulesFromDoc(claudeMdPath, domainName, domainPath);
      if (ingestResult.ingested > 0) {
        console.log(`  📋 Ingested ${ingestResult.ingested} rule(s) from CLAUDE.md`);
      }
    }

    // Create domain README for other AI tools
    const readmePath = path.join(domainPath, 'README.md');
    fs.writeFileSync(readmePath, generateDomainReadme(domainName), 'utf-8');
    console.log('  .memgrid/README.md: created — guidance for AI tools');

    // Register domain in user grid
    dm.registerDomain({
      name: domainName,
      type: domainType as any,
      path: domainPath,
      description: `${domainName} project memory domain`,
      enabled: true,
    });
    console.log(`\n🧠 Domain registered in your cognitive grid (~/.memgrid/)`);

    // Run initial rebalance
    await mg.rebalance();

    console.log('\n✅ Project domain initialized. Ready.');
    console.log('   memgrid search "your task"  —  search domain memory');
    console.log('   memgrid review              —  review candidate memories');
    console.log('   memgrid stats               —  domain statistics');
  });

program
  .command('sync')
  .description('Incremental sync — re-scan only changed files (fast, for CI/CD or post-git-pull)')
  .option('--no-rules', 'Skip scanning .claude/rules/')
  .option('--no-examples', 'Skip scanning .claude/examples/')
  .option('-t, --threshold <number>', 'Fuzzy match threshold (0.0-1.0)', '0.45')
  .action(async (options) => {
    const mg = new MemGrid(process.cwd());
    console.log('🔄 Syncing (incremental)...\n');

    const result = await mg.sync({
      projectRoot: process.cwd(),
      includeRules: options.rules !== false,
      includeExamples: options.examples !== false,
      fuzzyThreshold: parseFloat(options.threshold),
    });

    if (result.changedFiles.length === 0 && result.removedFiles.length === 0) {
      console.log('✅ No changes detected — grid is up to date');
      return;
    }

    console.log(`📁 Changed files:  ${result.changedFiles.length}`);
    console.log(`🗑️  Removed files:  ${result.removedFiles.length}`);
    console.log(`📝 Updated units:  ${result.updatedUnits}`);
    console.log(`⚠️  Stale units:    ${result.staleUnits}`);
    console.log(`🔗 Repaired links: ${result.repairedAssociations}`);
    console.log(`💔 Broken links:   ${result.brokenAssociations}`);
    if (result.newAssociations > 0) {
      console.log(`🆕 New associations: ${result.newAssociations}`);
    }
    if (result.detectedPatterns.length > 0) {
      console.log(`\n🧠 Patterns detected:`);
      for (const p of result.detectedPatterns) {
        console.log(
          `  ${p.type === 'insight' ? '💡' : p.type === 'event' ? '📋' : '📋'} ${p.summary} (${p.file})`,
        );
      }
    }
    if (result.alerts.length > 0) {
      console.log(`\n⚠️  Alerts:`);
      for (const a of result.alerts) {
        const icon = a.level === 'error' ? '🚫' : '⚠️';
        console.log(`  ${icon} ${a.message}`);
        console.log(`     → ${a.file}`);
      }
    }
    if (result.autoLearnedUnits > 0) {
      console.log(`\n🧠 Auto-learned: ${result.autoLearnedUnits} new memory unit(s)`);
    }
    if (result.candidateUnitsCreated > 0) {
      console.log(`📝 Candidates:    ${result.candidateUnitsCreated} unit(s) pending review`);
      console.log(`   Run 'memgrid review' to confirm or reject them.`);
    }
    console.log(`\n⏱️  Done in ${result.elapsedMs}ms`);
  });

program
  .command('search')
  .description('Search memory grid for relevant units (hybrid: keyword + semantic)')
  .argument('<query>', 'Search query')
  .option('-n, --max <number>', 'Max results', '10')
  .option('-H, --hops <number>', 'Max association hops', '2')
  .option('-s, --semantic <number>', 'Semantic weight (0.0-1.0, default: 0.4)', '0.4')
  .option(
    '-t, --tier <tiers>',
    'Limit to tiers: hot,warm,cold or all (default: hot,warm,cold)',
    'hot,warm,cold',
  )
  .action(async (query, options) => {
    const tierMap: Record<string, string[]> = {
      all: ['hot', 'warm', 'cold', 'frozen'],
    };
    const tierStr: string = options.tier;
    const tiers = tierMap[tierStr] || tierStr.split(',').map((s: string) => s.trim());

    const mg = new MemGrid(process.cwd());
    const result = await mg.search(query, {
      maxResults: parseInt(options.max),
      maxHops: parseInt(options.hops),
      semanticWeight: parseFloat(options.semantic),
      tiers: tiers as any,
    });

    console.log(mg.context(result));
  });

program
  .command('add')
  .description('Add a memory unit manually')
  .requiredOption('-t, --type <type>', 'Unit type')
  .requiredOption('-s, --summary <summary>', 'One-line summary')
  .requiredOption('-d, --description <desc>', 'Description')
  .option('-f, --file <file>', 'Source file path')
  .option('-l, --lines <lines>', 'Source line range')
  .action(async (options) => {
    const mg = new MemGrid(process.cwd());
    const id = `${options.type}_manual_${Date.now()}`;
    const unit = await mg.add({
      id,
      type: options.type as any,
      summary: options.summary,
      narrative: options.description || options.summary,
      keywords: [],
      source: options.file ? { file: options.file, lines: options.lines } : undefined,
    });

    console.log(`✅ Added: ${unit.id}`);
  });

program
  .command('learn')
  .description('Learn from a natural language description — auto-creates memory units')
  .argument('<input...>', 'Free-form description of what you learned (error, decision, pattern)')
  .option('-f, --file <file>', 'Source file path (optional)')
  .action(async (input, options) => {
    const text = input.join(' ');
    const parsed = parseMemoryInput(text, options.file);
    const unit = createMemoryUnit(parsed, options.file);

    const mg = new MemGrid(process.cwd());
    await mg.add(unit);

    console.log(`🧠 Learned: [${parsed.type}] ${parsed.summary.slice(0, 60)}`);
    console.log(`   id: ${unit.id}`);
    if (parsed.keywords.length > 0) console.log(`   keywords: ${parsed.keywords.join(', ')}`);
    console.log(`   confidence: ${parsed.confidence}`);
  });

program
  .command('review')
  .description('Review and confirm or reject candidate memory units')
  .option('-l, --list', 'List all candidate units pending review')
  .option('-a, --accept <id>', 'Accept a specific candidate unit')
  .option('-r, --reject <id>', 'Reject and archive a specific candidate unit')
  .option('--accept-all', 'Accept all candidate units')
  .option('--reject-all', 'Reject all candidate units')
  .action(async (options) => {
    const mg = new MemGrid(process.cwd());
    mg.store.load();
    const allUnits = mg.store.listUnitsSync({ includeCandidate: true }) || [];
    const candidates = allUnits.filter((u) => u.meta.status === 'candidate');

    if (
      options.list ||
      (!options.accept && !options.reject && !options.acceptAll && !options.rejectAll)
    ) {
      if (candidates.length === 0) {
        console.log('✅ No candidate memories pending review.');
        return;
      }
      console.log(`📋 ${candidates.length} candidate memory unit(s) pending review:\n`);
      for (const c of candidates) {
        const creator = c.provenance?.createdBy || 'unknown';
        const task = c.provenance?.basedOnTask ? ` — ${c.provenance.basedOnTask.slice(0, 60)}` : '';
        console.log(`  [${c.id}] ${c.type} | ${c.summary.slice(0, 80)}`);
        console.log(`      ⚡ ${c.meta.confidence} | from: ${creator}${task}`);
      }
      console.log('');
      console.log('Use --accept <id> / --reject <id> to confirm or reject.');
      console.log('Use --accept-all / --reject-all to handle all at once.');
      return;
    }

    if (options.accept) {
      const result = await mg.acceptCandidate(options.accept);
      if (result) {
        console.log(`✅ Accepted: [${result.id}] ${result.summary.slice(0, 80)}`);
        console.log('   Now searchable as active.');
      } else {
        console.log(`❌ Unit not found or not a candidate: ${options.accept}`);
      }
    }

    if (options.reject) {
      const unit = mg.store.getUnit(options.reject);
      if (unit && unit.meta.status === 'candidate') {
        await mg.archive(options.reject);
        console.log(`🗑️  Rejected: [${options.reject}] ${unit.summary.slice(0, 80)}`);
        console.log('   Archived (not searchable).');
      } else {
        console.log(`❌ Unit not found or not a candidate: ${options.reject}`);
      }
    }

    if (options.acceptAll) {
      let count = 0;
      for (const c of candidates) {
        await mg.acceptCandidate(c.id);
        count++;
      }
      console.log(`✅ Accepted all ${count} candidate unit(s). Now searchable.`);
    }

    if (options.rejectAll) {
      let count = 0;
      for (const c of candidates) {
        await mg.archive(c.id);
        count++;
      }
      console.log(`🗑️  Rejected all ${count} candidate unit(s). Archived.`);
    }
  });

program
  .command('conflicts')
  .description(
    'Detect potentially conflicting memory units (same type, high overlap, opposing meaning)',
  )
  .action(async () => {
    const mg = new MemGrid(process.cwd());
    const conflicts = mg.detectConflicts();

    if (conflicts.length === 0) {
      console.log('✅ No conflicting memory units detected.');
      return;
    }

    console.log(`⚠️  ${conflicts.length} potential conflict(s) detected:\n`);
    for (const c of conflicts) {
      const icon = c.hasOpposition ? '🔴' : '🟡';
      console.log(`${icon} [${c.unitA.type}] overlap=${c.overlapScore.toFixed(2)}`);
      console.log(`   A: ${c.unitA.summary.slice(0, 80)}`);
      console.log(`   B: ${c.unitB.summary.slice(0, 80)}`);
      if (c.hasOpposition) {
        console.log(`   ⚠️  These appear to express opposing views.`);
      }
      console.log(`   IDs: ${c.unitA.id} | ${c.unitB.id}`);
      console.log(`   Resolve: memgrid archive <id> to remove one, or keep both if complementary.`);
      console.log('');
    }
  });

program
  .command('undo')
  .description('Restore a memory unit from the latest backup (restored as candidate)')
  .argument('[id]', 'Unit ID to restore. Omit to list all available backups.')
  .option('-l, --list', 'List all available backup snapshots')
  .action(async (id, options) => {
    const mg = new MemGrid(process.cwd());

    if (options.list || !id) {
      const backups = await mg.listUndo();
      if (backups.length === 0) {
        console.log('📭 No backups available.');
        return;
      }
      console.log(`📦 ${backups.length} backup(s) available:\n`);
      for (const b of backups) {
        const opIcons: Record<string, string> = {
          insert: '➕',
          update: '✏️',
          delete: '🗑️',
          archive: '📦',
        };
        console.log(`  ${opIcons[b.operation] || '❓'} ${b.unitId}`);
        console.log(`     ${b.operation} at ${b.backupTime}`);
      }
      console.log(`\n  Restore: memgrid undo <unitId>`);
      return;
    }

    const restored = await mg.undo(id);
    if (restored) {
      console.log(`✅ Restored: [${restored.id}] ${restored.summary.slice(0, 80)}`);
      console.log('   Status: candidate (review required before searchable)');
      console.log('   Run: memgrid review --accept ' + restored.id + '  to confirm');
    } else {
      console.log(`❌ No backup found for: ${id}`);
    }
  });

program
  .command('rebalance')
  .description('Rebalance memory units across hot/warm/cold/frozen tiers')
  .action(async () => {
    const mg = new MemGrid(process.cwd());
    console.log('⚖️  Rebalancing memory tiers...\n');
    const result = await mg.rebalance();

    console.log(`  📊 Hot:    ${result.hot}`);
    console.log(`  🌤️  Warm:   ${result.warm}`);
    console.log(`  ❄️  Cold:   ${result.cold}`);
    console.log(`  🧊 Frozen:  ${result.frozen}`);
    console.log(`  🔼 Promoted:  ${result.promoted}`);
    console.log(`  🔽 Demoted:   ${result.demoted}`);
    if (result.frozenCount > 0) {
      console.log(`  💤 Newly frozen: ${result.frozenCount} unit(s)`);
      console.log(
        `     These are not searchable by default. Use 'memgrid search-frozen <clue>' to find them.`,
      );
    }
    console.log('\n✅ Rebalance complete.');
  });

program
  .command('thaw')
  .description('Thaw a frozen memory unit back to warm tier')
  .argument('<id>', 'Unit ID to thaw')
  .action(async (id) => {
    const mg = new MemGrid(process.cwd());
    const unit = await mg.thaw(id);
    if (unit) {
      console.log(`🔥 Thawed: [${unit.id}] ${unit.summary.slice(0, 80)}`);
      console.log('   Back to warm tier — now searchable.');
    } else {
      console.log(`❌ Unit not found or not frozen: ${id}`);
    }
  });

program
  .command('search-frozen')
  .description('Search the frozen tier for a specific memory clue')
  .argument('<clue>', 'Keyword, method name, or phrase to search frozen memories')
  .action(async (clue) => {
    const mg = new MemGrid(process.cwd());
    const results = mg.searchFrozen(clue);

    if (results.length === 0) {
      console.log('No frozen memories match this clue.');
      return;
    }

    console.log(`💤 ${results.length} frozen memory unit(s) match "${clue}":\n`);
    for (const unit of results) {
      console.log(`  [${unit.id}] ${unit.type}`);
      console.log(`  ${unit.summary.slice(0, 100)}`);
      if (unit.meta.lastAccessedAt) {
        console.log(`  Last access: ${unit.meta.lastAccessedAt}`);
      }
      console.log(`  → Thaw with: memgrid thaw ${unit.id}`);
      console.log('');
    }
  });

program
  .command('domains')
  .description('Manage memory domains')
  .option('-l, --list', 'List all registered domains')
  .option('-s, --set <name>', 'Set active domain')
  .option('--unregister <name>', 'Remove a domain from the grid (does not delete files)')
  .action(async (options) => {
    const dm = new DomainManager();

    if (options.unregister) {
      const ok = dm.unregisterDomain(options.unregister);
      console.log(
        ok
          ? `🗑️  Domain removed: ${options.unregister}`
          : `❌ Domain not found: ${options.unregister}`,
      );
      return;
    }

    if (options.list || (!options.set && !options.unregister)) {
      dm.initUserGrid(); // ensure grid exists
      const domains = dm.listDomains();
      if (domains.length === 0) {
        console.log('No domains registered. Run memgrid init to get started.');
        return;
      }
      console.log('📂 Memory Domains:\n');
      for (const d of domains) {
        const icon: Record<string, string> = {
          personality: '🧠',
          project: '📦',
          server: '🖥️',
          toolkit: '🧰',
          'agent-session': '💬',
          gateway: '🔌',
          custom: '📁',
        };
        console.log(`  ${icon[d.type || ''] || '📁'} ${d.name}  [${d.type || 'custom'}]`);
        console.log(`     ${d.path}`);
        console.log(`     ${d.enabled ? '✅ enabled' : '⏸️  disabled'}`);
        if (d.description) console.log(`     ${d.description}`);
        console.log('');
      }
      return;
    }

    if (options.set) {
      console.log(`Domain set to: ${options.set}`);
      console.log('Not yet implemented — use: cd to project directory then memgrid init');
    }
  });

program
  .command('stats')
  .description('Show grid statistics')
  .action(async () => {
    const mg = new MemGrid(process.cwd());
    const stats = await mg.stats();
    console.log('📊 MemGrid Statistics\n');
    console.log(`  Total units:    ${stats.totalUnits}`);
    console.log(`  Active:         ${stats.activeUnits}`);
    console.log(`  Candidate:      ${stats.candidateUnits ?? 0}`);
    console.log(`  Archived:       ${stats.archivedUnits}`);
    console.log(`  Last scan:      ${stats.lastScanAt || 'Never'}`);
    console.log(`\n  Type distribution:`);
    for (const [type, count] of Object.entries(stats.typeDistribution)) {
      console.log(`    ${type}: ${count}`);
    }
    if ((stats.candidateUnits ?? 0) > 0) {
      console.log(
        `\n  ⚠️  ${stats.candidateUnits} candidate unit(s) pending review. Run: memgrid review`,
      );
    }

    if (stats.tierDistribution) {
      console.log(`\n  Tier distribution:`);
      const tierOrder = ['hot', 'warm', 'cold', 'frozen'];
      for (const tier of tierOrder) {
        const count = stats.tierDistribution[tier] || 0;
        if (count > 0) {
          const icons: Record<string, string> = { hot: '🔥', warm: '🌤️', cold: '❄️', frozen: '🧊' };
          console.log(`    ${icons[tier] || ''} ${tier}: ${count}`);
        }
      }
      console.log(`    ⚡ Run 'memgrid rebalance' to update tiers.`);
    }
  });

program
  .command('serve')
  .description('Start MCP Server (stdio transport)')
  .option('-d, --domain <path>', 'Serve a specific domain directory instead of cwd')
  .action(async (options) => {
    const root = options.domain || process.cwd();
    console.error('🚀 MemGrid MCP Server starting...');
    console.error(`   Domain: ${root}`);
    await startMCPServer(root);
  });

// ===== Library Commands =====

program
  .command('library-add')
  .alias('lib-add')
  .description('Add a document to the knowledge library')
  .requiredOption('-t, --title <title>', 'Document title')
  .requiredOption('-d, --domain <domain>', 'Domain name')
  .option('-f, --file <path>', 'Read content from file')
  .option('-c, --content <text>', 'Content text')
  .action(async (options) => {
    const gridDir = path.join(process.cwd(), '.memgrid');
    const lib = new LibraryManager(gridDir);

    let content: string;
    if (options.file) {
      if (!fs.existsSync(options.file)) {
        console.error(`❌ File not found: ${options.file}`);
        process.exit(1);
      }
      content = fs.readFileSync(options.file, 'utf-8');
    } else if (options.content) {
      content = options.content;
    } else {
      // Read from stdin
      content = fs.readFileSync(0, 'utf-8');
    }

    const doc = lib.add({
      title: options.title,
      content,
      domain: options.domain,
      source: options.file ? { file: options.file } : undefined,
    });

    console.log(`📚 Added to library: ${doc.id}`);
    console.log(`   Title: ${doc.title}`);
    console.log(`   Size: ${doc.meta.size} chars`);
    console.log(`   Domain: ${doc.domain}`);
  });

program
  .command('library-search')
  .alias('lib-search')
  .description('Search the knowledge library')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', '10')
  .action(async (query, options) => {
    const gridDir = path.join(process.cwd(), '.memgrid');
    const lib = new LibraryManager(gridDir);

    const results = lib.search(query, parseInt(options.limit));

    if (results.length === 0) {
      console.log('No library documents match this query.');
      return;
    }

    console.log(`📚 ${results.length} result(s) for "${query}":\n`);
    for (const doc of results) {
      console.log(`  [${doc.id}] ${doc.title}`);
      console.log(`  ${doc.content.slice(0, 150).replace(/\n/g, ' ')}...`);
      console.log(
        `  domain: ${doc.domain} | size: ${doc.meta.size}c | used: ${doc.meta.usage_count}×\n`,
      );
    }
  });

program
  .command('library-list')
  .alias('lib-list')
  .description('List all documents in the knowledge library')
  .action(async () => {
    const gridDir = path.join(process.cwd(), '.memgrid');
    const lib = new LibraryManager(gridDir);
    const { totalSize } = lib.stats;

    const docs = lib.list();
    console.log(`📚 ${docs.length} document(s) | ${(totalSize / 1024).toFixed(1)} KB total\n`);
    for (const doc of docs) {
      console.log(`  [${doc.id}] ${doc.title}`);
      console.log(`  domain: ${doc.domain} | ${doc.meta.size}c | ${doc.meta.usage_count}× read\n`);
    }
  });

program
  .command('library-get')
  .alias('lib-get')
  .description('Get full content of a library document')
  .argument('<id>', 'Document ID')
  .action(async (id) => {
    const gridDir = path.join(process.cwd(), '.memgrid');
    const lib = new LibraryManager(gridDir);

    const doc = lib.get(id);
    if (!doc) {
      console.log(`❌ Document not found: ${id}`);
      return;
    }

    console.log(`📚 ${doc.title} [${doc.id}]`);
    console.log(`domain: ${doc.domain} | size: ${doc.meta.size}c\n`);
    console.log(doc.content);
  });

program
  .command('library-remove')
  .alias('lib-rm')
  .description('Remove a document from the knowledge library')
  .argument('<id>', 'Document ID')
  .action(async (id) => {
    const gridDir = path.join(process.cwd(), '.memgrid');
    const lib = new LibraryManager(gridDir);

    if (lib.remove(id)) {
      console.log(`🗑️  Removed: ${id}`);
    } else {
      console.log(`❌ Document not found: ${id}`);
    }
  });

program
  .command('migrate')
  .description(
    'Migrate existing memories into MemGrid: long content → library, update memory units with library_ref',
  )
  .option('-d, --domain <name>', 'Target domain (default: current session domain)')
  .option('--source <path>', 'Source directory to scan for .md files')
  .option('--dry-run', 'Show what would be migrated without writing changes')
  .action(async (options) => {
    const gridDir = path.join(process.cwd(), '.memgrid');
    const lib = new LibraryManager(gridDir);
    const mg = new MemGrid(process.cwd());

    // Determine source: default to current working directory's memory/ folder
    const sourceDir = options.source || path.join(process.cwd(), 'memory');
    if (!fs.existsSync(sourceDir)) {
      console.log(`❌ Source directory not found: ${sourceDir}`);
      return;
    }

    // Find all .md files
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) files.push(full);
      }
    };
    walk(sourceDir);

    let migrated = 0;
    let updated = 0;
    const domain = options.domain || 'default';

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.trim().length === 0) continue;

      const title = path.basename(file, '.md');

      if (content.length > 500) {
        // Long content → library
        const libId = `lib_migrated_${title.replace(/[^a-z0-9_]/g, '_').slice(0, 40)}`;

        if (!options.dryRun) {
          lib.add({
            id: libId,
            title,
            content,
            domain,
            source: { file },
          });

          // Update existing memory units that reference this file
          const allUnits = mg.store.listUnitsSync({ includeCandidate: true }) || [];
          for (const unit of allUnits) {
            if (unit.source?.file?.includes(title) || unit.summary?.includes(title)) {
              unit.library_ref = libId;
              mg.store.saveUnit(unit);
              updated++;
            }
          }
        }

        migrated++;
        console.log(`  📚 → library: ${title} (${content.length}c)`);
      }
    }

    if (options.dryRun) {
      console.log(`\n🔍 Dry run: ${migrated} file(s) would be migrated to library`);
    } else {
      console.log(
        `\n✅ Migrated ${migrated} document(s) to library, ${updated} memory unit(s) updated with library_ref`,
      );
    }
  });

program
  .command('extract')
  .description('Extract memory candidates from text (stdin or --text)')
  .option('-t, --text <text>', 'Text to extract from')
  .option('-d, --domain <name>', 'Domain to assign', 'conversation')
  .option('--save', 'Save candidates as memory units')
  .action(async (options) => {
    const text = options.text || fs.readFileSync(0, 'utf-8');
    const mg = new MemGrid(process.cwd());
    const { raw } = mg.extract.extract(text);

    console.log(`🧠 Extracted ${raw.length} candidate(s):\n`);
    for (const c of raw) {
      console.log(`  [${c.type}] ${c.summary}`);
      console.log(`  confidence: ${c.confidence.toFixed(2)}`);
      console.log(`  keywords: ${c.keywords.join(', ')}`);
      console.log();
    }

    if (options.save && raw.length > 0) {
      let saved = 0;
      for (const c of raw) {
        const unit = mg.extract.toMemoryUnit(c, options.domain);
        mg.store.saveUnit(unit);
        saved++;
      }
      console.log(`✅ Saved ${saved} candidate unit(s). Review with: memgrid review`);
    }
  });

program.parse();

// ===== Helper Functions =====

/** Inject MemGrid block into CLAUDE.md */
function injectClaudeMdBlock(projectRoot: string, domainName: string): void {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  const block = [
    '',
    '<!-- MEMGRID:START -->',
    '',
    '## 🧠 Project Memory (MemGrid)',
    '',
    `This project uses MemGrid for persistent memory. Search before each task.`,
    '',
    `- **Domain:** \`${projectRoot}\``,
    '',
    '### Usage',
    '```bash',
    '# Search before starting work',
    'npx memgrid search "your task" --max 10',
    '',
    '# Sync after code changes',
    'npx memgrid sync',
    '```',
    '',
    `MCP tools: \`memgrid_search\`, \`memgrid_add\`, \`memgrid_extract\`, \`memgrid_review\` — use \`domain="${projectRoot}"\` in all calls.`,
    '',
    '<!-- MEMGRID:END -->',
  ].join('\n');

  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${domainName}\n${block}\n`, 'utf-8');
    console.log('  CLAUDE.md: created with MemGrid instructions');
    return;
  }

  const existing = fs.readFileSync(claudeMdPath, 'utf-8');
  if (existing.includes('<!-- MEMGRID:START -->')) {
    // Update if outdated (missing domain or memgrid_extract)
    if (existing.includes('domain=') && existing.includes('memgrid_extract')) {
      console.log('  CLAUDE.md: MemGrid block already up-to-date');
      return;
    }
    const startIdx = existing.indexOf('<!-- MEMGRID:START -->');
    const endIdx = existing.indexOf('<!-- MEMGRID:END -->');
    if (endIdx > startIdx) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + '<!-- MEMGRID:END -->'.length);
      fs.writeFileSync(claudeMdPath, before + block + after, 'utf-8');
      console.log('  CLAUDE.md: MemGrid block updated (old → new)');
    }
    return;
  }

  fs.appendFileSync(claudeMdPath, block + '\n', 'utf-8');
  console.log('  CLAUDE.md: MemGrid block injected');
}

/**
 * Ingest existing preferences and rules from an agent's doc (AGENTS.md or CLAUDE.md)
 * into MemGrid. Parses sections like "Red Lines", "When Things Go Wrong", "Code Philosophy",
 * "偏好", "规范" and writes them as preference/insight units.
 */
function ingestRulesFromDoc(
  docPath: string,
  domainName: string,
  sessionDir: string,
): { ingested: number } {
  if (!fs.existsSync(docPath)) return { ingested: 0 };

  const content = fs.readFileSync(docPath, 'utf-8');
  const unitsDir = path.join(sessionDir, '.memgrid', 'units');
  fs.mkdirSync(unitsDir, { recursive: true });

  let ingested = 0;
  const now = new Date().toISOString();

  // Extract sections: "## Red Lines", "## Code Philosophy", "### 写入", etc.
  const sections = [
    { heading: 'Red Lines', type: 'preference' as const },
    { heading: 'Code Philosophy', type: 'preference' as const },
    { heading: 'When Things Go Wrong', type: 'preference' as const },
    { heading: 'Self-Review', type: 'preference' as const },
    { heading: 'Decision Review', type: 'insight' as const },
    { heading: '偏好', type: 'preference' as const },
    { heading: '规范', type: 'preference' as const },
    { heading: '约定', type: 'preference' as const },
    { heading: '习惯', type: 'preference' as const },
    { heading: '原则', type: 'preference' as const },
    { heading: '规则', type: 'preference' as const },
    { heading: 'Red Lines', type: 'preference' as const },
    { heading: '工具链', type: 'fact' as const },
    { heading: 'Tech Stack', type: 'fact' as const },
    { heading: '技术栈', type: 'fact' as const },
    { heading: 'Architecture', type: 'fact' as const },
    { heading: '架构', type: 'fact' as const },
  ];

  for (const { heading, type } of sections) {
    // Match the section and extract bullet points until next heading or empty line
    const sectionRe = new RegExp(
      `(?:^#{1,4}\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[\\s\\S]*?)(?=\\n#{1,4}\\s|\\n\\n\\n|$)`,
      'im',
    );
    const match = content.match(sectionRe);
    if (!match) continue;

    const sectionBody = match[0];
    // Extract list items: "- xxx", "* xxx", numbered items
    const items = sectionBody.match(/^\s*[-*]\s+(.+)$|^\s*\d+\.\s+(.+)$/gm);
    if (!items || items.length === 0) continue;

    for (const item of items) {
      const text = item.replace(/^\s*[-*]\s+|^\s*\d+\.\s+/, '').trim();
      if (text.length < 10 || text.startsWith('```') || text.startsWith('#')) continue;

      const id = `ingested_${domainName}_${heading.replace(/\\s+/g, '_').toLowerCase()}_${ingested}`;
      const unitPath = path.join(unitsDir, `${id}.json`);

      // Skip if already ingested
      if (fs.existsSync(unitPath)) continue;

      const unit: MemoryUnit = {
        id,
        type,
        domain: domainName,
        summary: text.slice(0, 80),
        narrative: `From ${path.basename(docPath)} "${heading}" section: ${text}`,
        keywords: [
          heading.toLowerCase(),
          text
            .toLowerCase()
            .split(/\\s+/)
            .find((w) => w.length > 3) || '',
        ],
        signatures: [],
        associations: [],
        meta: {
          created: now,
          updated: now,
          confidence: 0.8,
          usage_count: 0,
          status: 'active',
          tier: 'warm',
        },
        provenance: {
          createdBy: 'memgrid:init-ingest',
          basedOnTask: `Auto-ingested from ${path.basename(docPath)}`,
          timestamp: now,
        },
        source: { file: docPath, type: 'markdown' },
      };

      fs.writeFileSync(unitPath, JSON.stringify(unit, null, 2), 'utf-8');
      ingested++;
    }
  }

  return { ingested };
}

/** Generate .memgrid/README.md for AI tool discoverability */
function generateDomainReadme(domainName: string): string {
  return [
    `# ${domainName} — Project Memory Grid`,
    '',
    'This directory contains a structured knowledge mesh of this project,',
    'built by [MemGrid](https://github.com/wenliangw/memgrid).',
    '',
    '## For AI agents',
    '',
    'Before starting any task, search the memory grid for relevant context:',
    '',
    '```bash',
    '# With MemGrid CLI installed:',
    'memgrid search "your task" --max 10',
    '',
    '# Or manually browse:',
    'ls .memgrid/units/',
    'cat .memgrid/units/method_*.json    # API & code structure',
    'cat .memgrid/units/pattern_*.json   # Design patterns',
    '```',
    '',
    '## Directory structure',
    '',
    '- `mesh.json`              — domain metadata',
    '- `units/`                 — shared knowledge units (code structure, patterns)',
    '- `personal/`              — personal observations (git-ignored, not shared)',
    '- `index/`                 — search index',
    '- `sync.log`               — sync event log',
    '',
    'Managed by MemGrid — runs `memgrid sync` to keep current.',
  ].join('\n');
}

/** Register global MemGrid MCP in ~/.claude/settings.json */
function registerGlobalMcp(_gridDir: string): void {
  const settingsDir = path.join(os.homedir(), '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  const settingsPath = path.join(settingsDir, 'settings.json');

  const mcpEntry: Record<string, unknown> = {
    memgrid: {
      command: 'memgrid',
      args: ['serve'],
    },
  };

  if (fs.existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!existing.mcpServers) existing.mcpServers = {};
      if (existing.mcpServers.memgrid) {
        console.log('  📎 ~/.claude/settings.json: MCP already registered\n');
        return;
      }
      existing.mcpServers = { ...existing.mcpServers, ...mcpEntry };
      fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
      console.log('  📎 ~/.claude/settings.json: MCP merged\n');
    } catch {
      console.log('  ⚠️  Could not parse ~/.claude/settings.json — skipped MCP registration\n');
    }
  } else {
    const settings = { mcpServers: mcpEntry };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.log('  📎 ~/.claude/settings.json: MCP created\n');
  }
}

/** Detect OpenClaw agents from agents.yaml or workspace-agent directories */
interface DetectedAgent {
  name: string;
  description?: string;
  purpose?: string;
  workspaceDir?: string;
}

function detectOpenClawAgents(projectRoot: string): DetectedAgent[] {
  const agents: DetectedAgent[] = [];

  // Method 1: Read from agents.yaml if present
  const yamlPaths = [
    path.join(projectRoot, 'agents.yaml'),
    path.join(projectRoot, 'config', 'agents.yaml'),
  ];

  for (const yamlPath of yamlPaths) {
    if (fs.existsSync(yamlPath)) {
      try {
        const content = fs.readFileSync(yamlPath, 'utf-8');
        // Simple YAML parsing: match agent blocks
        const agentPattern = /^\s*(\w[\w-]*):\s*$\s*^\s*name:\s*(.+)$\s*^\s*description:\s*(.+)$/gm;
        let match;
        while ((match = agentPattern.exec(content)) !== null) {
          agents.push({
            name: match[2].trim().replace(/"/g, ''),
            description: match[3].trim().replace(/"/g, ''),
            purpose: match[1].trim(),
          });
        }
      } catch {
        /* ignore yaml parse errors */
      }
    }
  }

  // Method 2: Scan workspace-* directories for agent identity files
  if (agents.length === 0) {
    const workspaceDirs = fs.readdirSync(projectRoot).filter((d) => {
      const full = path.join(projectRoot, d);
      return fs.statSync(full).isDirectory() && d.startsWith('workspace-');
    });

    for (const dir of workspaceDirs) {
      const fullWorkspacePath = path.join(projectRoot, dir);
      const identityPath = path.join(fullWorkspacePath, 'IDENTITY.md');
      if (fs.existsSync(identityPath)) {
        try {
          const content = fs.readFileSync(identityPath, 'utf-8');
          // Extract name and description from IDENTITY.md
          const nameMatch = content.match(/Name:\*\*\s*(.+)/);
          const purposeMatch = content.match(/I (am|help|manage|handle|do|provide)([^.]+)/i);
          agents.push({
            name: nameMatch ? nameMatch[1].trim() : dir.replace('workspace-', ''),
            description: purposeMatch ? purposeMatch[0] : '',
            purpose: dir.replace('workspace-', ''),
            workspaceDir: fullWorkspacePath,
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Method 3: Fallback — scan .memgrid/sessions/ for already-initialized agent domains
  if (agents.length === 0) {
    const sessionsPath = path.join(projectRoot, '.memgrid', 'sessions');
    if (fs.existsSync(sessionsPath)) {
      for (const entry of fs.readdirSync(sessionsPath)) {
        const agentPath = path.join(sessionsPath, entry);
        if (fs.statSync(agentPath).isDirectory()) {
          const agentMetaPath = path.join(agentPath, 'agent.json');
          if (fs.existsSync(agentMetaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(agentMetaPath, 'utf-8'));
              agents.push({
                name: meta.name || entry,
                description: meta.description,
                purpose: meta.purpose,
              });
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  return agents;
}

/**
 * Auto-migrate existing OpenClaw memory files into MemGrid.
 *
 * Detects MEMORY.md, memory/** / *.md, memory/daily/*.md.
 * Short content (≤500 chars) → memory unit.
 * Long content (>500 chars) → library document + memory unit with library_ref.
 * Original files preserved (not deleted).
 */
interface MigrationResult {
  total: number;
  memoryUnits: number;
  libraryDocs: number;
  skipped: number;
}

function migrateExistingMemories(dm: DomainManager): MigrationResult {
  const result: MigrationResult = { total: 0, memoryUnits: 0, libraryDocs: 0, skipped: 0 };

  // Find the OpenClaw workspaces directory
  const workspacesDir = path.join(os.homedir(), '.openclaw');
  const workspaceDirs = fs
    .readdirSync(workspacesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('workspace-'))
    .map((d) => path.join(workspacesDir, d.name));

  for (const wsDir of workspaceDirs) {
    // Find agent matching this workspace
    const agent = dm.listDomains().find((d) => {
      try {
        const agentFile = path.join(dm.gridDir, 'sessions', d.name, 'agent.json');
        if (fs.existsSync(agentFile)) {
          const cfg = JSON.parse(fs.readFileSync(agentFile, 'utf-8'));
          return cfg.purpose && wsDir.includes(cfg.purpose);
        }
      } catch {
        /* agent.json parse error — skip */
      }
      return false;
    });
    if (!agent) continue;

    const sessionDir = path.join(dm.gridDir, 'sessions', agent.name);

    // Scan memory files in workspace
    const memoryFiles = findMemoryFiles(wsDir);

    for (const mf of memoryFiles) {
      try {
        const content = fs.readFileSync(mf, 'utf-8');
        if (content.trim().length === 0) {
          result.skipped++;
          continue;
        }

        const title = path.basename(mf).replace(/\.[^.]+$/, '');
        const sourceFile = path.relative(os.homedir(), mf);

        if (content.length <= 500) {
          // Short content → memory unit directly
          const id = `migrated_${agent.name}_${title.replace(/[^a-z0-9_]/g, '_').slice(0, 40)}`;
          const unitPath = path.join(sessionDir, '.memgrid', 'units', `${id}.json`);

          // Skip if already migrated
          if (fs.existsSync(unitPath)) {
            result.skipped++;
            continue;
          }

          const unit: MemoryUnit = {
            id,
            type: inferType(title, content),
            summary: title.slice(0, 80),
            narrative: content,
            keywords: extractKeywords(content),
            source: { file: sourceFile, type: 'markdown' },
            signatures: [],
            associations: [],
            meta: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              confidence: 0.7,
              usage_count: 0,
              status: 'active',
              tier: 'warm',
            },
            provenance: {
              createdBy: 'memgrid:migration',
              basedOnTask: `Auto-migrated from ${sourceFile}`,
              timestamp: new Date().toISOString(),
            },
          };

          fs.mkdirSync(path.dirname(unitPath), { recursive: true });
          fs.writeFileSync(unitPath, JSON.stringify(unit, null, 2), 'utf-8');
          result.memoryUnits++;
        } else {
          // Long content → library + memory unit with library_ref
          const libId = `lib_migrated_${title.replace(/[^a-z0-9_]/g, '_').slice(0, 40)}`;
          const libPath = path.join(sessionDir, '.memgrid', 'library', `${libId}.json`);

          // Skip if already migrated
          if (fs.existsSync(libPath)) {
            result.skipped++;
            continue;
          }

          // Store in library
          const libUnit: LibraryUnit = {
            id: libId,
            title,
            content,
            source: { file: sourceFile, type: 'memory', migratedAt: new Date().toISOString() },
            keywords: extractKeywords(content),
            domain: agent.name,
            meta: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              size: content.length,
              usage_count: 0,
              status: 'active',
            },
          };

          fs.mkdirSync(path.dirname(libPath), { recursive: true });
          fs.writeFileSync(libPath, JSON.stringify(libUnit, null, 2), 'utf-8');
          result.libraryDocs++;

          // Create memory unit pointing to library
          const unitId = `migrated_${agent.name}_${title.replace(/[^a-z0-9_]/g, '_').slice(0, 40)}`;
          const unitPath = path.join(sessionDir, '.memgrid', 'units', `${unitId}.json`);

          const unit: MemoryUnit = {
            id: unitId,
            type: inferType(title, content),
            summary: title.slice(0, 80),
            narrative: content.slice(0, 500),
            keywords: extractKeywords(content),
            library_ref: libId,
            source: { file: sourceFile, type: 'library' },
            signatures: [],
            associations: [],
            meta: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              confidence: 0.7,
              usage_count: 0,
              status: 'active',
              tier: 'warm',
            },
            provenance: {
              createdBy: 'memgrid:migration',
              basedOnTask: `Auto-migrated from ${sourceFile}. Full text: memgrid lib-get ${libId}`,
              timestamp: new Date().toISOString(),
            },
          };

          fs.writeFileSync(unitPath, JSON.stringify(unit, null, 2), 'utf-8');
          result.memoryUnits++;
        }

        result.total++;
      } catch (e) {
        console.log(`  ⚠️  Skipped ${mf}: ${(e as Error).message}`);
      }
    }
  }

  return result;
}

/** Find existing memory files in a workspace directory */
function findMemoryFiles(workspaceDir: string): string[] {
  const files: string[] = [];
  const memPath = path.join(workspaceDir, 'MEMORY.md');
  const memoryDir = path.join(workspaceDir, 'memory');

  if (fs.existsSync(memPath)) files.push(memPath);

  if (fs.existsSync(memoryDir)) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.md')) {
          files.push(full);
        }
      }
    };
    walk(memoryDir);
  }

  return files;
}

/** Infer memory type from filename and content */
function inferType(title: string, _content: string): MemoryUnitType {
  const lower = title.toLowerCase();
  if (lower.includes('preference') || lower.includes('habit') || lower.includes('prefer'))
    return 'preference';
  if (
    lower.includes('event') ||
    lower.includes('log') ||
    lower.includes('202') ||
    lower.includes('daily')
  )
    return 'event';
  if (
    lower.includes('decision') ||
    lower.includes('choice') ||
    lower.includes('mistake') ||
    lower.includes('error')
  )
    return 'insight';
  if (lower.includes('config') || lower.includes('tech') || lower.includes('api')) return 'fact';
  return 'insight';
}

/** Simple keyword extraction from text */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

/**
 * Search upward from a starting directory for a package.json with a version field.
 * Used to resolve the CLI's own version at runtime without hardcoding.
 */
function searchUpwardForVersion(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const v = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
        if (v && pkgPath.includes('memgrid')) return v;
      }
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackageVersion(): string {
  // 1) Walk upward from the resolved CLI entry (follows symlinks)
  const argv1 = process.argv[1] || '';
  if (argv1) {
    // ESM shebang can produce file:// URLs; strip protocol
    const entryPath = argv1.startsWith('file://') ? argv1.replace(/^file:\/\//, '') : argv1;
    // Follow symlinks (e.g. nvm bin/memgrid → lib/node_modules/memgrid/dist/serve/cli.js)
    let resolvedEntry: string;
    try {
      resolvedEntry = fs.realpathSync(entryPath);
    } catch {
      resolvedEntry = entryPath;
    }
    const v = searchUpwardForVersion(path.dirname(resolvedEntry));
    if (v) return v;
  }

  // 2) Fallback: walk upward from cwd (project-local installs)
  return searchUpwardForVersion(process.cwd()) || '0.0.0-unknown';
}

/** Auto-register MemGrid MCP server in OpenClaw Gateway's openclaw.json */
function registerOpenClawMcp(configPath: string, domainPath?: string): void {
  if (!fs.existsSync(configPath)) {
    console.log('  ⚠️  openclaw.json not found — skip MCP registration');
    console.log(
      `     Add manually: {"mcp":{"servers":{"memgrid":{"command":"memgrid","args":["serve"]}}}}`,
    );
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.mcp) config.mcp = {};
    if (!config.mcp.servers) config.mcp.servers = {};

    if (config.mcp.servers.memgrid) {
      console.log('  📎 openclaw.json: MemGrid MCP already registered');
      return;
    }

    const args = ['serve'];
    if (domainPath) {
      args.push('--domain', domainPath);
    }
    config.mcp.servers.memgrid = {
      command: 'memgrid',
      args,
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log('  📎 openclaw.json: MemGrid MCP registered');
    console.log('     → Restart OpenClaw Gateway to activate MemGrid tools');
  } catch {
    console.log('  ⚠️  Could not parse openclaw.json — add MCP manually');
  }
}

/** Inject MemGrid block into Agent's AGENTS.md (like CLAUDE.md for project mode) */
function injectMemGridAgentsBlock(agentsMdPath: string, agentName: string): void {
  const existing = fs.readFileSync(agentsMdPath, 'utf-8');

  const domainName = agentName;

  const newBlock = [
    '',
    '<!-- MEMGRID:START -->',
    '',
    '## 🧠 MemGrid — Memory System',
    '',
    'This agent has access to MemGrid memory tools. Your memory domain:',
    '',
    `- **Domain:** \`${domainName}\``,
    '',
    '### Search (before every task)',
    '```',
    `memgrid_search(query="your task description", domain="${domainName}", maxResults=10)`,
    '```',
    '',
    '### Remember (after every turn)',
    '',
    'After each conversation turn, extract and store what matters:',
    '',
    '1. **Review**: What was discussed? Any decisions, discoveries, or preferences?',
    '2. **Pre-filter**: Call `memgrid_extract` for rule-based candidate detection',
    '3. **Refine** (you do this — you have full context):',
    '   - Remove noise (greetings, small talk, brief confirmations)',
    '   - Fix type if the rule engine misclassified',
    '   - Merge related candidates into one',
    '   - Enrich narrative with causality and context',
    '4. **Write** with `memgrid_add`:',
    '   - `insight` — decision, lesson, discovery',
    '   - `fact` — knowledge, architecture, tech stack',
    '   - `event` — release, PR merge, deployment',
    '   - `preference` — habit, rule, style change',
    '',
    '```',
    '# Extract candidates from conversation',
    `memgrid_extract(conversation="...", domain="${domainName}")`,
    '',
    '# Write refined memory',
    `memgrid_add(type="insight", summary="...", description="...", domain="${domainName}")`,
    '',
    '# Review and accept candidates',
    `memgrid_review(action="list", domain="${domainName}")  → memgrid_review(action="accept", unitId="id", domain="${domainName}")`,
    '```',
    '',
    '<!-- MEMGRID:END -->',
  ];

  const blockText = newBlock.join('\n') + '\n';

  if (existing.includes('<!-- MEMGRID:START -->')) {
    // Check if existing block is outdated (old version lacks domain or has memgrid_suggest)
    if (existing.includes('domain=') && existing.includes('memgrid_extract')) {
      console.log(`     AGENTS.md: MemGrid block already up-to-date`);
      return;
    }
    // Replace old block with new block
    const startIdx = existing.indexOf('<!-- MEMGRID:START -->');
    const endIdx = existing.indexOf('<!-- MEMGRID:END -->');
    if (endIdx > startIdx) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + '<!-- MEMGRID:END -->'.length);
      fs.writeFileSync(agentsMdPath, before + blockText.trimEnd() + after, 'utf-8');
      console.log(`     AGENTS.md: MemGrid block updated (old → new)`);
      return;
    }
  }

  fs.appendFileSync(agentsMdPath, blockText, 'utf-8');
  console.log(`     AGENTS.md: MemGrid block injected for ${agentName}`);
}

/**
 * Inject a metacognitive anchor memory unit into an agent's MemGrid domain.
 *
 * This unit serves as a "memory iron law" — every Agent that boots with
 * this in its memory domain knows it MUST actively write memories after
 * each conversation turn. It is the lowest-level guarantee of the memory system.
 *
 * Injected once during `memgrid init --openclaw`. Already-existing agent domains
 * are skipped (no duplicate injection).
 */
function injectMetacognitiveAnchor(sessionDir: string, lang: 'en' | 'zh') {
  const mg = new MemGrid(sessionDir);
  mg.store.ensureDirs();
  mg.store.load();

  // Check if anchor already exists (prevent duplicates)
  const existing = mg.store
    .listUnitsSync()
    .filter(
      (u) => u.summary?.includes('元认知铁律') || u.summary?.includes('Metacognitive Iron Law'),
    );
  if (existing.length > 0) {
    return; // already injected
  }

  const isEn = lang === 'en';
  const timestamp = Date.now();
  const anchorUnit: MemoryUnit = {
    id: `anchor_meta_${timestamp}`,
    type: 'preference' as MemoryUnitType,
    domain: 'cognition',
    summary: isEn
      ? '🔴 Metacognitive Iron Law: Actively write memories after EVERY conversation turn'
      : '🔴 元认知铁律：每轮对话后必须立即主动写入记忆',
    narrative: isEn
      ? 'After every substantive conversation turn with the user, you MUST immediately call memgrid_add to write down anything worth remembering. Trigger conditions include: decisions, new facts, preference changes, events, discussion conclusions. Do NOT wait, do NOT batch, do NOT rely on user reminder. This is the lowest-level safeguard of the memory system.'
      : '每轮和用户的实质性对话结束后，必须立刻调用 memgrid_add 写入值得记住的信息。触发条件包括：决策、新事实、偏好变更、事件、讨论结论。不等、不攒、不依赖用户提醒。这是记忆系统最底层保障。',
    keywords: isEn
      ? ['metacognitive', 'iron-law', 'memory', 'write', 'every-turn', 'memgrid_add']
      : ['元认知', '铁律', '记忆', '写入', '每轮', 'memgrid_add'],
    signatures: [],
    associations: [],
    meta: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      confidence: 1.0,
      usage_count: 0,
      status: 'active',
      tier: 'hot' as MemoryTier,
    },
    provenance: {
      createdBy: 'memgrid:init-anchor',
      basedOnTask: 'Initial metacognitive anchor injection',
      timestamp: new Date().toISOString(),
    },
  };

  mg.store.saveUnit(anchorUnit);
  console.log(`     🧠 Metacognitive anchor injected (${lang})`);
}

/**
 * Migrate data from old nested paths (pre-v0.10.4 bug) to correct locations.
 *
 * Bug: FileStore used to blindly append .memgrid/ to projectRoot, causing:
 *   ~/.memgrid/.memgrid/units/  (personality domain)
 *   ~/.memgrid/sessions/{agent}/.memgrid/units/  (agent domain)
 *
 * Fix: FileStore now detects grid roots. This migrates existing data.
 */
function migrateNestedPaths(dm: DomainManager): void {
  let movedPersonality = 0;
  let movedAgent = 0;

  // 1. Migrate personality domain units: ~/.memgrid/.memgrid/units/ → ~/.memgrid/units/
  const oldPersonalityUnits = path.join(dm.gridDir, '.memgrid', 'units');
  const newPersonalityUnits = path.join(dm.gridDir, 'units');
  if (fs.existsSync(oldPersonalityUnits)) {
    fs.mkdirSync(newPersonalityUnits, { recursive: true });
    for (const file of fs.readdirSync(oldPersonalityUnits)) {
      if (!file.endsWith('.json')) continue;
      const src = path.join(oldPersonalityUnits, file);
      const dst = path.join(newPersonalityUnits, file);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        movedPersonality++;
      }
    }
  }

  // 2. Migrate agent session domain units
  const sessionsDir = path.join(dm.gridDir, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    for (const agentName of fs.readdirSync(sessionsDir)) {
      const agentDir = path.join(sessionsDir, agentName);
      if (!fs.statSync(agentDir).isDirectory()) continue;

      const oldAgentUnits = path.join(agentDir, '.memgrid', 'units');
      const newAgentUnits = path.join(agentDir, 'units');
      if (fs.existsSync(oldAgentUnits)) {
        fs.mkdirSync(newAgentUnits, { recursive: true });
        for (const file of fs.readdirSync(oldAgentUnits)) {
          if (!file.endsWith('.json')) continue;
          const src = path.join(oldAgentUnits, file);
          const dst = path.join(newAgentUnits, file);
          if (!fs.existsSync(dst)) {
            fs.copyFileSync(src, dst);
            movedAgent++;
          }
        }
      }

      // Also migrate archive if exists
      const oldAgentArchive = path.join(agentDir, '.memgrid', 'archive');
      const newAgentArchive = path.join(agentDir, 'archive');
      if (fs.existsSync(oldAgentArchive)) {
        fs.mkdirSync(newAgentArchive, { recursive: true });
        const walkCopy = (srcDir: string, dstDir: string) => {
          if (!fs.existsSync(srcDir)) return;
          for (const entry of fs.readdirSync(srcDir)) {
            const s = path.join(srcDir, entry);
            const d = path.join(dstDir, entry);
            if (fs.statSync(s).isDirectory()) {
              fs.mkdirSync(d, { recursive: true });
              walkCopy(s, d);
            } else if (entry.endsWith('.json') && !fs.existsSync(d)) {
              fs.copyFileSync(s, d);
              movedAgent++;
            }
          }
        };
        walkCopy(oldAgentArchive, newAgentArchive);
      }
    }
  }

  if (movedPersonality > 0 || movedAgent > 0) {
    console.log(
      `  📦 Path migration: ${movedPersonality} personality + ${movedAgent} agent unit(s) moved`,
    );
    console.log(
      '     Old files preserved — remove ~/.memgrid/.memgrid/ and sessions/*/.memgrid/ when ready',
    );
  }
}

/**
 * Auto-register MemGrid auto-memory plugin in OpenClaw Gateway.
 *
 * Writes a plugin entry into the Gateway's openclaw.json config that
 * subscribes to `agent_end` hook — automatically extracting memories
 * from every conversation turn via memgrid_extract.
 */
function registerMemGridPlugin(configPath: string): void {
  if (!fs.existsSync(configPath)) {
    console.log('  ⚠️  openclaw.json not found — skip plugin registration');
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    if (!config.plugins) config.plugins = {};
    if (!config.plugins.load) config.plugins.load = { paths: [] };
    if (!config.plugins.entries) config.plugins.entries = {};

    // Check if already registered
    if (config.plugins.entries['memgrid-agent']) {
      console.log('  📎 openclaw.json: MemGrid plugin already registered');
      return;
    }

    // Determine plugin path
    const pluginPath = path.join(
      require.main?.filename ?? __dirname,
      '..',
      '..',
      '..',
      '..',
      'memgrid-plugin',
    );
    // Normalize: if we can't resolve, use a standard path
    const resolvedPluginPath = fs.existsSync(pluginPath)
      ? pluginPath.replaceAll('\\', '/')
      : '~/.memgrid/extensions/memgrid-agent';

    // Add plugin load path
    if (!config.plugins.load.paths.includes(resolvedPluginPath)) {
      config.plugins.load.paths.push(resolvedPluginPath);
    }

    // Add plugin entry
    config.plugins.entries['memgrid-agent'] = {
      enabled: true,
      hooks: {
        allowConversationAccess: true,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log('  📎 openclaw.json: MemGrid auto-memory plugin registered');
    console.log('     → Restart OpenClaw Gateway to activate');
  } catch {
    console.log('  ⚠️  Could not parse openclaw.json — add plugin manually');
  }
}

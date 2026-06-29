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

const program = new Command();

program
  .name('memgrid')
  .description('Project-level semantic memory for AI coding agents')
  .version('0.10.0');

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
  .option('--server', 'Initialize in OpenClaw server mode')
  .option('--openclaw', 'Generate OpenClaw Gateway config')
  .action(async (options) => {
    const root = process.cwd();
    const dm = new DomainManager();

    // === Mode 3: OpenClaw Server ===
    if (options.server) {
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
        console.log('     Example: memgrid init --server --domain my-agent');
      } else {
        for (const agent of agents) {
          const sessionPath = path.join(dm.gridDir, 'sessions', agent.name);
          fs.mkdirSync(sessionPath, { recursive: true });

          // Init MemGrid domain for this agent
          const mg = new MemGrid(sessionPath);
          await mg.init({
            projectRoot: sessionPath,
            includeRules: false,
            includeExamples: false,
            force: options.force || false,
          });

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
        }

        // Generate global migration guide
        generateMigrationGuide(dm.gridDir);
        console.log(`\n  📋 Migration guide: ~/.memgrid/MIGRATION.md`);
        console.log(
          `     → Tell your agent: "Please read MIGRATION.md and migrate existing memories into MemGrid"`,
        );
      }

      // Generate OpenClaw Gateway config
      if (options.openclaw) {
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
        const openclawJsonPath = path.join(root, '..', 'openclaw.json');
        registerOpenClawMcp(openclawJsonPath);
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
          `  ${p.type === 'error_solution' ? '🐛' : p.type === 'pattern' ? '📐' : '📋'} ${p.summary} (${p.file})`,
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
      content: {
        description: options.description,
      },
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
    if (parsed.content.trigger) console.log(`   trigger: ${parsed.content.trigger}`);
    if (parsed.content.action) console.log(`   action: ${parsed.content.action}`);
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
        console.log(`  ${icon[d.type] || '📁'} ${d.name}  [${d.type}]`);
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
  .action(async () => {
    console.error('🚀 MemGrid MCP Server starting...');
    await startMCPServer(process.cwd());
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
    `This project uses MemGrid for persistent memory. Search before each task to understand the codebase context.`,
    '',
    '### How to use',
    '',
    '**Before starting a task:**',
    '```bash',
    'npx memgrid search "your task description" --max 10',
    '```',
    '',
    '**Or use the MCP tool:** Call `memgrid_search` directly in conversation.',
    '',
    '**After completing code changes:**',
    '```bash',
    'npx memgrid sync',
    '```',
    '',
    'Memory is stored in `.memgrid/`. It auto-syncs via hooks. Candidate learnings need manual review via `memgrid review`.',
    '',
    '<!-- MEMGRID:END -->',
  ].join('\n');

  if (!fs.existsSync(claudeMdPath)) {
    // Create new CLAUDE.md with MemGrid block
    fs.writeFileSync(claudeMdPath, `# ${domainName}\n${block}\n`, 'utf-8');
    console.log('  CLAUDE.md: created with MemGrid instructions');
    return;
  }

  const existing = fs.readFileSync(claudeMdPath, 'utf-8');
  if (existing.includes('<!-- MEMGRID:START -->')) {
    console.log('  CLAUDE.md: MemGrid block already exists');
    return;
  }

  fs.appendFileSync(claudeMdPath, block + '\n', 'utf-8');
  console.log('  CLAUDE.md: MemGrid block injected');
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

/** Generate MIGRATION.md for an agent session domain */
function generateMigrationGuide(gridDir: string): void {
  const guide = [
    '# Memory Migration Guide',
    '',
    'This guide explains how to migrate your existing memory system',
    'into this MemGrid session domain.',
    '',
    '## What MemGrid expects',
    '',
    'Each memory is stored as a JSON file. Use the `memgrid_add` MCP tool',
    'or `memgrid add` CLI to write memories.',
    '',
    '### Memory unit structure',
    '',
    '```json',
    '{',
    '  "type": "method|pattern|error_solution|decision|style_preference|...",',
    '  "summary": "One-line summary of what this memory represents",',
    '  "description": "Detailed description",',
    '  "sourceFile": "(optional) source file path"',
    '}',
    '```',
    '',
    '### Memory types',
    '',
    '| Type | Use for |',
    '|------|--------|',
    '| `method` | A function or method signature |',
    '| `pattern` | Design pattern or recurring convention |',
    '| `error_solution` | A bug and how it was fixed |',
    '| `decision` | A code decision and its rationale |',
    '| `style_preference` | A coding style preference |',
    '| `rule_trigger` | When to apply a specific rule |',
    '| `architecture_principle` | An architecture red line |',
    '',
    '## Migration steps',
    '',
    '1. Read your existing memory files (identify the format they use)',
    '2. For each memory unit, map it to the closest MemGrid type above',
    '3. Write it via `memgrid_add` with `status: "active"`',
    '4. Run `memgrid rebalance` to assign storage tiers',
    '5. Run `memgrid stats` to verify the migration count',
    '',
    '## Example type mapping',
    '',
    'If your existing memory system uses different type names, map them:',
    '',
    '| Your type | MemGrid type |',
    '|-----------|-------------|',
    '| event / log | `decision` |',
    '| knowledge / fact | `pattern` |',
    '| mistake / bug-fix | `error_solution` |',
    '| rule / convention | `rule_trigger` |',
    '| preference / habit | `style_preference` |',
    '',
    '## After migration',
    '',
    '- Run `memgrid review` to verify migrated memories',
    '- Run `memgrid conflicts` to check for contradictions',
    '- Tell your agent: "My memory system is now MemGrid-managed."',
    '',
    'Managed by MemGrid — this guide is generated during `memgrid init --server`.',
  ];

  const guidePath = path.join(gridDir, 'MIGRATION.md');
  fs.writeFileSync(guidePath, guide.join('\n'), 'utf-8');
}

/** Auto-register MemGrid MCP server in OpenClaw Gateway's openclaw.json */
function registerOpenClawMcp(configPath: string): void {
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

    config.mcp.servers.memgrid = {
      command: 'memgrid',
      args: ['serve'],
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log('  📎 openclaw.json: MemGrid MCP registered');
    console.log('     → Restart OpenClaw Gateway to activate MemGrid tools');
  } catch {
    console.log('  ⚠️  Could not parse openclaw.json — add MCP manually');
  }
}

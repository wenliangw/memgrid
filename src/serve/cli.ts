#!/usr/bin/env node
import { Command } from 'commander';
import { MemGrid } from '../memgrid.js';
import { startMCPServer } from './mcp-server.js';

const program = new Command();

program
  .name('memgrid')
  .description('Project-level semantic memory for AI coding agents')
  .version('0.4.0');

program
  .command('init')
  .description('Scan project and generate initial memory grid')
  .option('-f, --force', 'Force re-scan even if grid exists')
  .option('--no-rules', 'Skip scanning .claude/rules/')
  .option('--no-examples', 'Skip scanning .claude/examples/')
  .action(async (options) => {
    const mg = new MemGrid(process.cwd());
    console.log('🔍 Scanning project...\n');

    const units = await mg.init({
      projectRoot: process.cwd(),
      includeRules: options.rules !== false,
      includeExamples: options.examples !== false,
      force: options.force || false,
    });

    const stats = await mg.stats();
    console.log('📊 MemGrid initialized!\n');
    console.log('Units generated:');
    for (const [type, count] of Object.entries(stats.typeDistribution)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log(`\nTotal: ${stats.totalUnits} units`);
    console.log(`Storage: .claude/memory-grid/`);
  });

program
  .command('search')
  .description('Search memory grid for relevant units (hybrid: keyword + semantic)')
  .argument('<query>', 'Search query')
  .option('-n, --max <number>', 'Max results', '10')
  .option('-H, --hops <number>', 'Max association hops', '2')
  .option('-s, --semantic <number>', 'Semantic weight (0.0-1.0, default: 0.4)', '0.4')
  .action(async (query, options) => {
    const mg = new MemGrid(process.cwd());
    const result = await mg.search(query, {
      maxResults: parseInt(options.max),
      maxHops: parseInt(options.hops),
      semanticWeight: parseFloat(options.semantic),
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
  .command('stats')
  .description('Show grid statistics')
  .action(async () => {
    const mg = new MemGrid(process.cwd());
    const stats = await mg.stats();
    console.log('📊 MemGrid Statistics\n');
    console.log(`  Total units:    ${stats.totalUnits}`);
    console.log(`  Active:         ${stats.activeUnits}`);
    console.log(`  Archived:       ${stats.archivedUnits}`);
    console.log(`  Last scan:      ${stats.lastScanAt || 'Never'}`);
    console.log(`\n  Type distribution:`);
    for (const [type, count] of Object.entries(stats.typeDistribution)) {
      console.log(`    ${type}: ${count}`);
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

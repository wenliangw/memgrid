import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MemGrid } from '../memgrid.js';
import type { MemoryUnitType, LegacyMemoryUnitType } from '../shared/types.js';

const VALID_TYPES: MemoryUnitType[] = ['fact', 'insight', 'event', 'preference'];

/** Legacy types that are still accepted but mapped to new types */
const LEGACY_ACCEPTED: LegacyMemoryUnitType[] = [
  'method',
  'component',
  'pattern',
  'config',
  'error_solution',
  'decision',
  'skill_trigger',
  'mcp_trigger',
  'rule_trigger',
  'style_preference',
  'architecture_principle',
];

export class MemGridServer {
  private server: Server;
  private mg: MemGrid;

  constructor(projectRoot: string) {
    this.mg = new MemGrid(projectRoot);
    this.server = new Server(
      { name: 'memgrid', version: '0.8.0' },
      { capabilities: { tools: {} } },
    );

    this.registerTools();
    this.registerHandlers();
  }

  private registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'memgrid_search',
          description:
            'Search the project memory grid for relevant knowledge units. ' +
            'Returns method signatures, design patterns, coding style preferences, ' +
            'error solutions, and tooling triggers related to the query. ' +
            'Does NOT return candidate/unreviewed units. ' +
            'Use this instead of reading every file to understand the project.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'What are you trying to do? Describe the task in natural language.',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of units to return (default: 10, max: 20)',
                default: 10,
              },
              maxHops: {
                type: 'number',
                description: 'How many association hops to traverse (default: 2, max: 3)',
                default: 2,
              },
              semanticWeight: {
                type: 'number',
                description:
                  'Hybrid search: 0.0 = keyword only, 1.0 = semantic only (default: 0.4)',
                default: 0.4,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'memgrid_add',
          description:
            'Add a memory unit to the grid. By default created as "candidate" — ' +
            'must be confirmed via memgrid_review before it appears in search results. ' +
            'Set status=active only for user-confirmed facts. ' +
            'Use after completing a task to record what you learned: new methods, ' +
            'mistakes fixed, design decisions, or style preferences.',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description:
                  'Unit type: fact, insight, event, preference. ' +
                  'Legacy types (method, pattern, etc.) also accepted and auto-mapped.',
                enum: VALID_TYPES,
              },
              summary: {
                type: 'string',
                description: 'One-line summary of what this unit represents',
              },
              description: {
                type: 'string',
                description: 'Detailed description of the unit content',
              },
              sourceFile: {
                type: 'string',
                description: 'Source file path (if applicable)',
              },
              codeSnippet: {
                type: 'string',
                description: 'Relevant code snippet (if applicable)',
              },
              styleNotes: {
                type: 'string',
                description: 'Style or usage notes',
              },
              domain: {
                type: 'string',
                description:
                  'Target domain. Use "personality" for cross-project preferences, ' +
                  'project name (e.g. "septonir") for project-specific memories, ' +
                  'or omit for current session domain.',
              },
              status: {
                type: 'string',
                description:
                  'Unit status: "candidate" (default, needs review before searchable) ' +
                  'or "active" (user-confirmed, searchable immediately)',
                enum: ['candidate', 'active'],
                default: 'candidate',
              },
              associations: {
                type: 'array',
                description: 'Links to other unit IDs',
                items: {
                  type: 'object',
                  properties: {
                    to: { type: 'string' },
                    relation: { type: 'string' },
                    weight: { type: 'number', default: 0.8 },
                  },
                },
              },
            },
            required: ['type', 'summary', 'description'],
          },
        },
        {
          name: 'memgrid_suggest',
          description:
            'After completing a coding task, ask MemGrid to analyze what should be learned. ' +
            'Returns suggestions as CANDIDATE units (not searchable until confirmed). ' +
            'Present these to the user for review — they confirm which ones to keep.',
          inputSchema: {
            type: 'object',
            properties: {
              taskSummary: {
                type: 'string',
                description: 'Brief summary of what the task was about',
              },
              outcome: {
                type: 'string',
                description: 'What was the outcome? What was built, fixed, or changed?',
              },
              filesModified: {
                type: 'array',
                description: 'List of files that were modified or created',
                items: { type: 'string' },
              },
            },
            required: ['taskSummary', 'outcome'],
          },
        },
        {
          name: 'memgrid_review',
          description:
            'Review and confirm or reject candidate memory units. ' +
            'Candidate units are NOT searchable until accepted. ' +
            'Call this after memgrid_suggest or memgrid sync to let the user ' +
            'decide which learnings to keep.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description:
                  'accept (make searchable), reject (archive), or list (show candidates)',
                enum: ['accept', 'reject', 'list', 'accept-all', 'reject-all'],
              },
              unitId: {
                type: 'string',
                description: 'Unit ID to accept/reject (not needed for list/accept-all/reject-all)',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'memgrid_conflicts',
          description:
            'Detect potentially conflicting memory units. ' +
            'Two units conflict when they share the same type (e.g. style_preference) ' +
            'and have high keyword overlap but potentially opposing meanings. ' +
            'Call this periodically to catch contradictory memories before they affect decisions.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'memgrid_rebalance',
          description:
            'Rebalance all memory units across tiers (hot/warm/cold/frozen). ' +
            'Call periodically to maintain healthy memory distribution. ' +
            'Cold overflow triggers freezing of lowest-retention units.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'memgrid_search_frozen',
          description:
            'Search the frozen tier for a specific memory clue (method name, keyword, etc). ' +
            'Frozen memories are not returned by regular search — use this when a user ' +
            'mentions something specific that might be in old, compressed memories.',
          inputSchema: {
            type: 'object',
            properties: {
              clue: {
                type: 'string',
                description: 'Exact keyword, method name, or phrase to find in frozen memories',
              },
            },
            required: ['clue'],
          },
        },
        {
          name: 'memgrid_thaw',
          description:
            'Restore a frozen memory unit back to warm tier. ' +
            'Use after memgrid_search_frozen found something the user wants to recover.',
          inputSchema: {
            type: 'object',
            properties: {
              unitId: {
                type: 'string',
                description: 'ID of the frozen unit to restore',
              },
            },
            required: ['unitId'],
          },
        },
        {
          name: 'memgrid_update',
          description:
            'Update an existing memory unit. Only provided fields will be changed. ' +
            'Can change type, summary, narrative, keywords, domain, or confidence.',
          inputSchema: {
            type: 'object',
            properties: {
              unitId: {
                type: 'string',
                description: 'ID of the unit to update',
              },
              type: {
                type: 'string',
                description: 'New unit type (fact/insight/event/preference)',
                enum: VALID_TYPES,
              },
              summary: {
                type: 'string',
                description: 'New one-line summary',
              },
              description: {
                type: 'string',
                description: 'New detailed description (narrative)',
              },
              domain: {
                type: 'string',
                description: 'New domain to move the unit to',
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'New keywords',
              },
              confidence: {
                type: 'number',
                description: 'New confidence score (0.0-1.0)',
              },
              status: {
                type: 'string',
                enum: ['active', 'stale', 'archived', 'candidate'],
                description: 'New status',
              },
            },
            required: ['unitId'],
          },
        },
        {
          name: 'memgrid_archive',
          description:
            'Archive a memory unit (mark as inactive, excluded from search results).',
          inputSchema: {
            type: 'object',
            properties: {
              unitId: {
                type: 'string',
                description: 'ID of the unit to archive',
              },
            },
            required: ['unitId'],
          },
        },
        {
          name: 'memgrid_extract',
          description:
            'Extract memory candidates from conversation text. ' +
            'Uses rule-based pattern matching (always available) to identify ' +
            'decisions, preferences, events, and facts. Returns candidates ' +
            'as draft units — review and accept via memgrid_review.',
          inputSchema: {
            type: 'object',
            properties: {
              conversation: {
                type: 'string',
                description: 'Conversation text to extract memories from',
              },
              domain: {
                type: 'string',
                description: 'Domain name to assign extracted units to',
              },
              autoAccept: {
                type: 'boolean',
                description:
                  'If true, auto-accept high-confidence candidates (≥0.8). Default: false.',
                default: false,
              },
            },
            required: ['conversation'],
          },
        },
      ];

      return { tools };
    });
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'memgrid_search': {
            const query = (args as any).query as string;
            const maxResults = Math.min((args as any).maxResults || 10, 20);
            const maxHops = Math.min((args as any).maxHops || 2, 3);
            const semanticWeight = (args as any).semanticWeight ?? 0.4;

            const result = await this.mg.search(query, { maxResults, maxHops, semanticWeight });
            const context = this.mg.context(result);

            return {
              content: [
                {
                  type: 'text',
                  text: context,
                },
              ],
            };
          }

          case 'memgrid_add': {
            let { summary, description } = args as any;
            const { sourceFile, codeSnippet, _styleNotes, associations, status, domain } = args as any;
            let { type } = args as any;

            // NLP auto-detect: if no type provided, parse from description
            if (!type && summary) {
              const { parseMemoryInput } = await import('../learn/nlp.js');
              const parsed = parseMemoryInput(summary + ' ' + (description || ''), sourceFile);
              type = parsed.type;
              summary = parsed.summary;
              description = parsed.narrative || description;
            }

            const allValidTypes = [...VALID_TYPES, ...LEGACY_ACCEPTED];
            if (!allValidTypes.includes(type)) {
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      'Invalid type: "' +
                      type +
                      '". Must be one of: ' +
                      [...VALID_TYPES, ...LEGACY_ACCEPTED.map((t) => t + ' (legacy)')].join(', '),
                  },
                ],
                isError: true,
              };
            }

            const id = type + '_' + Date.now();
            const isActive = status === 'active';
            const unit = await this.mg.add({
              id,
              type: type,
              domain: domain || undefined,
              summary,
              narrative: description || summary,
              code_snippet: codeSnippet,
              source: sourceFile ? { file: sourceFile } : undefined,
              keywords: [],
              associations: (associations || []).map((a: any) => ({
                to: a.to,
                relation: a.relation,
                weight: a.weight || 0.8,
              })),
              meta: {
                status: isActive ? 'active' : 'candidate',
              },
              provenance: {
                createdBy: isActive ? 'user' : 'ai:claude',
                basedOnTask: `Manual add: ${summary}`,
                timestamp: new Date().toISOString(),
              },
            } as any);

            const statusLabel = isActive ? 'active' : 'candidate';
            return {
              content: [
                {
                  type: 'text',
                  text:
                    '✅ Memory unit added (' +
                    statusLabel +
                    '): ' +
                    unit.id +
                    '\nType: ' +
                    unit.type +
                    '\nSummary: ' +
                    unit.summary +
                    '\nConfidence: ' +
                    unit.meta.confidence +
                    (isActive ? '' : '\n⚠️  Candidate — needs review before searchable'),
                },
              ],
            };
          }

          case 'memgrid_suggest': {
            const { taskSummary, outcome, filesModified } = args as any;
            const suggestions = await this.mg.analyzeTask({
              summary: taskSummary,
              outcome: outcome,
              filesModified: filesModified || [],
            });

            // v0.8: apply suggestions as CANDIDATE, not active
            const applied = await this.mg.applySuggestions(suggestions, { status: 'candidate' });

            const text =
              this.mg.formatSuggestions(suggestions) +
              '\n### 📝 Candidates (need review)\n' +
              applied.map((a: string) => '  ' + a).join('\n') +
              '\n\n⚠️ These are candidate memories. They will NOT appear in search results until confirmed.' +
              '\nUse memgrid_review to accept or reject them.';

            return { content: [{ type: 'text', text }] };
          }

          case 'memgrid_review': {
            const { action, unitId } = args as any;
            const allUnits = this.mg.store.listUnitsSync?.() || [];
            const candidates = allUnits.filter((u) => u.meta.status === 'candidate');

            switch (action) {
              case 'list': {
                if (candidates.length === 0) {
                  return {
                    content: [{ type: 'text', text: '✅ No candidate memories pending review.' }],
                  };
                }
                const lines = [
                  `📋 ${candidates.length} candidate memory unit(s) pending review:\n`,
                ];
                for (const c of candidates) {
                  const creator = c.provenance?.createdBy || 'unknown';
                  const task = c.provenance?.basedOnTask
                    ? ` — ${c.provenance.basedOnTask.slice(0, 60)}`
                    : '';
                  lines.push(
                    `  [${c.id}] ${c.type} | ${c.summary.slice(0, 80)}\n` +
                      `      confidence: ${c.meta.confidence} | from: ${creator}${task}`,
                  );
                }
                lines.push(
                  '\nUse memgrid_review --action accept --unitId <id> to confirm.' +
                    '\nUse memgrid_review --action accept-all to confirm all.' +
                    '\nUse memgrid_review --action reject --unitId <id> to archive.',
                );
                return { content: [{ type: 'text', text: lines.join('\n') }] };
              }

              case 'accept': {
                if (!unitId) {
                  return {
                    content: [{ type: 'text', text: '❌ unitId required for accept action' }],
                    isError: true,
                  };
                }
                const unit = allUnits.find((u) => u.id === unitId);
                if (!unit) {
                  return {
                    content: [{ type: 'text', text: '❌ Unit not found: ' + unitId }],
                    isError: true,
                  };
                }
                await this.mg.acceptCandidate(unitId);
                return {
                  content: [
                    {
                      type: 'text',
                      text: `✅ Accepted: [${unitId}] ${unit.summary.slice(0, 80)}\n   Now searchable as active.`,
                    },
                  ],
                };
              }

              case 'reject': {
                if (!unitId) {
                  return {
                    content: [{ type: 'text', text: '❌ unitId required for reject action' }],
                    isError: true,
                  };
                }
                const unit = allUnits.find((u) => u.id === unitId);
                if (!unit) {
                  return {
                    content: [{ type: 'text', text: '❌ Unit not found: ' + unitId }],
                    isError: true,
                  };
                }
                await this.mg.archive(unitId);
                return {
                  content: [
                    {
                      type: 'text',
                      text: `🗑️  Rejected: [${unitId}] ${unit.summary.slice(0, 80)}\n   Archived (not searchable).`,
                    },
                  ],
                };
              }

              case 'accept-all': {
                if (candidates.length === 0) {
                  return {
                    content: [{ type: 'text', text: 'No candidates to accept.' }],
                  };
                }
                let count = 0;
                for (const c of candidates) {
                  await this.mg.acceptCandidate(c.id);
                  count++;
                }
                return {
                  content: [
                    {
                      type: 'text',
                      text: `✅ Accepted all ${count} candidate unit(s). Now searchable.`,
                    },
                  ],
                };
              }

              case 'reject-all': {
                if (candidates.length === 0) {
                  return {
                    content: [{ type: 'text', text: 'No candidates to reject.' }],
                  };
                }
                let count = 0;
                for (const c of candidates) {
                  await this.mg.archive(c.id);
                  count++;
                }
                return {
                  content: [
                    {
                      type: 'text',
                      text: `🗑️  Rejected all ${count} candidate unit(s). Archived.`,
                    },
                  ],
                };
              }

              default:
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Unknown action: ${action}. Use accept/reject/list/accept-all/reject-all.`,
                    },
                  ],
                  isError: true,
                };
            }
          }

          case 'memgrid_conflicts': {
            const conflicts = this.mg.detectConflicts();

            if (conflicts.length === 0) {
              return {
                content: [{ type: 'text', text: '✅ No conflicting memory units detected.' }],
              };
            }

            const lines = [`⚠️  ${conflicts.length} potential conflict(s) detected:\n`];
            for (const c of conflicts) {
              const icon = c.hasOpposition ? '🔴' : '🟡';
              lines.push(
                `${icon} [${c.unitA.type}] overlap=${c.overlapScore.toFixed(2)}`,
                `   A: ${c.unitA.summary.slice(0, 80)}`,
                `   B: ${c.unitB.summary.slice(0, 80)}`,
              );
              if (c.hasOpposition) {
                lines.push(`   ⚠️  These express opposing views.`);
              }
              lines.push(
                `   IDs: ${c.unitA.id} | ${c.unitB.id}`,
                `   Resolve: archive one via memgrid_review reject, or keep both if complementary.`,
                '',
              );
            }

            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          case 'memgrid_rebalance': {
            const result = await this.mg.rebalance();
            const lines = [
              '⚖️  Memory tiers rebalanced:\n',
              `  🔥 Hot:    ${result.hot}`,
              `  🌤️  Warm:   ${result.warm}`,
              `  ❄️  Cold:   ${result.cold}`,
              `  🧊 Frozen:  ${result.frozen}`,
              `  🔼 Promoted:  ${result.promoted}`,
              `  🔽 Demoted:   ${result.demoted}`,
            ];
            if (result.frozenCount > 0) {
              lines.push(
                `\n💤 ${result.frozenCount} unit(s) frozen — use memgrid_search_frozen to find them.`,
              );
            }
            lines.push('\n✅ Rebalance complete.');
            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          case 'memgrid_search_frozen': {
            const { clue } = args as any;
            const results = this.mg.searchFrozen(clue);

            if (results.length === 0) {
              return {
                content: [{ type: 'text', text: 'No frozen memories match this clue.' }],
              };
            }

            const lines = [`💤 ${results.length} frozen memory unit(s) match "${clue}":\n`];
            for (const unit of results) {
              lines.push(
                `  [${unit.id}] ${unit.type}`,
                `  ${unit.summary.slice(0, 100)}`,
                unit.meta.lastAccessedAt ? `  Last access: ${unit.meta.lastAccessedAt}` : '',
                `  → Thaw with: memgrid_thaw ${unit.id}`,
                '',
              );
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          case 'memgrid_thaw': {
            const { unitId } = args as any;
            const unit = await this.mg.thaw(unitId);
            if (unit) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `🔥 Thawed: [${unit.id}] ${unit.summary.slice(0, 80)}\n   Back to warm tier — now searchable.`,
                  },
                ],
              };
            }
            return {
              content: [{ type: 'text', text: `❌ Unit not found or not frozen: ${unitId}` }],
              isError: true,
            };
          }

          case 'memgrid_update': {
            const { unitId, type, summary, description, domain, keywords, confidence, status } =
              args as any;
            const patch: any = {};
            if (type) patch.type = type;
            if (summary) patch.summary = summary;
            if (description) patch.narrative = description;
            if (domain) patch.domain = domain;
            if (keywords) patch.keywords = keywords;
            if (confidence !== undefined) patch.meta = { confidence };
            if (status) patch.meta = { ...patch.meta, status };

            const unit = await this.mg.update(unitId, patch);
            if (unit) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `✏️ Updated: [${unit.id}] ${unit.summary.slice(0, 80)}`,
                  },
                ],
              };
            }
            return {
              content: [{ type: 'text', text: `❌ Unit not found: ${unitId}` }],
              isError: true,
            };
          }

          case 'memgrid_archive': {
            const { unitId } = args as any;
            await this.mg.archive(unitId);
            return {
              content: [
                { type: 'text', text: `🗄️  Archived: ${unitId}\n   Excluded from search results.` },
              ],
            };
          }

          case 'memgrid_extract': {
            const { conversation, domain, autoAccept } = args as any;
            const { raw } = this.mg.extract.extract(conversation || '');

            if (raw.length === 0) {
              return {
                content: [
                  { type: 'text', text: 'No memory candidates extracted from conversation.' },
                ],
              };
            }

            const saved: string[] = [];
            for (const candidate of raw) {
              const status = autoAccept && candidate.confidence >= 0.8 ? 'active' : 'candidate';
              const unit = this.mg.extract.toMemoryUnit(
                candidate,
                domain || 'conversation',
                status,
              );
              // Check for near-duplicates before saving
              const existing = this.mg.store.listUnitsSync({ includeCandidate: true }) || [];
              const isDuplicate = existing.some(
                (u) =>
                  u.summary.slice(0, 40).toLowerCase() ===
                  candidate.summary.slice(0, 40).toLowerCase(),
              );
              if (!isDuplicate) {
                this.mg.store.saveUnit(unit);
                saved.push(`${unit.id}: [${unit.type}] ${unit.summary}`);
              }
            }

            const statusLabel = autoAccept ? ' (auto-accepted high-confidence)' : '';
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `🧠 Extracted ${raw.length} candidate(s)${statusLabel}, saved ${saved.length} new unit(s):\n\n` +
                    saved.map((s) => `  ${s}`).join('\n') +
                    '\n\nUse memgrid_review to accept or reject candidates.',
                },
              ],
            };
          }

          default:
            return {
              content: [{ type: 'text', text: `Unknown tool: ${name}` }],
              isError: true,
            };
        }
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

// CLI entry point
export async function startMCPServer(projectRoot: string) {
  const server = new MemGridServer(projectRoot);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

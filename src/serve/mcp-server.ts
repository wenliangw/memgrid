import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MemGrid } from '../memgrid.js';
import type { MemoryUnitType } from '../shared/types.js';

const VALID_TYPES: MemoryUnitType[] = [
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
                  'Unit type: method, pattern, config, error_solution, decision, ' +
                  'skill_trigger, mcp_trigger, rule_trigger, style_preference, architecture_principle',
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
            const { sourceFile, codeSnippet, styleNotes, associations, status } = args as any;
            let { type } = args as any;

            // NLP auto-detect: if no type provided, parse from description
            if (!type && summary) {
              const { parseMemoryInput } = await import('../learn/nlp.js');
              const parsed = parseMemoryInput(summary + ' ' + (description || ''), sourceFile);
              type = parsed.type;
              summary = parsed.summary;
              description = parsed.content.description || description;
            }

            if (!VALID_TYPES.includes(type)) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Invalid type: "' + type + '". Must be one of: ' + VALID_TYPES.join(', '),
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
              summary,
              content: {
                description,
                code_snippet: codeSnippet,
                style_notes: styleNotes,
              },
              source: sourceFile ? { file: sourceFile } : undefined,
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

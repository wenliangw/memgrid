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
      { name: 'memgrid', version: '0.4.0' },
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
            'Add or update a memory unit in the grid. Use this after completing a task ' +
            'to record what you learned: new methods, mistakes fixed, design decisions, ' +
            'or style preferences discovered.',
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
            'After completing a coding task, ask MemGrid to suggest which memory units ' +
            'should be added, updated, or archived. MemGrid analyzes the task outcome ' +
            'and compares against existing grid knowledge.',
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
            const { sourceFile, codeSnippet, styleNotes, associations } = args as any;
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
            });

            return {
              content: [
                {
                  type: 'text',
                  text:
                    '✅ Memory unit added: ' +
                    unit.id +
                    '\nType: ' +
                    unit.type +
                    '\nSummary: ' +
                    unit.summary +
                    '\nConfidence: ' +
                    unit.meta.confidence,
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
            const applied = await this.mg.applySuggestions(suggestions);
            const text =
              this.mg.formatSuggestions(suggestions) +
              '\n### ✅ Auto-applied\n' +
              applied.map((a: string) => '  ' + a).join('\n') +
              '\n\nRun memgrid sync to persist these changes.';
            return { content: [{ type: 'text', text }] };
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

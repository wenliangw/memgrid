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
  'method', 'component', 'pattern', 'config', 'error_solution',
  'decision', 'skill_trigger', 'mcp_trigger', 'rule_trigger',
  'style_preference', 'architecture_principle',
];

export class MemGridServer {
  private server: Server;
  private mg: MemGrid;

  constructor(projectRoot: string) {
    this.mg = new MemGrid(projectRoot);
    this.server = new Server(
      { name: 'memgrid', version: '0.2.0' },
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
                description: 'Unit type: method, pattern, config, error_solution, decision, ' +
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

            const result = await this.mg.search(query, { maxResults, maxHops });
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
            const { type, summary, description, sourceFile, codeSnippet, styleNotes, associations } =
              args as any;

            if (!VALID_TYPES.includes(type)) {
              return {
                content: [{ type: 'text', text: `Invalid type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}` }],
                isError: true,
              };
            }

            const id = `${type}_${Date.now()}`;
            const unit = await this.mg.add({
              id,
              type: type as MemoryUnitType,
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
                  text: `✅ Memory unit added: ${unit.id}\nType: ${unit.type}\nSummary: ${unit.summary}\nConfidence: ${unit.meta.confidence}`,
                },
              ],
            };
          }

          case 'memgrid_suggest': {
            const { taskSummary, outcome, filesModified } = args as any;

            // Search for existing units related to this task
            const result = await this.mg.search(taskSummary, { maxResults: 5, maxHops: 1 });

            const suggestions: string[] = [];
            suggestions.push(`## 📋 MemGrid Suggestions for: "${taskSummary}"\n`);

            // Suggest new method units for modified files
            if (filesModified && filesModified.length > 0) {
              const existingFiles = new Set(
                result.units
                  .filter((u) => u.source?.file)
                  .map((u) => u.source!.file),
              );
              const newFiles = filesModified.filter((f: string) => !existingFiles.has(f));

              if (newFiles.length > 0) {
                suggestions.push(
                  `### 💡 Suggested new method units (${newFiles.length} new files):`,
                );
                for (const file of newFiles) {
                  suggestions.push(`- Scan \`${file}\` with \`memgrid_init\` to extract methods`);
                }
                suggestions.push('');
              }
            }

            // Suggest updates for existing relevant units
            if (result.units.length > 0) {
              suggestions.push(`### 🔄 Related existing units (${result.units.length} found):`);
              for (const unit of result.units.slice(0, 5)) {
                suggestions.push(`- \`${unit.id}\` — ${unit.summary}`);
              }
              suggestions.push('\nReview and update if the task changed their behavior.');
            }

            // Suggest error_solution if outcome mentions fixes
            const fixKeywords = ['fix', 'bug', 'error', 'OOM', 'crash', '修复', '错误'];
            if (fixKeywords.some((k) => taskSummary.toLowerCase().includes(k) || outcome.toLowerCase().includes(k))) {
              suggestions.push('### 🐛 Suggested error_solution unit:');
              suggestions.push(`- Record this fix: what was the error, and what was the solution?`);
              suggestions.push(`- Use \`memgrid_add --type error_solution\` to add it.`);
              suggestions.push('');
            }

            // Suggest decision unit if the task seems architectural
            const decisionKeywords = ['refactor', 'architecture', 'pattern', 'design', '重构', '架构'];
            if (decisionKeywords.some((k) => taskSummary.includes(k))) {
              suggestions.push('### 🎯 Suggested decision unit:');
              suggestions.push('- Record why this architectural decision was made.');
              suggestions.push('- Use `memgrid_add --type decision` to capture the rationale.');
              suggestions.push('');
            }

            if (suggestions.length <= 2) {
              suggestions.push('No strong suggestions. The grid may not need updates for this task.');
            }

            return {
              content: [{ type: 'text', text: suggestions.join('\n') }],
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

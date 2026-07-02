import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { execSync } from 'node:child_process';

interface AgentEndEvent {
  messages: Array<{ role: string; content: string }>;
  success: boolean;
  durationMs: number;
  context: { agentId?: string; sessionKey?: string; domain?: string };
}

export default definePluginEntry({
  id: 'memgrid-agent',
  name: 'MemGrid Agent Memory',
  description: 'Auto-saves conversation memories after each agent turn via MemGrid.',
  version: '0.1.0',
  register(api) {
    api.on('agent_end', async (event: AgentEndEvent) => {
      // Only process successful turns
      if (!event.success) return;

      const messages = event.messages ?? [];
      const userMessages = messages.filter((m) => m.role === 'user');
      const assistantMessages = messages.filter((m) => m.role === 'assistant');

      if (userMessages.length === 0 || assistantMessages.length === 0) return;

      // Build conversation text for extraction
      const conversation = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
        .join('\n\n');

      // Determine domain from agent context
      const domain = event.context?.domain ?? 'agent';

      try {
        // Step 1: Extract candidates
        const extractResult = execSync(`memgrid extract --domain "${domain}" --stdin`, {
          input: conversation,
          timeout: 10000,
          encoding: 'utf-8',
        }).toString();

        // Step 2: If candidates found, auto-accept high-confidence ones
        if (extractResult.includes('candidates')) {
          execSync(`memgrid review accept-all --domain "${domain}"`, {
            timeout: 5000,
          });
        }
      } catch (err) {
        // Silently fail — don't block the agent turn for memory errors
        console.error('[memgrid-agent] Memory extraction failed:', err);
      }
    });
  },
});

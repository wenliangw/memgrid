import * as fs from 'fs';
import * as path from 'path';

const STARTUP_SECTION = `## 启动流程

**每次任务开始时，必须先执行：**

\`\`\`bash
npx memgrid search "<任务关键词>" --max 10
\`\`\`

这会从项目的记忆网格中检索最相关的上下文：

- 方法签名与实现
- 设计模式与规则
- 代码哲学与决策
- 项目结构与配置`;

const END_SECTION = `## 结束流程

**每次代码变更完成后，必须执行：**

\`\`\`bash
npx memgrid sync
\`\`\`

这不是可选的——是任务结束的强制步骤。MemGrid 会增量分析代码变更，将新的方法签名、设计模式、决策等写入记忆网格，确保下一次任务启动时知识是最新的。`;

export function injectMemGridFlow(
  projectRoot: string,
): { action: 'created' | 'injected' | 'skipped' } {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');

  if (!fs.existsSync(claudeMdPath)) {
    const content = `# Project\n\n${STARTUP_SECTION}\n\n${END_SECTION}\n`;
    fs.writeFileSync(claudeMdPath, content, 'utf-8');
    return { action: 'created' };
  }

  const existing = fs.readFileSync(claudeMdPath, 'utf-8');
  const hasSearch = existing.includes('memgrid search');
  const hasSync = existing.includes('memgrid sync');

  if (hasSearch && hasSync) {
    return { action: 'skipped' };
  }

  let modified = existing;

  // Inject startup section after the first # heading line
  if (!hasSearch) {
    const headingMatch = modified.match(/^# .+$/m);
    if (headingMatch && headingMatch.index !== undefined) {
      const insertAt = headingMatch.index + headingMatch[0].length;
      modified = modified.slice(0, insertAt) + '\n\n' + STARTUP_SECTION + '\n' + modified.slice(insertAt);
    } else {
      modified = STARTUP_SECTION + '\n\n' + modified;
    }
  }

  // Append end section
  if (!hasSync) {
    modified = modified.trimEnd() + '\n\n' + END_SECTION + '\n';
  }

  fs.writeFileSync(claudeMdPath, modified, 'utf-8');
  return { action: 'injected' };
}

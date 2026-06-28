import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkArchitecture } from '../src/sync/phases/architecture.js';
import type { MemoryUnit } from '../src/shared/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeMemoryUnit(overrides: Partial<MemoryUnit> = {}): MemoryUnit {
  return {
    id: 'test_id',
    type: 'architecture_principle',
    summary: 'Test principle',
    signatures: [],
    content: { description: 'Test' },
    associations: [],
    meta: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      confidence: 1.0,
      usage_count: 0,
      status: 'active',
    },
    ...overrides,
  };
}

describe('checkArchitecture (Phase 5)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return path.relative(tmpDir, filePath);
  }

  it('alerts on forwardRef usage', () => {
    const file = writeFile(
      'module.ts',
      'import { forwardRef } from "@nestjs/common"; forwardRef(() => Other);',
    );

    const unitMap = new Map<string, MemoryUnit>();
    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    const fwdAlerts = alerts.filter((a) => a.message.includes('forwardRef'));
    expect(fwdAlerts.length).toBeGreaterThanOrEqual(1);
  });

  it('alerts on as any type assertion', () => {
    const file = writeFile('service.ts', 'const x = something as any;');

    const unitMap = new Map<string, MemoryUnit>();
    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    const anyAlerts = alerts.filter((a) => a.message.includes('any'));
    expect(anyAlerts.length).toBeGreaterThanOrEqual(1);
  });

  it('alerts on empty catch block', () => {
    const file = writeFile('handler.ts', 'try { riskyCall(); } catch (e) { }');

    const unitMap = new Map<string, MemoryUnit>();
    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    const catchAlerts = alerts.filter((a) => a.message.includes('Empty catch'));
    expect(catchAlerts.length).toBeGreaterThanOrEqual(1);
  });

  it('does not alert on non-empty catch block', () => {
    const file = writeFile('handler.ts', 'try { riskyCall(); } catch (e) { logger.error(e); }');

    const unitMap = new Map<string, MemoryUnit>();
    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    const catchAlerts = alerts.filter((a) => a.message.includes('Empty catch'));
    expect(catchAlerts.length).toBe(0);
  });

  it('checks against architecture_principle units', () => {
    const file = writeFile(
      'module.ts',
      "import { forwardRef } from '@nestjs/common'; forwardRef(() => OtherModule);",
    );

    const principle: MemoryUnit = makeMemoryUnit({
      id: 'principle_no_forwardref',
      type: 'architecture_principle',
      summary: '禁止 forwardRef 绕过循环引用',
      content: {
        description: '禁止 forwardRef() 补丁式修复，应该拆 barrel export',
      },
    });

    const unitMap = new Map<string, MemoryUnit>();
    unitMap.set(principle.id, principle);

    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    // Architecture checker uses text matching: if principle summary
    // contains 'forwardref' + '禁止' AND code contains 'forwardRef(', fire alert
    const fwdAlerts = alerts.filter((a) => a.message.includes('forwardRef'));
    expect(fwdAlerts.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates alerts by message+file', () => {
    const file = writeFile('bad.ts', 'const x = a as any; const y = b as any;');

    const unitMap = new Map<string, MemoryUnit>();
    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    const anyAlerts = alerts.filter((a) => a.message.includes('any'));
    expect(anyAlerts.length).toBe(1); // deduplicated
  });

  it('returns empty for clean code', () => {
    const file = writeFile('clean.ts', 'const x: string = "hello";');

    const unitMap = new Map<string, MemoryUnit>();
    const { alerts } = checkArchitecture(tmpDir, [file], unitMap);

    expect(alerts.length).toBe(0);
  });
});

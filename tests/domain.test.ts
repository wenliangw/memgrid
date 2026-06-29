import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DomainManager } from '../src/domain/domain-manager.js';

describe('DomainManager (v0.10)', () => {
  let tmpDir: string;
  let dm: DomainManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-domain-'));
    dm = new DomainManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initUserGrid creates mesh.json and personality directory', () => {
    const result = dm.initUserGrid();
    expect(result.created).toBe(true);

    expect(fs.existsSync(path.join(tmpDir, 'mesh.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'personality'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'sessions'))).toBe(true);

    const mesh = JSON.parse(fs.readFileSync(path.join(tmpDir, 'mesh.json'), 'utf-8'));
    expect(mesh.version).toBe('1.0');
    expect(mesh.domains.length).toBeGreaterThanOrEqual(1);
    expect(mesh.domains[0].name).toBe('personality');
  });

  it('initUserGrid is idempotent', () => {
    dm.initUserGrid();
    const result = dm.initUserGrid();
    expect(result.created).toBe(false);
  });

  it('registerDomain adds a new domain', () => {
    dm.initUserGrid();
    const domain = dm.registerDomain({
      name: 'test-project',
      type: 'project',
      path: '/tmp/test/.memgrid',
      description: 'Test project',
      enabled: true,
    });

    expect(domain.name).toBe('test-project');
    const list = dm.listDomains();
    expect(list.length).toBe(2); // personality + test-project
    expect(list.find((d) => d.name === 'test-project')).toBeDefined();
  });

  it('registerDomain updates existing domain path', () => {
    dm.initUserGrid();
    dm.registerDomain({
      name: 'test-project',
      type: 'project',
      path: '/old/path',
      enabled: true,
    });
    dm.registerDomain({
      name: 'test-project',
      type: 'project',
      path: '/new/path',
      enabled: true,
    });

    const domain = dm.getDomain('test-project');
    expect(domain!.path).toBe('/new/path');
  });

  it('getDomain returns null for unknown domain', () => {
    dm.initUserGrid();
    expect(dm.getDomain('nonexistent')).toBeNull();
  });

  it('unregisterDomain removes a domain', () => {
    dm.initUserGrid();
    dm.registerDomain({
      name: 'temp-project',
      type: 'project',
      path: '/tmp/path',
      enabled: true,
    });

    expect(dm.unregisterDomain('temp-project')).toBe(true);
    expect(dm.getDomain('temp-project')).toBeNull();
  });

  it('unregisterDomain returns false for unknown', () => {
    dm.initUserGrid();
    expect(dm.unregisterDomain('nonexistent')).toBe(false);
  });

  it('detectDomainName from package.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'my-cool-app' }));
    expect(DomainManager.detectDomainName(tmp)).toBe('my-cool-app');
    fs.rmSync(tmp, { recursive: true });
  });

  it('detectDomainName falls back to directory name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-'));
    // No package.json — use directory name
    const dirName = path.basename(tmp);
    expect(DomainManager.detectDomainName(tmp)).toBe(dirName);
    fs.rmSync(tmp, { recursive: true });
  });

  it('detectDomainType detects project from package.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-type-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    expect(DomainManager.detectDomainType(tmp)).toBe('project');
    fs.rmSync(tmp, { recursive: true });
  });

  it('detectDomainType detects project from go.mod', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-type-'));
    fs.writeFileSync(path.join(tmp, 'go.mod'), 'module example');
    expect(DomainManager.detectDomainType(tmp)).toBe('project');
    fs.rmSync(tmp, { recursive: true });
  });

  it('detectDomainType defaults to custom', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-type-'));
    expect(DomainManager.detectDomainType(tmp)).toBe('custom');
    fs.rmSync(tmp, { recursive: true });
  });
});

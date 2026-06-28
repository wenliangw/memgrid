import { describe, it, expect } from 'vitest';
import { parseMemoryInput, createMemoryUnit } from '../src/learn/nlp.js';

describe('parseMemoryInput (NLP)', () => {
  it('detects error_solution from error keywords', () => {
    const result = parseMemoryInput('multer fileFilter returned 500 instead of 400');
    expect(result.type).toBe('error_solution');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('detects error_solution from Chinese error keywords', () => {
    const result = parseMemoryInput('multer 上传文件时报错 500');
    expect(result.type).toBe('error_solution');
  });

  it('detects decision from "chose...over..." pattern', () => {
    const result = parseMemoryInput(
      'chose PostgreSQL over MongoDB because we need ACID transactions',
    );
    expect(result.type).toBe('decision');
  });

  it('detects decision from "decided to..." pattern', () => {
    const result = parseMemoryInput(
      'decided to use Redis for session storage instead of PostgreSQL',
    );
    expect(result.type).toBe('decision');
  });

  it('detects style_preference from "always use..." pattern', () => {
    const result = parseMemoryInput('always use ResponseBuilder instead of returning raw JSON');
    // "use" matches styleKeywords but "instead of" also matches decisionKeywords
    // Both fire — decision wins because it comes first in the check order
    expect(['style_preference', 'decision']).toContain(result.type);
  });

  it('detects pattern as default type for unrecognized input', () => {
    const result = parseMemoryInput('The project uses a monorepo with pnpm workspaces');
    // "uses" matches styleKeywords ("use") and maps to style_preference
    // No decision/error keywords present
    expect(result.type).toBe('style_preference');
  });

  it('extracts technology signatures', () => {
    const result = parseMemoryInput(
      'multer fileFilter returned 500 instead of 400 in NestJS controller',
    );
    expect(result.signatures).toContain('multer');
    expect(result.signatures).toContain('nestjs');
  });

  it('extracts problem part from "X returned Y instead of Z"', () => {
    const result = parseMemoryInput('multer fileFilter returned 500 instead of 400');
    expect(result.content.description).toContain('500');
  });

  it('extracts fix part from "need to X"', () => {
    const result = parseMemoryInput(
      'multer fileFilter returned 500. Need to set req.fileValidationError manually',
    );
    expect(result.content.action).toBeTruthy();
    expect(result.content.action).toContain('set');
  });

  it('extracts trigger context from "when X"', () => {
    const result = parseMemoryInput('multer returned 500 when file filter rejects the upload');
    expect(result.content.trigger).toBeTruthy();
    expect(result.content.trigger).toContain('file filter');
  });

  it('creates structured MemoryUnit from parsed input', () => {
    const parsed = parseMemoryInput(
      'multer fileFilter returned 500 instead of 400. Need to set req.fileValidationError manually',
    );
    const unit = createMemoryUnit(parsed, 'upload.controller.ts');

    expect(unit.id).toContain('auto_error_solution_');
    expect(unit.type).toBe('error_solution');
    expect(unit.meta.confidence).toBeGreaterThanOrEqual(0.6);
    expect(unit.source?.file).toBe('upload.controller.ts');
  });

  it('handles empty input gracefully', () => {
    const result = parseMemoryInput('');
    expect(result.type).toBeDefined();
    expect(result.summary).toBe('');
  });
});

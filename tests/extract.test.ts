import { describe, it, expect } from 'vitest';
import { ExtractEngine } from '../src/extract/index.js';

describe('ExtractEngine', () => {
  const engine = new ExtractEngine();

  it('extracts decision candidates from "decided to..." text', () => {
    const { raw } = engine.extract(
      'We decided to use Redis for session storage instead of PostgreSQL. This is because Redis has better performance for ephemeral data.',
    );

    expect(raw.length).toBeGreaterThanOrEqual(1);
    const decision = raw.find((c) => c.type === 'insight');
    expect(decision).toBeDefined();
    expect(decision!.summary).toContain('decided');
    expect(decision!.keywords.length).toBeGreaterThan(0);
  });

  it('extracts preference candidates from "always use..." text', () => {
    const { raw } = engine.extract(
      'Always use the ResponseBuilder class for API responses. Never return raw JSON objects.',
    );

    expect(raw.length).toBeGreaterThanOrEqual(1);
    const pref = raw.find((c) => c.type === 'preference');
    expect(pref).toBeDefined();
    expect(pref!.keywords.length).toBeGreaterThan(0);
  });

  it('extracts event candidates from "deployed..." text', () => {
    const { raw } = engine.extract(
      'Today we deployed v0.9.0 to production. The release includes the new tiered storage system.',
    );

    expect(raw.length).toBeGreaterThanOrEqual(1);
    const event = raw.find((c) => c.type === 'event');
    expect(event).toBeDefined();
  });

  it('extracts fact candidates from architecture text', () => {
    const { raw } = engine.extract(
      'The system uses NestJS 11 with TypeORM, PostgreSQL 16 as the primary database, and Redis 7 for caching.',
    );

    expect(raw.length).toBeGreaterThanOrEqual(1);
    const fact = raw.find((c) => c.type === 'fact');
    expect(fact).toBeDefined();
  });

  it('returns empty for very short text', () => {
    const { raw } = engine.extract('Hi.');
    expect(raw.length).toBe(0);
  });

  it('deduplicates similar candidates', () => {
    const { raw } = engine.extract(
      'We decided to use Redis for caching. We decided to use Kafka for events.',
    );

    // Two different decisions, should not be deduped
    expect(raw.length).toBeGreaterThanOrEqual(1);
  });

  it('converts candidates to MemoryUnit format', () => {
    const candidate = {
      type: 'insight' as const,
      summary: 'Chose PostgreSQL over MongoDB',
      narrative: 'We chose PostgreSQL over MongoDB for ACID compliance and team expertise.',
      keywords: ['postgresql', 'database', 'decision'],
      confidence: 0.75,
      sourceText: 'We chose PostgreSQL over MongoDB',
    };

    const unit = engine.toMemoryUnit(candidate, 'test-domain');
    expect(unit.type).toBe('insight');
    expect(unit.summary).toContain('PostgreSQL');
    expect(unit.domain).toBe('test-domain');
    expect(unit.meta.status).toBe('candidate'); // confidence < 0.8
    expect(unit.narrative).toBe(candidate.narrative);
  });

  it('auto-accepts high-confidence candidates', () => {
    const engineHigh = new ExtractEngine({ autoActivateThreshold: 0.5 });
    const candidate = {
      type: 'fact' as const,
      summary: 'Tech stack: Next.js + NestJS',
      narrative: 'Frontend uses Next.js 16, backend uses NestJS 11.',
      keywords: ['nextjs', 'nestjs', 'tech-stack'],
      confidence: 0.9,
      sourceText: 'Frontend uses Next.js 16',
    };

    const unit = engineHigh.toMemoryUnit(candidate, 'test');
    expect(unit.meta.status).toBe('active'); // confidence 0.9 > threshold 0.5
  });

  it('builds refinement prompt from candidates', () => {
    const candidates = [
      {
        type: 'insight' as const,
        summary: 'Chose Redis',
        narrative: 'We chose Redis for caching.',
        keywords: ['redis'],
        confidence: 0.6,
        sourceText: 'We chose Redis for caching.',
      },
    ];

    const prompt = engine.buildRefinementPrompt(candidates);
    expect(prompt).toContain('Redis');
    expect(prompt).toContain('Extract memory units');
    expect(prompt).toContain('JSON');
  });

  it('returns null prompt for empty candidates', () => {
    expect(engine.buildRefinementPrompt([])).toBeNull();
  });

  it('handles Chinese text', () => {
    const { raw } = engine.extract(
      '我们决定用 Redis 代替数据库做缓存。以后都用 ResponseBuilder 返回 API 响应。',
    );

    expect(raw.length).toBeGreaterThanOrEqual(1);
    const hasDecision = raw.some((c) => c.type === 'insight');
    const hasPreference = raw.some((c) => c.type === 'preference');
    expect(hasDecision || hasPreference).toBe(true);
  });
});

// ============================================================================
// Tests for Connection 11: Stigmergy ↔ Emergence Engine Bridge
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  findConvergentTrails,
  classifyTrailAsEmergence,
  detectEmergenceFromField,
  emergenceToPheromone,
  type Pheromone,
} from '../connections/11-stigmergy-emergence-bridge.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function pheromone(overrides: Partial<Pheromone> = {}): Pheromone {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    type: 'TRAIL',
    position: { x: 0, y: 0 },
    strength: 0.5,
    agentId: 'agent-a',
    timestamp: Date.now(),
    halfLife: 60000,
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// findConvergentTrails
// ──────────────────────────────────────────────

describe('findConvergentTrails', () => {
  test('returns empty for no pheromones', () => {
    expect(findConvergentTrails([])).toEqual([]);
  });

  test('returns empty for single agent', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: 0, y: 0 } }),
      pheromone({ agentId: 'a', position: { x: 0.1, y: 0.1 } }),
    ];
    expect(findConvergentTrails(ps, 0.5, 2)).toHaveLength(0);
  });

  test('finds convergent trail from multiple agents', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: 0, y: 0 } }),
      pheromone({ agentId: 'b', position: { x: 0.1, y: 0.1 } }),
      pheromone({ agentId: 'c', position: { x: 0.05, y: 0.05 } }),
    ];
    const trails = findConvergentTrails(ps, 0.5, 2);
    expect(trails).toHaveLength(1);
    expect(trails[0].agents).toHaveLength(3);
  });

  test('separates distant clusters', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: 0, y: 0 } }),
      pheromone({ agentId: 'b', position: { x: 0.1, y: 0.1 } }),
      pheromone({ agentId: 'c', position: { x: 100, y: 100 } }),
      pheromone({ agentId: 'd', position: { x: 100.1, y: 100.1 } }),
    ];
    const trails = findConvergentTrails(ps, 0.5, 2);
    expect(trails).toHaveLength(2);
  });

  test('respects radius parameter', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: 0, y: 0 } }),
      pheromone({ agentId: 'b', position: { x: 2, y: 2 } }),
    ];
    expect(findConvergentTrails(ps, 1.0, 2)).toHaveLength(0);
    expect(findConvergentTrails(ps, 3.0, 2)).toHaveLength(1);
  });

  test('sorts by convergence descending', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: 0, y: 0 }, strength: 0.3 }),
      pheromone({ agentId: 'b', position: { x: 0.1, y: 0.1 }, strength: 0.3 }),
      pheromone({ agentId: 'c', position: { x: 10, y: 10 }, strength: 0.9 }),
      pheromone({ agentId: 'd', position: { x: 10.1, y: 10.1 }, strength: 0.9 }),
    ];
    const trails = findConvergentTrails(ps, 0.5, 2);
    expect(trails[0].totalStrength).toBeGreaterThanOrEqual(trails[1].totalStrength);
  });

  test('identifies dominant type', () => {
    const ps = [
      pheromone({ agentId: 'a', type: 'FOOD', position: { x: 0, y: 0 } }),
      pheromone({ agentId: 'b', type: 'FOOD', position: { x: 0.1, y: 0.1 } }),
      pheromone({ agentId: 'c', type: 'TRAIL', position: { x: 0.05, y: 0.05 } }),
    ];
    const trails = findConvergentTrails(ps, 0.5, 2);
    expect(trails[0].dominantType).toBe('FOOD');
  });

  test('handles NaN positions safely', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: NaN, y: 0 } }),
      pheromone({ agentId: 'b', position: { x: 0.1, y: 0.1 } }),
    ];
    // Should not crash, may or may not find a trail
    const trails = findConvergentTrails(ps, 0.5, 2);
    expect(Array.isArray(trails)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// classifyTrailAsEmergence
// ──────────────────────────────────────────────

describe('classifyTrailAsEmergence', () => {
  test('FOOD with high convergence → SYNERGY', () => {
    const trail = {
      location: { x: 0, y: 0 },
      agents: ['a', 'b', 'c'],
      totalStrength: 2.5,
      pheromoneCount: 5,
      dominantType: 'FOOD' as const,
      convergence: 0.85,
    };
    const pattern = classifyTrailAsEmergence(trail);
    expect(pattern.type).toBe('SYNERGY');
    expect(pattern.agentsInvolved).toHaveLength(3);
  });

  test('DANGER → CONFLICT', () => {
    const trail = {
      location: { x: 0, y: 0 },
      agents: ['a', 'b'],
      totalStrength: 1.0,
      pheromoneCount: 2,
      dominantType: 'DANGER' as const,
      convergence: 0.5,
    };
    const pattern = classifyTrailAsEmergence(trail);
    expect(pattern.type).toBe('CONFLICT');
  });

  test('RECRUIT → PHASE_TRANSITION', () => {
    const trail = {
      location: { x: 0, y: 0 },
      agents: ['a', 'b', 'c', 'd'],
      totalStrength: 3.0,
      pheromoneCount: 6,
      dominantType: 'RECRUIT' as const,
      convergence: 0.7,
    };
    const pattern = classifyTrailAsEmergence(trail);
    expect(pattern.type).toBe('PHASE_TRANSITION');
  });

  test('TERRITORY → INSIGHT', () => {
    const trail = {
      location: { x: 0, y: 0 },
      agents: ['a', 'b'],
      totalStrength: 1.0,
      pheromoneCount: 2,
      dominantType: 'TERRITORY' as const,
      convergence: 0.5,
    };
    const pattern = classifyTrailAsEmergence(trail);
    expect(pattern.type).toBe('INSIGHT');
  });

  test('TRAIL with low convergence → CREATIVITY', () => {
    const trail = {
      location: { x: 0, y: 0 },
      agents: ['a', 'b'],
      totalStrength: 0.6,
      pheromoneCount: 2,
      dominantType: 'TRAIL' as const,
      convergence: 0.3,
    };
    const pattern = classifyTrailAsEmergence(trail);
    expect(pattern.type).toBe('CREATIVITY');
  });

  test('description includes agent count', () => {
    const trail = {
      location: { x: 0, y: 0 },
      agents: ['a', 'b', 'c'],
      totalStrength: 1.5,
      pheromoneCount: 3,
      dominantType: 'FOOD' as const,
      convergence: 0.5,
    };
    const pattern = classifyTrailAsEmergence(trail);
    expect(pattern.description).toContain('3');
  });
});

// ──────────────────────────────────────────────
// detectEmergenceFromField (full pipeline)
// ──────────────────────────────────────────────

describe('detectEmergenceFromField', () => {
  test('returns empty for no pheromones', () => {
    expect(detectEmergenceFromField([])).toEqual([]);
  });

  test('detects emergence from convergent agents', () => {
    const ps = [
      pheromone({ agentId: 'a', type: 'FOOD', position: { x: 0, y: 0 }, strength: 0.8 }),
      pheromone({ agentId: 'b', type: 'FOOD', position: { x: 0.1, y: 0.1 }, strength: 0.8 }),
      pheromone({ agentId: 'c', type: 'FOOD', position: { x: 0.05, y: 0.05 }, strength: 0.8 }),
    ];
    const patterns = detectEmergenceFromField(ps, 0.5, 2);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].confidence).toBeGreaterThan(0);
  });

  test('filters low-confidence noise', () => {
    const ps = [
      pheromone({ agentId: 'a', position: { x: 0, y: 0 }, strength: 0.01 }),
      pheromone({ agentId: 'b', position: { x: 0.1, y: 0.1 }, strength: 0.01 }),
    ];
    const patterns = detectEmergenceFromField(ps, 0.5, 2);
    // Very weak signals should be filtered
    expect(patterns.length).toBe(0);
  });

  test('sorts by confidence', () => {
    const ps = [
      pheromone({ agentId: 'a', type: 'FOOD', position: { x: 0, y: 0 }, strength: 0.5 }),
      pheromone({ agentId: 'b', type: 'FOOD', position: { x: 0.1, y: 0.1 }, strength: 0.5 }),
      pheromone({ agentId: 'c', type: 'DANGER', position: { x: 20, y: 20 }, strength: 0.9 }),
      pheromone({ agentId: 'd', type: 'DANGER', position: { x: 20.1, y: 20.1 }, strength: 0.9 }),
    ];
    const patterns = detectEmergenceFromField(ps, 0.5, 2);
    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i - 1].confidence).toBeGreaterThanOrEqual(patterns[i].confidence);
    }
  });
});

// ──────────────────────────────────────────────
// emergenceToPheromone (feedback loop)
// ──────────────────────────────────────────────

describe('emergenceToPheromone', () => {
  test('SYNERGY → TRAIL pheromone', () => {
    const deposit = emergenceToPheromone({
      type: 'SYNERGY',
      confidence: 0.9,
      agentsInvolved: ['a', 'b'],
      description: 'test',
      timestamp: Date.now(),
      location: { x: 5, y: 5 },
    });
    expect(deposit).not.toBeNull();
    expect(deposit!.type).toBe('TRAIL');
    expect(deposit!.strength).toBe(0.9);
  });

  test('CONFLICT → DANGER pheromone', () => {
    const deposit = emergenceToPheromone({
      type: 'CONFLICT',
      confidence: 0.8,
      agentsInvolved: ['a', 'b'],
      description: 'test',
      timestamp: Date.now(),
      location: { x: 0, y: 0 },
    });
    expect(deposit!.type).toBe('DANGER');
  });

  test('INSIGHT → RECRUIT pheromone', () => {
    const deposit = emergenceToPheromone({
      type: 'INSIGHT',
      confidence: 0.7,
      agentsInvolved: ['a'],
      description: 'test',
      timestamp: Date.now(),
      location: { x: 0, y: 0 },
    });
    expect(deposit!.type).toBe('RECRUIT');
  });

  test('low confidence → null (no deposit)', () => {
    const deposit = emergenceToPheromone({
      type: 'SYNERGY',
      confidence: 0.1,
      agentsInvolved: ['a'],
      description: 'weak',
      timestamp: Date.now(),
      location: { x: 0, y: 0 },
    });
    expect(deposit).toBeNull();
  });

  test('uses custom agent ID', () => {
    const deposit = emergenceToPheromone({
      type: 'SYNERGY',
      confidence: 0.9,
      agentsInvolved: ['a', 'b'],
      description: 'test',
      timestamp: Date.now(),
      location: { x: 0, y: 0 },
    }, 'custom-detector');
    expect(deposit!.agentId).toBe('custom-detector');
  });
});

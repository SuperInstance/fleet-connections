// ============================================================================
// Tests for Connection 12: Gossip-Ping ↔ Stigmergy Bridge
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  probeToPheromone,
  memberStatusToPheromone,
  buildFleetHealthField,
  analyzeStigmergicHealth,
  type SwimMember,
  type SwimProbeResult,
} from '../connections/12-gossip-stigmergy-bridge.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function aliveMember(id = 'agent-a'): SwimMember {
  return {
    id,
    address: 'localhost:8080',
    status: 'ALIVE',
    incarnation: 1,
    lastSeen: Date.now(),
  };
}

function suspectMember(id = 'agent-b'): SwimMember {
  return {
    id,
    address: 'localhost:8081',
    status: 'SUSPECT',
    incarnation: 2,
    lastSeen: Date.now() - 10000,
  };
}

function deadMember(id = 'agent-c'): SwimMember {
  return {
    id,
    address: 'localhost:8082',
    status: 'DEAD',
    incarnation: 1,
    lastSeen: Date.now() - 60000,
  };
}

function successProbe(target = 'agent-a'): SwimProbeResult {
  return { target, success: true, rttMs: 50, timestamp: Date.now() };
}

function failedProbe(target = 'agent-b'): SwimProbeResult {
  return { target, success: false, rttMs: 0, timestamp: Date.now(), error: 'timeout' };
}

// ──────────────────────────────────────────────
// probeToPheromone
// ──────────────────────────────────────────────

describe('probeToPheromone', () => {
  test('successful probe → TRAIL pheromone', () => {
    const dep = probeToPheromone(successProbe(), aliveMember());
    expect(dep.type).toBe('TRAIL');
    expect(dep.strength).toBeGreaterThan(0);
  });

  test('failed probe → DANGER pheromone', () => {
    const dep = probeToPheromone(failedProbe(), suspectMember());
    expect(dep.type).toBe('DANGER');
  });

  test('lower latency → stronger pheromone', () => {
    const fast = probeToPheromone(
      { target: 'a', success: true, rttMs: 10, timestamp: Date.now() },
      aliveMember('a'),
    );
    const slow = probeToPheromone(
      { target: 'b', success: true, rttMs: 500, timestamp: Date.now() },
      aliveMember('b'),
    );
    expect(fast.strength).toBeGreaterThan(slow.strength);
  });

  test('NaN rtt → safe default', () => {
    const dep = probeToPheromone(
      { target: 'a', success: true, rttMs: NaN, timestamp: Date.now() },
      aliveMember(),
    );
    expect(dep.strength).toBeGreaterThan(0);
  });

  test('agentId includes swim prefix', () => {
    const dep = probeToPheromone(successProbe(), aliveMember('hermes'));
    expect(dep.agentId).toContain('swim:hermes');
  });

  test('position is deterministic for same member', () => {
    const dep1 = probeToPheromone(successProbe(), aliveMember('same-id'));
    const dep2 = probeToPheromone(successProbe(), aliveMember('same-id'));
    expect(dep1.position).toEqual(dep2.position);
  });

  test('different members → different positions', () => {
    const dep1 = probeToPheromone(successProbe(), aliveMember('aaa'));
    const dep2 = probeToPheromone(successProbe(), aliveMember('zzz'));
    expect(dep1.position).not.toEqual(dep2.position);
  });
});

// ──────────────────────────────────────────────
// memberStatusToPheromone
// ──────────────────────────────────────────────

describe('memberStatusToPheromone', () => {
  test('ALIVE member → TRAIL', () => {
    const dep = memberStatusToPheromone(aliveMember());
    expect(dep.type).toBe('TRAIL');
    expect(dep.strength).toBeGreaterThan(0);
  });

  test('SUSPECT member → DANGER', () => {
    const dep = memberStatusToPheromone(suspectMember());
    expect(dep.type).toBe('DANGER');
  });

  test('DEAD member → strength 0', () => {
    const dep = memberStatusToPheromone(deadMember());
    expect(dep.strength).toBe(0);
  });

  test('fresh ALIVE member has higher strength than stale one', () => {
    const fresh = memberStatusToPheromone({
      ...aliveMember(),
      lastSeen: Date.now(),
    });
    const stale = memberStatusToPheromone({
      ...aliveMember(),
      lastSeen: Date.now() - 55000,
    });
    expect(fresh.strength).toBeGreaterThan(stale.strength);
  });
});

// ──────────────────────────────────────────────
// buildFleetHealthField
// ──────────────────────────────────────────────

describe('buildFleetHealthField', () => {
  test('all alive → high field health', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      aliveMember('b'),
      aliveMember('c'),
    ]);
    expect(field.fieldHealth).toBeGreaterThan(0.8);
    expect(field.deadMembers).toBe(0);
  });

  test('mixed fleet → moderate health', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      suspectMember('b'),
      deadMember('c'),
    ]);
    expect(field.fieldHealth).toBeLessThan(0.5);
    expect(field.deadMembers).toBe(1);
  });

  test('all dead → zero health', () => {
    const field = buildFleetHealthField([
      deadMember('a'),
      deadMember('b'),
    ]);
    expect(field.fieldHealth).toBe(0);
  });

  test('empty fleet → zero health', () => {
    const field = buildFleetHealthField([]);
    expect(field.fieldHealth).toBe(0);
    expect(field.totalDeposits).toBe(0);
  });

  test('deposits include all members', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      suspectMember('b'),
    ]);
    expect(field.deposits).toHaveLength(2);
  });

  test('alive deposits exclude dead members', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      deadMember('b'),
    ]);
    expect(field.aliveDeposits).toBe(1);
  });
});

// ──────────────────────────────────────────────
// analyzeStigmergicHealth
// ──────────────────────────────────────────────

describe('analyzeStigmergicHealth', () => {
  test('healthy fleet → no concerns', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      aliveMember('b'),
      aliveMember('c'),
    ]);
    const analysis = analyzeStigmergicHealth(field);
    expect(analysis.healthy).toBe(true);
    expect(analysis.concerns).toHaveLength(0);
  });

  test('dead members generate concern', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      deadMember('b'),
    ]);
    const analysis = analyzeStigmergicHealth(field);
    expect(analysis.concerns.some(c => c.includes('dead'))).toBe(true);
  });

  test('more danger than trail generates concern', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      suspectMember('b'),
      suspectMember('c'),
      suspectMember('d'),
    ]);
    const analysis = analyzeStigmergicHealth(field);
    // With 1 alive and 3 suspects, danger should outnumber trail
    expect(analysis.healthy).toBe(false);
  });

  test('recommendations provided for unhealthy fleet', () => {
    const field = buildFleetHealthField([
      aliveMember('a'),
      deadMember('b'),
    ]);
    const analysis = analyzeStigmergicHealth(field);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
  });

  test('empty fleet → not healthy', () => {
    const analysis = analyzeStigmergicHealth(buildFleetHealthField([]));
    expect(analysis.healthy).toBe(false);
  });
});

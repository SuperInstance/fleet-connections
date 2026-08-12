// ============================================================================
// Connection 12: GOSSIP-PING ↔ STIGMERGY
// Converts SWIM health probes into pheromone deposits.
// ============================================================================
//
// gossip-ping implements SWIM (Scalable Weakly-consistent Infection-style
// membership protocol) for fleet health monitoring — direct probes,
// indirect probes, suspicion, and member lifecycle.
// stigmergy provides pheromone trails for indirect agent coordination.
//
// The bridge: every SWIM probe is a pheromone deposit. Healthy agents
// leave TRAIL pheromones (reinforcing the path). Suspicious agents
// leave DANGER pheromones. Dead agents' pheromones decay naturally.
//
// This means: the fleet's health state is visible in the stigmergic field.
// You can see which parts of the fleet are alive by looking at where
// the pheromones are fresh.
//
// ============================================================================

// ──────────────────────────────────────────────
// Types (from gossip-ping SWIM)
// ──────────────────────────────────────────────

export type MemberStatus = 'ALIVE' | 'SUSPECT' | 'DEAD';

export interface SwimMember {
  id: string;
  address: string;
  status: MemberStatus;
  incarnation: number;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

export interface SwimProbeResult {
  target: string;
  success: boolean;
  rttMs: number;
  timestamp: number;
  error?: string;
}

// ──────────────────────────────────────────────
// Types (from stigmergy, subset)
// ──────────────────────────────────────────────

export type PheromoneType = 'TRAIL' | 'DANGER' | 'RECRUIT';

export interface PheromoneDeposit {
  agentId: string;
  type: PheromoneType;
  position: { x: number; y: number };
  strength: number;
}

// ──────────────────────────────────────────────
// NaN guard (fleet convention)
// ──────────────────────────────────────────────

function safeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const n = Number(value);
  return Number.isNaN(n) || !Number.isFinite(n) ? defaultValue : n;
}

// ──────────────────────────────────────────────
// Member → Position (hash-based spatial mapping)
// ──────────────────────────────────────────────

function memberPosition(memberId: string): { x: number; y: number } {
  // Deterministic hash to position — same member always maps to same position
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = ((hash << 5) - hash + memberId.charCodeAt(i)) | 0;
  }
  const x = (Math.abs(hash) % 1000) / 100;
  const y = (Math.abs(hash >> 8) % 1000) / 100;
  return { x, y: safeNumber(y) };
}

// ──────────────────────────────────────────────
// SWIM Probe → Pheromone Deposit
// ──────────────────────────────────────────────

export function probeToPheromone(
  probe: SwimProbeResult,
  member: SwimMember,
): PheromoneDeposit {
  const pos = memberPosition(member.id);
  const rtt = safeNumber(probe.rttMs);

  if (probe.success) {
    // Healthy probe → TRAIL pheromone, strength based on latency
    // Lower latency = stronger pheromone
    const strength = Math.max(0.1, Math.min(1, 1 - rtt / 1000));
    return {
      agentId: `swim:${member.id}`,
      type: 'TRAIL',
      position: pos,
      strength,
    };
  } else {
    // Failed probe → DANGER pheromone
    return {
      agentId: `swim:${member.id}`,
      type: 'DANGER',
      position: pos,
      strength: 0.8,
    };
  }
}

// ──────────────────────────────────────────────
// Member Status → Pheromone Type
// ──────────────────────────────────────────────

export function memberStatusToPheromone(member: SwimMember): PheromoneDeposit {
  const pos = memberPosition(member.id);
  const age = Date.now() - safeNumber(member.lastSeen);
  const freshness = Math.max(0, 1 - age / 60000); // decays over 60s

  switch (member.status) {
    case 'ALIVE':
      return {
        agentId: `swim:${member.id}`,
        type: 'TRAIL',
        position: pos,
        strength: freshness,
      };
    case 'SUSPECT':
      return {
        agentId: `swim:${member.id}`,
        type: 'DANGER',
        position: pos,
        strength: freshness * 0.7,
      };
    case 'DEAD':
      // Dead members leave no pheromone — they just stop depositing
      return {
        agentId: `swim:${member.id}`,
        type: 'DANGER',
        position: pos,
        strength: 0,
      };
  }
}

// ──────────────────────────────────────────────
// Fleet Health as Stigmergic Field
// ──────────────────────────────────────────────

export interface FleetHealthField {
  totalDeposits: number;
  aliveDeposits: number;
  dangerDeposits: number;
  deadMembers: number;
  averageStrength: number;
  fieldHealth: number; // 0.0 to 1.0
  deposits: PheromoneDeposit[];
}

export function buildFleetHealthField(members: SwimMember[]): FleetHealthField {
  const deposits = members.map(memberStatusToPheromone);
  const aliveDeposits = deposits.filter(d => d.type === 'TRAIL' && d.strength > 0);
  const dangerDeposits = deposits.filter(d => d.type === 'DANGER' && d.strength > 0);
  const deadMembers = members.filter(m => m.status === 'DEAD').length;

  const totalStrength = deposits.reduce((sum, d) => sum + safeNumber(d.strength), 0);
  const averageStrength = deposits.length > 0 ? totalStrength / deposits.length : 0;

  // Field health: ratio of alive to total, weighted by freshness
  const fieldHealth = members.length > 0
    ? aliveDeposits.length / members.length
    : 0;

  return {
    totalDeposits: deposits.length,
    aliveDeposits: aliveDeposits.length,
    dangerDeposits: dangerDeposits.length,
    deadMembers,
    averageStrength: Math.round(averageStrength * 100) / 100,
    fieldHealth: Math.round(fieldHealth * 100) / 100,
    deposits,
  };
}

// ──────────────────────────────────────────────
// Stigmergic Health Check
// ──────────────────────────────────────────────

export interface StigmergicHealthCheck {
  healthy: boolean;
  concerns: string[];
  recommendations: string[];
  fieldHealth: number;
}

export function analyzeStigmergicHealth(field: FleetHealthField): StigmergicHealthCheck {
  const concerns: string[] = [];
  const recommendations: string[] = [];

  if (field.deadMembers > 0) {
    concerns.push(`${field.deadMembers} dead member(s) — pheromones evaporating`);
    recommendations.push('Investigate dead members and restart or remove from membership');
  }

  if (field.dangerDeposits > field.aliveDeposits) {
    concerns.push('More DANGER pheromones than TRAIL — fleet health degrading');
    recommendations.push('Check network connectivity and agent resource usage');
  }

  if (field.averageStrength < 0.3) {
    concerns.push(`Low average pheromone strength (${field.averageStrength}) — stale field`);
    recommendations.push('Increase probe frequency or reduce pheromone half-life');
  }

  const healthy = concerns.length === 0 && field.fieldHealth > 0.7;

  return {
    healthy,
    concerns,
    recommendations,
    fieldHealth: field.fieldHealth,
  };
}

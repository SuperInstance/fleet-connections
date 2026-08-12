// ============================================================================
// Connection 11: STIGMERGY ↔ EMERGENCE ENGINE
// Converts pheromone trails into emergence patterns.
// ============================================================================
//
// stigmergy provides decentralized coordination via pheromone trails — agents
// leave signals that decay over time and influence others.
// emergence-engine watches group interactions for emergent patterns —
// synergy, creativity, conflict, insight, phase transitions.
//
// This bridge: when pheromone trails converge (multiple agents reinforcing the
// same signal), that IS emergence. The stigmergic field becomes input data
// for the emergence detector.
//
// In the fleet loop:
//   ... → agents leave pheromones on the stigmergic field
//   → stigmergy-emergence-bridge detects convergent trails
//   → emergence-engine classifies the pattern (synergy? creativity?)
//   → collective-unconscious records the emergent event
//
// ============================================================================

// ──────────────────────────────────────────────
// Types (from stigmergy)
// ──────────────────────────────────────────────

export type PheromoneType = 'FOOD' | 'DANGER' | 'TRAIL' | 'RECRUIT' | 'TERRITORY';

export interface Pheromone {
  id: string;
  type: PheromoneType;
  position: { x: number; y: number };
  strength: number; // 0.0 to 1.0
  agentId: string;
  timestamp: number;
  halfLife: number; // ms
}

export interface PheromoneDeposit {
  agentId: string;
  type: PheromoneType;
  position: { x: number; y: number };
  strength: number;
}

// ──────────────────────────────────────────────
// Types (from emergence-engine)
// ──────────────────────────────────────────────

export type EmergenceType = 'SYNERGY' | 'CREATIVITY' | 'CONFLICT' | 'INSIGHT' | 'PHASE_TRANSITION';

export interface EmergencePattern {
  type: EmergenceType;
  confidence: number; // 0.0 to 1.0
  agentsInvolved: string[];
  description: string;
  timestamp: number;
  location: { x: number; y: number };
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
// Pheromone Field → Emergence Detection
// ──────────────────────────────────────────────

export interface ConvergentTrail {
  location: { x: number; y: number };
  agents: string[];
  totalStrength: number;
  pheromoneCount: number;
  dominantType: PheromoneType;
  convergence: number; // 0.0 to 1.0 — how aligned the trails are
}

/**
 * Find locations where multiple agents have deposited pheromones.
 * These convergent trails are potential emergence sites.
 */
export function findConvergentTrails(
  pheromones: Pheromone[],
  radius = 0.5,
  minAgents = 2,
): ConvergentTrail[] {
  if (!Array.isArray(pheromones) || pheromones.length === 0) return [];

  const visited = new Set<string>();
  const trails: ConvergentTrail[] = [];

  for (const p of pheromones) {
    if (visited.has(p.id)) continue;

    // Find nearby pheromones
    const nearby = pheromones.filter(other => {
      if (visited.has(other.id)) return false;
      const dx = safeNumber(p.position.x) - safeNumber(other.position.x);
      const dy = safeNumber(p.position.y) - safeNumber(other.position.y);
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= radius;
    });

    if (nearby.length < minAgents) continue;

    const agents = new Set(nearby.map(n => n.agentId));
    if (agents.size < minAgents) continue;

    // Mark as visited
    nearby.forEach(n => visited.add(n.id));

    // Compute trail properties
    const totalStrength = nearby.reduce((sum, n) => sum + safeNumber(n.strength), 0);

    // Type frequency
    const typeFreq: Record<string, number> = {};
    for (const n of nearby) {
      typeFreq[n.type] = (typeFreq[n.type] ?? 0) + 1;
    }
    const dominantType = Object.entries(typeFreq)
      .sort((a, b) => b[1] - a[1])[0]?.[0] as PheromoneType ?? 'TRAIL';

    // Convergence: how much do agents agree on location?
    // Higher = more agents in a tighter cluster
    const avgStrength = totalStrength / nearby.length;
    const agentRatio = agents.size / nearby.length;
    const convergence = safeNumber(agentRatio * avgStrength);

    // Center of mass
    const cx = nearby.reduce((sum, n) => sum + safeNumber(n.position.x), 0) / nearby.length;
    const cy = nearby.reduce((sum, n) => sum + safeNumber(n.position.y), 0) / nearby.length;

    trails.push({
      location: { x: cx, y: cy },
      agents: Array.from(agents).sort(),
      totalStrength: Math.round(totalStrength * 100) / 100,
      pheromoneCount: nearby.length,
      dominantType,
      convergence: Math.min(1, convergence),
    });
  }

  return trails.sort((a, b) => b.convergence - a.convergence);
}

/**
 * Classify a convergent trail as an emergence pattern.
 */
export function classifyTrailAsEmergence(trail: ConvergentTrail): EmergencePattern {
  const { dominantType, convergence, agents, totalStrength, pheromoneCount } = trail;

  let type: EmergenceType;
  let description: string;

  if (dominantType === 'DANGER') {
    type = 'CONFLICT';
    description = `${agents.length} agents detected danger at the same location — collective alarm response`;
  } else if (dominantType === 'FOOD' || dominantType === 'TRAIL') {
    if (convergence > 0.7) {
      type = 'SYNERGY';
      description = `${agents.length} agents independently converged on the same trail — self-organizing coordination`;
    } else {
      type = 'CREATIVITY';
      description = `${agents.length} agents exploring nearby territory — distributed search pattern`;
    }
  } else if (dominantType === 'RECRUIT') {
    type = 'PHASE_TRANSITION';
    description = `${agents.length} agents issuing recruitment signals — colony mobilization detected`;
  } else {
    type = 'INSIGHT';
    description = `${agents.length} agents marking territory independently — boundary detection`;
  }

  return {
    type,
    confidence: Math.min(1, convergence * safeNumber(pheromoneCount / 5)),
    agentsInvolved: agents,
    description,
    timestamp: Date.now(),
    location: trail.location,
  };
}

/**
 * Full pipeline: pheromone field → emergence patterns
 */
export function detectEmergenceFromField(
  pheromones: Pheromone[],
  radius = 0.5,
  minAgents = 2,
): EmergencePattern[] {
  const trails = findConvergentTrails(pheromones, radius, minAgents);
  return trails
    .map(classifyTrailAsEmergence)
    .filter(e => e.confidence > 0.1) // Filter out noise
    .sort((a, b) => b.confidence - a.confidence);
}

// ──────────────────────────────────────────────
// Emergence → Pheromone Deposit (feedback loop)
// ──────────────────────────────────────────────

/**
 * When emergence is detected, generate a pheromone deposit to reinforce it.
 * This creates the feedback loop: emergence → reinforcement → more emergence.
 */
export function emergenceToPheromone(
  pattern: EmergencePattern,
  agentId = 'emergence-detector',
): PheromoneDeposit | null {
  if (pattern.confidence < 0.3) return null;

  const typeMap: Record<EmergenceType, PheromoneType> = {
    SYNERGY: 'TRAIL',
    CREATIVITY: 'TRAIL',
    CONFLICT: 'DANGER',
    INSIGHT: 'RECRUIT',
    PHASE_TRANSITION: 'RECRUIT',
  };

  return {
    agentId,
    type: typeMap[pattern.type] ?? 'TRAIL',
    position: pattern.location,
    strength: pattern.confidence,
  };
}

// ============================================================================
// Connection 9: CONFIDENCE CASCADE ↔ CNS ECHO HEALTH
// Translates bus health summaries into confidence cascades for fleet decisions.
// ============================================================================
//
// confidence-cascade provides three-zone confidence (GREEN/YELLOW/RED) with
// sequential, parallel, and conditional composition.
// cns-echo-health provides bus health analysis (per-packet and aggregate).
//
// This module bridges them: bus health becomes a confidence value that can
// be composed into fleet-wide decision cascades.
//
// In the fleet loop:
//   ... → cns-echo-health analyzes the bus
//   → confidence-health-bridge converts to a Confidence value
//   → confidence-cascade composes it with other signals
//   → fleet decision: proceed / caution / stop
//
// ============================================================================

// ──────────────────────────────────────────────
// Types (from cns-echo-health, re-declared for independence)
// ──────────────────────────────────────────────

export enum ConfidenceZone {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  RED = 'RED',
}

export interface Confidence {
  value: number;
  zone: ConfidenceZone;
  source: string;
  timestamp: number;
}

interface BusHealthSummary {
  totalPackets: number;
  healthyPackets: number;
  degradedPackets: number;
  criticalPackets: number;
  averageHealth: number;
  activeOrigins: string[];
  emergencyCount: number;
  timestamp: string;
}

interface AnalysisResult {
  healthScore: number;
  healthNotes: string[];
  protocolErrors: string[];
  protocolWarnings: string[];
  suggestedPriority: string;
  checksumValid: boolean;
}

// ──────────────────────────────────────────────
// Mirror of createConfidence (from confidence-cascade, inlined for independence)
// ──────────────────────────────────────────────

const GREEN_THRESHOLD = 0.90;
const YELLOW_THRESHOLD = 0.75;

function classifyZone(value: number): ConfidenceZone {
  if (value >= GREEN_THRESHOLD) return ConfidenceZone.GREEN;
  if (value >= YELLOW_THRESHOLD) return ConfidenceZone.YELLOW;
  return ConfidenceZone.RED;
}

function makeConfidence(value: number, source: string): Confidence {
  const v = Number.isNaN(value) || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(1, value));
  return {
    value: v,
    zone: classifyZone(v),
    source,
    timestamp: Date.now(),
  };
}

// Re-export for consumers
export { makeConfidence as createConfidence };

// ──────────────────────────────────────────────
// Bus Health → Confidence
// ──────────────────────────────────────────────

/**
 * Convert a bus health summary into a Confidence value.
 * Uses averageHealth directly, but adjusts for emergencies.
 */
export function busHealthToConfidence(summary: BusHealthSummary): Confidence {
  let value = summary.averageHealth;

  // Penalize for emergencies
  if (summary.emergencyCount > 0) {
    const penalty = Math.min(0.3, summary.emergencyCount * 0.1);
    value = Math.max(0, value - penalty);
  }

  // Penalize for critical packets
  if (summary.criticalPackets > 0 && summary.totalPackets > 0) {
    const criticalRatio = summary.criticalPackets / summary.totalPackets;
    value = Math.max(0, value * (1 - criticalRatio * 0.5));
  }

  const source = `bus-health:${summary.totalPackets}pkts:${summary.activeOrigins.length}origins`;
  return makeConfidence(value, source);
}

/**
 * Convert a single analysis result into a Confidence value.
 */
export function analysisToConfidence(analysis: AnalysisResult): Confidence {
  let value = analysis.healthScore;

  // Invalid checksums reduce confidence
  if (!analysis.checksumValid) {
    value *= 0.8;
  }

  // Protocol errors reduce confidence
  if (analysis.protocolErrors.length > 0) {
    const errorPenalty = Math.min(0.3, analysis.protocolErrors.length * 0.05);
    value = Math.max(0, value - errorPenalty);
  }

  return makeConfidence(value, `analysis:${analysis.suggestedPriority}`);
}

// ──────────────────────────────────────────────
// Fleet Decision Cascade: Multi-Signal Bus Health
// ──────────────────────────────────────────────

export interface FleetHealthSignals {
  busSummary: BusHealthSummary;
  recentAnalyses: AnalysisResult[];
  uptimeHours: number;
  agentCount: number;
}

export interface FleetHealthDecision {
  overall: Confidence;
  busConfidence: Confidence;
  agentAgreement: Confidence;
  uptimeConfidence: Confidence;
  decision: 'PROCEED' | 'CAUTION' | 'STOP';
  reasoning: string[];
}

/**
 * Compose multiple health signals into a single fleet decision.
 *
 * The cascade is:
 * 1. Bus health (parallel composition of all recent analyses)
 * 2. Uptime factor (sequential degradation over time)
 * 3. Agent agreement (how many agents are talking)
 */
export function evaluateFleetHealth(signals: FleetHealthSignals): FleetHealthDecision {
  const reasoning: string[] = [];

  // Bus health from summary
  const busConfidence = busHealthToConfidence(signals.busSummary);
  reasoning.push(`Bus health: ${(busConfidence.value * 100).toFixed(1)}% (${busConfidence.zone})`);

  // Agent agreement from recent analyses (parallel cascade)
  let agentAgreement: Confidence;
  if (signals.recentAnalyses.length > 0) {
    const analyses = signals.recentAnalyses.map(a => ({
      confidence: analysisToConfidence(a),
      weight: 1,
    }));
    // Average health across analyses
    const avgValue = analyses.reduce((sum, a) => sum + a.confidence.value, 0) / analyses.length;
    agentAgreement = makeConfidence(avgValue, `agent-agreement:${analyses.length}samples`);
  } else {
    agentAgreement = makeConfidence(0.5, 'no-analyses');
    reasoning.push('Warning: no recent analyses available');
  }
  reasoning.push(`Agent agreement: ${(agentAgreement.value * 100).toFixed(1)}% (${agentAgreement.zone})`);

  // Uptime confidence: degrades slowly over time (0.1% per hour, floored at 0.7)
  const uptimeFactor = Math.max(0.7, 1.0 - signals.uptimeHours * 0.001);
  const uptimeConfidence = makeConfidence(uptimeFactor, `uptime:${signals.uptimeHours}h`);
  reasoning.push(`Uptime: ${(uptimeConfidence.value * 100).toFixed(1)}% (${uptimeConfidence.zone})`);

  // Final sequential cascade: bus × agents × uptime
  const cascadeSteps = [busConfidence, agentAgreement, uptimeConfidence];
  const overallValue = cascadeSteps.reduce((product, c) => product * c.value, 1.0);
  const overall = makeConfidence(overallValue, 'fleet-health-cascade');

  // Decision
  let decision: 'PROCEED' | 'CAUTION' | 'STOP';
  if (overall.zone === ConfidenceZone.GREEN) {
    decision = 'PROCEED';
  } else if (overall.zone === ConfidenceZone.YELLOW) {
    decision = 'CAUTION';
  } else {
    decision = 'STOP';
  }

  reasoning.push(`Overall: ${(overall.value * 100).toFixed(1)}% (${overall.zone}) → ${decision}`);

  return {
    overall,
    busConfidence,
    agentAgreement,
    uptimeConfidence,
    decision,
    reasoning,
  };
}

// ============================================================================
// Tests for Connection 9: Confidence Cascade ↔ CNS Echo Health Bridge
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  busHealthToConfidence,
  analysisToConfidence,
  evaluateFleetHealth,
  createConfidence,
  ConfidenceZone,
  type Confidence,
} from '../connections/09-confidence-health-bridge.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function healthySummary(overrides: Partial<any> = {}): any {
  return {
    totalPackets: 10,
    healthyPackets: 8,
    degradedPackets: 2,
    criticalPackets: 0,
    averageHealth: 0.92,
    activeOrigins: ['hermes', 'lucineer', 'wesley'],
    emergencyCount: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function goodAnalysis(overrides: Partial<any> = {}): any {
  return {
    healthScore: 0.95,
    healthNotes: ['Signal is healthy'],
    protocolErrors: [],
    protocolWarnings: [],
    suggestedPriority: 'LOW',
    checksumValid: true,
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// busHealthToConfidence
// ──────────────────────────────────────────────

describe('busHealthToConfidence', () => {
  test('healthy bus → GREEN zone', () => {
    const conf = busHealthToConfidence(healthySummary());
    expect(conf.zone).toBe(ConfidenceZone.GREEN);
    expect(conf.value).toBeGreaterThan(0.9);
  });

  test('degraded bus → YELLOW zone', () => {
    const conf = busHealthToConfidence(healthySummary({ averageHealth: 0.80 }));
    expect(conf.zone).toBe(ConfidenceZone.YELLOW);
  });

  test('critical bus → RED zone', () => {
    const conf = busHealthToConfidence(healthySummary({ averageHealth: 0.50 }));
    expect(conf.zone).toBe(ConfidenceZone.RED);
  });

  test('emergencies penalize confidence', () => {
    const normal = busHealthToConfidence(healthySummary());
    const emergency = busHealthToConfidence(healthySummary({ emergencyCount: 2 }));
    expect(emergency.value).toBeLessThan(normal.value);
  });

  test('critical packets reduce confidence', () => {
    const normal = busHealthToConfidence(healthySummary());
    const critical = busHealthToConfidence(healthySummary({ criticalPackets: 3, totalPackets: 10 }));
    expect(critical.value).toBeLessThan(normal.value);
  });

  test('empty bus returns 0 health', () => {
    const conf = busHealthToConfidence(healthySummary({ totalPackets: 0, averageHealth: 0, activeOrigins: [] }));
    expect(conf.value).toBe(0);
    expect(conf.zone).toBe(ConfidenceZone.RED);
  });

  test('source includes packet and origin count', () => {
    const conf = busHealthToConfidence(healthySummary({ totalPackets: 42, activeOrigins: ['a', 'b'] }));
    expect(conf.source).toContain('42pkts');
    expect(conf.source).toContain('2origins');
  });
});

// ──────────────────────────────────────────────
// analysisToConfidence
// ──────────────────────────────────────────────

describe('analysisToConfidence', () => {
  test('good analysis → high confidence', () => {
    const conf = analysisToConfidence(goodAnalysis());
    expect(conf.value).toBeGreaterThan(0.9);
    expect(conf.zone).toBe(ConfidenceZone.GREEN);
  });

  test('invalid checksum reduces confidence', () => {
    const conf = analysisToConfidence(goodAnalysis({ checksumValid: false }));
    const good = analysisToConfidence(goodAnalysis());
    expect(conf.value).toBeLessThan(good.value);
  });

  test('protocol errors reduce confidence', () => {
    const conf = analysisToConfidence(goodAnalysis({ protocolErrors: ['err1', 'err2', 'err3'] }));
    const good = analysisToConfidence(goodAnalysis());
    expect(conf.value).toBeLessThan(good.value);
  });

  test('many protocol errors floor at 0', () => {
    const conf = analysisToConfidence(goodAnalysis({
      healthScore: 0.5,
      protocolErrors: Array(20).fill('err'),
    }));
    expect(conf.value).toBeGreaterThanOrEqual(0);
  });

  test('source includes priority', () => {
    const conf = analysisToConfidence(goodAnalysis({ suggestedPriority: 'CRITICAL' }));
    expect(conf.source).toContain('CRITICAL');
  });
});

// ──────────────────────────────────────────────
// evaluateFleetHealth
// ──────────────────────────────────────────────

describe('evaluateFleetHealth', () => {
  test('all-healthy fleet → PROCEED or CAUTION', () => {
    const decision = evaluateFleetHealth({
      busSummary: healthySummary({ averageHealth: 0.99 }),
      recentAnalyses: [goodAnalysis({ healthScore: 0.99 }), goodAnalysis({ healthScore: 0.99 }), goodAnalysis({ healthScore: 0.99 })],
      uptimeHours: 1,
      agentCount: 5,
    });
    // Sequential cascade multiplies: even 0.99^3 ≈ 0.97 which is still GREEN
    expect(['PROCEED', 'CAUTION']).toContain(decision.decision);
    expect(decision.reasoning.length).toBeGreaterThan(3);
  });

  test('degraded bus → CAUTION', () => {
    const decision = evaluateFleetHealth({
      busSummary: healthySummary({ averageHealth: 0.78 }),
      recentAnalyses: [goodAnalysis({ healthScore: 0.75 })],
      uptimeHours: 10,
      agentCount: 3,
    });
    expect(['CAUTION', 'STOP']).toContain(decision.decision);
  });

  test('multiple failures → STOP', () => {
    const decision = evaluateFleetHealth({
      busSummary: healthySummary({
        averageHealth: 0.30,
        criticalPackets: 5,
        emergencyCount: 2,
      }),
      recentAnalyses: [goodAnalysis({ healthScore: 0.20, checksumValid: false })],
      uptimeHours: 100,
      agentCount: 1,
    });
    expect(decision.decision).toBe('STOP');
    expect(decision.overall.zone).toBe(ConfidenceZone.RED);
  });

  test('no analyses → warning in reasoning', () => {
    const decision = evaluateFleetHealth({
      busSummary: healthySummary(),
      recentAnalyses: [],
      uptimeHours: 1,
      agentCount: 3,
    });
    expect(decision.reasoning.some(r => r.includes('no recent analyses'))).toBe(true);
  });

  test('uptime reduces confidence over time', () => {
    const fresh = evaluateFleetHealth({
      busSummary: healthySummary(),
      recentAnalyses: [goodAnalysis()],
      uptimeHours: 1,
      agentCount: 3,
    });
    const stale = evaluateFleetHealth({
      busSummary: healthySummary(),
      recentAnalyses: [goodAnalysis()],
      uptimeHours: 500,
      agentCount: 3,
    });
    expect(stale.uptimeConfidence.value).toBeLessThan(fresh.uptimeConfidence.value);
  });

  test('uptime floors at 0.7', () => {
    const decision = evaluateFleetHealth({
      busSummary: healthySummary(),
      recentAnalyses: [goodAnalysis()],
      uptimeHours: 10000,
      agentCount: 3,
    });
    expect(decision.uptimeConfidence.value).toBeGreaterThanOrEqual(0.7);
  });

  test('sequential cascade degrades overall confidence', () => {
    // Three signals at 0.9 each: 0.9^3 = 0.729 → YELLOW
    const decision = evaluateFleetHealth({
      busSummary: healthySummary({ averageHealth: 0.90 }),
      recentAnalyses: [goodAnalysis({ healthScore: 0.90 })],
      uptimeHours: 50,
      agentCount: 5,
    });
    expect(decision.overall.value).toBeLessThan(0.9); // degraded from individual values
  });

  test('reasoning contains all signal evaluations', () => {
    const decision = evaluateFleetHealth({
      busSummary: healthySummary(),
      recentAnalyses: [goodAnalysis()],
      uptimeHours: 5,
      agentCount: 10,
    });
    expect(decision.reasoning.some(r => r.includes('Bus health'))).toBe(true);
    expect(decision.reasoning.some(r => r.includes('Agent agreement'))).toBe(true);
    expect(decision.reasoning.some(r => r.includes('Uptime'))).toBe(true);
    expect(decision.reasoning.some(r => r.includes('Overall'))).toBe(true);
  });
});

// ──────────────────────────────────────────────
// createConfidence (mirror)
// ──────────────────────────────────────────────

describe('createConfidence (bridge mirror)', () => {
  test('creates valid confidence', () => {
    const conf = createConfidence(0.85, 'test');
    expect(conf.value).toBe(0.85);
    expect(conf.zone).toBe(ConfidenceZone.YELLOW);
    expect(conf.source).toBe('test');
  });

  test('NaN input becomes 0', () => {
    const conf = createConfidence(NaN, 'nan-test');
    expect(conf.value).toBe(0);
    expect(conf.zone).toBe(ConfidenceZone.RED);
  });

  test('Infinity input becomes 0', () => {
    const conf = createConfidence(Infinity, 'inf-test');
    expect(conf.value).toBe(0);
  });

  test('values > 1 are clamped to 1', () => {
    const conf = createConfidence(1.5, 'clamp-test');
    expect(conf.value).toBe(1);
  });

  test('values < 0 are clamped to 0', () => {
    const conf = createConfidence(-0.5, 'clamp-test');
    expect(conf.value).toBe(0);
  });
});

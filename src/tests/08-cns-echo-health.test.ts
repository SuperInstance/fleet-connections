// ============================================================================
// Tests for Connection 8: CNS Bridge ↔ CNS Echo Health
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  analyzePacket,
  summarizeBusHealth,
  buildHealthResponsePacket,
  type USCPPacket,
  type AnalysisResult,
} from '../connections/08-cns-echo-health.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function validPacket(overrides: Partial<USCPPacket> = {}): USCPPacket {
  return {
    header: {
      origin_id: 'test-agent',
      timestamp: '2026-08-12T05:00:00Z',
      priority: 'MEDIUM',
      sequence_id: 1,
      destination_id: 'hermes',
    },
    body: {
      intent: 'QUERY',
      payload: {
        type: 'test',
        data: { message: 'hello' },
      },
    },
    signature: {
      type: 'sha256',
      checksum: 'verified',
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// analyzePacket
// ──────────────────────────────────────────────

describe('analyzePacket', () => {
  test('returns healthy score for valid packet', () => {
    const result = analyzePacket(validPacket());
    expect(result.healthScore).toBeGreaterThanOrEqual(0.9);
    expect(result.protocolErrors).toHaveLength(0);
    expect(result.checksumValid).toBe(true);
  });

  test('returns 0 health for non-object input', () => {
    expect(analyzePacket(null).healthScore).toBe(0);
    expect(analyzePacket(undefined).healthScore).toBe(0);
    expect(analyzePacket('not a packet').healthScore).toBe(0);
    expect(analyzePacket(42).healthScore).toBe(0);
    expect(analyzePacket([]).healthScore).toBe(0);
  });

  test('detects missing header fields', () => {
    const packet = {
      header: { origin_id: 'test' }, // missing timestamp, priority, sequence_id
      body: { intent: 'QUERY', payload: { type: 'test', data: {} } },
      signature: { type: 'sha256', checksum: 'verified' },
    };
    const result = analyzePacket(packet);
    expect(result.healthScore).toBeLessThan(0.9);
    expect(result.protocolErrors).toContain('Missing required header field: timestamp');
    expect(result.protocolErrors).toContain('Missing required header field: priority');
    expect(result.protocolErrors).toContain('Missing required header field: sequence_id');
  });

  test('detects missing body fields', () => {
    const packet = {
      header: validPacket().header,
      body: {}, // missing intent and payload
      signature: { type: 'sha256', checksum: 'verified' },
    };
    const result = analyzePacket(packet);
    expect(result.protocolErrors).toContain('Missing required body field: intent');
    expect(result.protocolErrors).toContain('Missing required body field: payload');
  });

  test('flags unknown priority', () => {
    const packet = validPacket({
      header: { ...validPacket().header, priority: 'ULTRA' as any },
    });
    const result = analyzePacket(packet);
    expect(result.protocolWarnings.some(w => w.includes('Unknown priority'))).toBe(true);
  });

  test('flags unknown intent', () => {
    const packet = validPacket({
      body: { intent: 'DANCE' as any, payload: { type: 'test', data: {} } },
    });
    const result = analyzePacket(packet);
    expect(result.protocolWarnings.some(w => w.includes('Unknown intent'))).toBe(true);
  });

  test('detects emergency signals', () => {
    const emergency = validPacket({
      header: { ...validPacket().header, priority: 'CRITICAL' },
      body: { intent: 'EMERGENCY_HALT', payload: { type: 'halt', data: {} } },
    });
    const result = analyzePacket(emergency);
    expect(result.suggestedIntent).toBe('EMERGENCY_ACK');
    expect(result.suggestedPriority).toBe('CRITICAL');
    expect(result.healthNotes.some(n => n.includes('EMERGENCY'))).toBe(true);
  });

  test('suggests handshake response for introductions', () => {
    const intro = validPacket({
      body: { intent: 'INTRODUCTION', payload: { type: 'hello', data: {} } },
    });
    const result = analyzePacket(intro);
    expect(result.suggestedIntent).toBe('HANDSHAKE_COMPLETE');
    expect(result.suggestedPriority).toBe('HIGH');
  });

  test('suggests reasoning response for REQUEST_REASONING', () => {
    const req = validPacket({
      body: { intent: 'REQUEST_REASONING', payload: { type: 'query', data: {} } },
    });
    const result = analyzePacket(req);
    expect(result.suggestedIntent).toBe('REASONING_RESPONSE');
  });

  test('suggests telemetry ack for TELEMETRY', () => {
    const tel = validPacket({
      body: { intent: 'TELEMETRY', payload: { type: 'data', data: {} } },
    });
    const result = analyzePacket(tel);
    expect(result.suggestedIntent).toBe('TELEMETRY_ACK');
    expect(result.suggestedPriority).toBe('LOW');
  });

  test('suggests query response for QUERY', () => {
    const result = analyzePacket(validPacket());
    expect(result.suggestedIntent).toBe('QUERY_RESPONSE');
  });

  test('handles non-dict header/body/signature gracefully', () => {
    const result = analyzePacket({
      header: 'not a dict',
      body: 'not a dict',
      signature: 'not a dict',
    });
    expect(result.protocolErrors).toContain('header is not an object');
    expect(result.protocolErrors).toContain('body is not an object');
    expect(result.protocolErrors).toContain('signature is not an object');
  });

  test('handles missing signature fields', () => {
    const packet = validPacket({
      signature: { type: 'sha256' } as any, // missing checksum
    });
    const result = analyzePacket(packet);
    expect(result.protocolErrors).toContain('Missing signature field: checksum');
  });

  test('flags invalid checksum', () => {
    const packet = validPacket({
      signature: { type: 'sha256', checksum: 'wrong-hash-value' },
    });
    const result = analyzePacket(packet);
    expect(result.checksumValid).toBe(false);
    expect(result.protocolWarnings.some(w => w.includes('Checksum'))).toBe(true);
  });

  test('accepts handshake-verified checksum', () => {
    const packet = validPacket({
      signature: { type: 'sha256', checksum: 'handshake-verified' },
    });
    const result = analyzePacket(packet);
    expect(result.checksumValid).toBe(true);
  });

  test('processing time is recorded', () => {
    const result = analyzePacket(validPacket());
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.processingTimeMs).toBe('number');
  });

  test('receivedAt is a valid ISO string', () => {
    const result = analyzePacket(validPacket());
    const date = new Date(result.receivedAt);
    expect(date.getTime()).not.toBeNaN();
  });

  test('sequence_id type check catches strings', () => {
    const packet = validPacket({
      header: { ...validPacket().header, sequence_id: 'one' as any },
    });
    const result = analyzePacket(packet);
    expect(result.protocolChecks['header.sequence_id_type']).toBe(false);
  });
});

// ──────────────────────────────────────────────
// summarizeBusHealth
// ──────────────────────────────────────────────

describe('summarizeBusHealth', () => {
  test('returns zero summary for empty array', () => {
    const summary = summarizeBusHealth([]);
    expect(summary.totalPackets).toBe(0);
    expect(summary.averageHealth).toBe(0);
    expect(summary.activeOrigins).toEqual([]);
  });

  test('returns zero summary for non-array input', () => {
    const summary = summarizeBusHealth(null as any);
    expect(summary.totalPackets).toBe(0);
  });

  test('counts healthy vs degraded vs critical', () => {
    const packets = [
      validPacket(), // healthy
      validPacket(), // healthy
      validPacket({ header: { ...validPacket().header, priority: 'ULTRA' as any } }), // degraded (unknown priority)
      'not a packet', // critical
    ];
    const summary = summarizeBusHealth(packets);
    expect(summary.totalPackets).toBe(4);
    expect(summary.healthyPackets).toBeGreaterThanOrEqual(2);
    expect(summary.criticalPackets).toBeGreaterThanOrEqual(1);
  });

  test('collects active origins', () => {
    const packets = [
      validPacket({ header: { ...validPacket().header, origin_id: 'agent-a' } }),
      validPacket({ header: { ...validPacket().header, origin_id: 'agent-b' } }),
      validPacket({ header: { ...validPacket().header, origin_id: 'agent-a' } }),
    ];
    const summary = summarizeBusHealth(packets);
    expect(summary.activeOrigins).toContain('agent-a');
    expect(summary.activeOrigins).toContain('agent-b');
    expect(summary.activeOrigins).toHaveLength(2);
    expect(summary.activeOrigins).toEqual(['agent-a', 'agent-b']); // sorted
  });

  test('counts emergencies', () => {
    const packets = [
      validPacket({ header: { ...validPacket().header, priority: 'CRITICAL' },
                     body: { intent: 'EMERGENCY_HALT', payload: { type: 'halt', data: {} } } }),
      validPacket(),
      validPacket({ header: { ...validPacket().header, priority: 'CRITICAL' },
                     body: { intent: 'EMERGENCY_HALT', payload: { type: 'halt', data: {} } } }),
    ];
    const summary = summarizeBusHealth(packets);
    expect(summary.emergencyCount).toBe(2);
  });

  test('averageHealth is between 0 and 1', () => {
    const packets = [validPacket(), validPacket(), validPacket()];
    const summary = summarizeBusHealth(packets);
    expect(summary.averageHealth).toBeGreaterThanOrEqual(0);
    expect(summary.averageHealth).toBeLessThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────
// buildHealthResponsePacket
// ──────────────────────────────────────────────

describe('buildHealthResponsePacket', () => {
  test('builds a valid response packet', () => {
    const original = validPacket();
    const analysis = analyzePacket(original);
    const response = buildHealthResponsePacket(analysis, original);

    expect(response.header.origin_id).toBe('cns-echo-bridge');
    expect(response.header.destination_id).toBe(original.header.origin_id);
    expect(response.header.sequence_id).toBe(original.header.sequence_id + 1);
    expect(response.body.payload.type).toBe('health-analysis');
    expect(response.signature.checksum).toBe('verified');
  });

  test('uses custom agent ID', () => {
    const original = validPacket();
    const analysis = analyzePacket(original);
    const response = buildHealthResponsePacket(analysis, original, 'custom-echo');
    expect(response.header.origin_id).toBe('custom-echo');
  });

  test('preserves original intent in response data', () => {
    const original = validPacket({
      body: { intent: 'QUERY', payload: { type: 'test', data: {} } },
    });
    const analysis = analyzePacket(original);
    const response = buildHealthResponsePacket(analysis, original);
    const data = response.body.payload.data as Record<string, unknown>;
    expect(data.originalIntent).toBe('QUERY');
  });

  test('response timestamp is a valid ISO string', () => {
    const original = validPacket();
    const analysis = analyzePacket(original);
    const response = buildHealthResponsePacket(analysis, original);
    expect(new Date(response.header.timestamp).getTime()).not.toBeNaN();
  });
});

// ──────────────────────────────────────────────
// Integration with the fleet loop
// ──────────────────────────────────────────────

describe('Fleet Loop Integration', () => {
  test('a QUERY from hermes produces a QUERY_RESPONSE from echo-bridge', () => {
    const queryFromHermes = validPacket({
      header: { origin_id: 'hermes', timestamp: new Date().toISOString(), priority: 'HIGH', sequence_id: 42, destination_id: 'cns-echo' },
      body: { intent: 'QUERY', payload: { type: 'status-check', data: { query: 'fleet health?' } } },
    });

    const analysis = analyzePacket(queryFromHermes);
    expect(analysis.healthScore).toBeGreaterThanOrEqual(0.9);
    expect(analysis.suggestedIntent).toBe('QUERY_RESPONSE');

    const response = buildHealthResponsePacket(analysis, queryFromHermes);
    expect(response.header.destination_id).toBe('hermes');
    expect(response.body.intent).toBe('QUERY_RESPONSE');
    expect(response.header.sequence_id).toBe(43);
  });

  test('emergency escalation propagates correctly', () => {
    const emergency = validPacket({
      header: { origin_id: 'wesley', timestamp: new Date().toISOString(), priority: 'CRITICAL', sequence_id: 7, destination_id: 'cns-echo' },
      body: { intent: 'EMERGENCY_HALT', payload: { type: 'halt', data: { reason: 'GPU overheating' } } },
    });

    const analysis = analyzePacket(emergency);
    expect(analysis.suggestedPriority).toBe('CRITICAL');

    const response = buildHealthResponsePacket(analysis, emergency);
    expect(response.header.priority).toBe('CRITICAL');
    expect(response.header.destination_id).toBe('wesley');
  });

  test('bus health summary reflects mixed traffic', () => {
    const busTraffic = [
      // Healthy telemetry from hermes
      validPacket({ header: { origin_id: 'hermes', timestamp: new Date().toISOString(), priority: 'LOW', sequence_id: 1 },
                    body: { intent: 'TELEMETRY', payload: { type: 'data', data: {} } } }),
      // Healthy query from lucineer
      validPacket({ header: { origin_id: 'lucineer', timestamp: new Date().toISOString(), priority: 'MEDIUM', sequence_id: 2 },
                    body: { intent: 'QUERY', payload: { type: 'question', data: {} } } }),
      // Malformed
      { header: {} },
    ];

    const summary = summarizeBusHealth(busTraffic);
    expect(summary.totalPackets).toBe(3);
    expect(summary.activeOrigins).toContain('hermes');
    expect(summary.activeOrigins).toContain('lucineer');
    expect(summary.healthyPackets).toBeGreaterThanOrEqual(1);
    expect(summary.criticalPackets).toBeGreaterThanOrEqual(1);
  });
});

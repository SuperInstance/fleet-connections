// ============================================================================
// Connection 8: CNS BRIDGE ↔ CNS ECHO
// Translates CNS bus signals into health-check telemetry via cns-echo analysis.
// ============================================================================
//
// cns-bridge sends USCP packets between agents via filesystem inboxes/outboxes.
// cns-echo receives those packets, analyzes protocol compliance, and suggests
// responses. This module connects them: it reads the bus state, formats it
// for the echo agent, and relays the analysis back as a health report.
//
// In the fleet loop:
//   ... → hermes-sync stores a frame
//   → cns-echo-health checks signal health on the bus
//   → if degraded, feeds back to hermes-sync as a warning frame
//   → the loop continues
//
// ============================================================================

// ──────────────────────────────────────────────
// USCP Packet types (mirrors from cns-bridge/src/cns_bridge/packet.py)
// ──────────────────────────────────────────────

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type Intent =
  | 'EXECUTE_PLAN'
  | 'SENSORY_DATA'
  | 'REQUEST_REASONING'
  | 'HANDSHAKE_COMPLETE'
  | 'EMERGENCY_HALT'
  | 'INTRODUCTION'
  | 'QUERY'
  | 'STATUS_REPORT'
  | 'TELEMETRY'
  | 'ARTIFACT_SHARE';

export interface USCPPacketHeader {
  origin_id: string;
  timestamp: string; // ISO 8601
  priority: Priority;
  sequence_id: number;
  destination_id?: string;
}

export interface USCPPacketBody {
  intent: Intent;
  payload: {
    type: string;
    data: Record<string, unknown>;
  };
}

export interface USCPPacketSignature {
  type: string;
  checksum: string;
}

export interface USCPPacket {
  header: USCPPacketHeader;
  body: USCPPacketBody;
  signature: USCPPacketSignature;
}

// ──────────────────────────────────────────────
// Health Analysis (mirrors from cns-echo/src/cns_echo/echo.py)
// ──────────────────────────────────────────────

export interface AnalysisResult {
  healthScore: number; // 0.0 to 1.0
  healthNotes: string[];
  protocolChecks: Record<string, boolean>;
  protocolErrors: string[];
  protocolWarnings: string[];
  suggestedIntent: string;
  suggestedPriority: Priority;
  checksumValid: boolean;
  receivedAt: string;
  processingTimeMs: number;
}

// ──────────────────────────────────────────────
// Valid values (from USCP spec, mirrored from cns-echo)
// ──────────────────────────────────────────────

const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_INTENTS = new Set([
  'EXECUTE_PLAN', 'SENSORY_DATA', 'REQUEST_REASONING', 'HANDSHAKE_COMPLETE',
  'EMERGENCY_HALT', 'INTRODUCTION', 'QUERY', 'STATUS_REPORT',
  'TELEMETRY', 'ARTIFACT_SHARE',
]);

const REQUIRED_HEADER_FIELDS = ['origin_id', 'timestamp', 'priority', 'sequence_id'];
const REQUIRED_BODY_FIELDS = ['intent', 'payload'];
const REQUIRED_SIG_FIELDS = ['type', 'checksum'];

// ──────────────────────────────────────────────
// NaN guard (fleet-wide convention)
// ──────────────────────────────────────────────

function sanitizeFloat(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined || typeof value === 'boolean') return defaultValue;
  const v = Number(value);
  if (Number.isNaN(v) || !Number.isFinite(v)) return defaultValue;
  return v;
}

// ──────────────────────────────────────────────
// Verify checksum (mirrors cns-echo's _verify_checksum)
// ──────────────────────────────────────────────

function verifyChecksum(packet: unknown): boolean {
  if (typeof packet !== 'object' || packet === null) return false;
  const p = packet as Record<string, unknown>;
  const sig = p.signature;
  if (typeof sig !== 'object' || sig === null) return false;
  const s = sig as Record<string, unknown>;
  const checksum = s.checksum;
  if (typeof checksum !== 'string' || !checksum) return false;
  if (checksum === 'verified' || checksum === 'handshake-verified') return true;
  // Content hash verification
  const header = p.header ?? {};
  const body = p.body ?? {};
  const content = JSON.stringify({ header, body });
  // Simple hash for content verification (browser-compatible)
  let computed = 0;
  for (let i = 0; i < content.length; i++) {
    computed = ((computed << 5) - computed + content.charCodeAt(i)) | 0;
  }
  computed = Math.abs(computed).toString(16).padStart(8, '0').slice(0, 16);
  return computed === checksum;
}

// ──────────────────────────────────────────────
// Analyze a USCP packet (TypeScript port of cns-echo's analyze())
// ──────────────────────────────────────────────

export function analyzePacket(packet: unknown): AnalysisResult {
  const start = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: Record<string, boolean> = {};
  const notes: string[] = [];

  // Guard against completely malformed input
  if (typeof packet !== 'object' || packet === null || Array.isArray(packet)) {
    return {
      healthScore: 0.0,
      healthNotes: ['Packet is not an object — completely malformed'],
      protocolChecks: { isObject: false },
      protocolErrors: [`Packet must be an object, got ${typeof packet}`],
      protocolWarnings: [],
      suggestedIntent: 'ECHO',
      suggestedPriority: 'LOW',
      checksumValid: false,
      receivedAt: new Date().toISOString(),
      processingTimeMs: Date.now() - start,
    };
  }

  const p = packet as Record<string, unknown>;
  const header = (typeof p.header === 'object' && p.header !== null) ? p.header as Record<string, unknown> : {};
  const body = (typeof p.body === 'object' && p.body !== null) ? p.body as Record<string, unknown> : {};
  const sig = (typeof p.signature === 'object' && p.signature !== null) ? p.signature as Record<string, unknown> : {};

  if (typeof p.header !== 'object' || p.header === null) errors.push('header is not an object');
  if (typeof p.body !== 'object' || p.body === null) errors.push('body is not an object');
  if (typeof p.signature !== 'object' || p.signature === null) errors.push('signature is not an object');

  // Header checks
  for (const field of REQUIRED_HEADER_FIELDS) {
    const present = field in header && header[field] != null;
    checks[`header.${field}`] = present;
    if (!present) errors.push(`Missing required header field: ${field}`);
  }

  const priority = String(header.priority ?? '');
  const priorityValid = VALID_PRIORITIES.has(priority);
  checks['header.priority_valid'] = priorityValid;
  if (priority && !priorityValid) {
    warnings.push(`Unknown priority '${priority}'`);
  }

  const seq = header.sequence_id;
  checks['header.sequence_id_type'] = typeof seq === 'number';
  if (seq != null && typeof seq !== 'number') {
    warnings.push(`sequence_id should be number, got ${typeof seq}`);
  }

  // Body checks
  for (const field of REQUIRED_BODY_FIELDS) {
    const present = field in body;
    checks[`body.${field}`] = present;
    if (!present) errors.push(`Missing required body field: ${field}`);
  }

  const intent = String(body.intent ?? '');
  const intentKnown = VALID_INTENTS.has(intent);
  checks['body.intent_known'] = intentKnown;
  if (intent && !intentKnown) {
    warnings.push(`Unknown intent '${intent}' — not in standard set`);
  }

  const payload = body.payload as Record<string, unknown> | undefined;
  checks['body.payload_has_type'] = typeof payload?.type === 'string';
  checks['body.payload_has_data'] = payload != null && 'data' in payload;

  // Signature checks
  for (const field of REQUIRED_SIG_FIELDS) {
    const present = field in sig;
    checks[`signature.${field}`] = present;
    if (!present) errors.push(`Missing signature field: ${field}`);
  }

  const checksumValid = verifyChecksum(packet);
  checks['signature.checksum_valid'] = checksumValid;
  if (!checksumValid) warnings.push('Checksum verification failed');

  // Health score (NaN-guarded)
  const totalChecks = Object.keys(checks).length;
  const passed = Object.values(checks).filter(Boolean).length;
  const healthScore = sanitizeFloat(totalChecks > 0 ? passed / totalChecks : 0);

  if (healthScore >= 0.9) notes.push('Signal is healthy and protocol-compliant');
  else if (healthScore >= 0.7) notes.push('Signal mostly compliant — minor issues detected');
  else notes.push('Signal has significant protocol deviations');

  // Emergency detection
  const isEmergency = priority === 'CRITICAL' || intent === 'EMERGENCY_HALT';
  let suggestedIntent: string;
  let suggestedPriority: Priority;

  if (isEmergency) {
    notes.push('⚠ EMERGENCY signal detected — immediate attention required');
    suggestedIntent = 'EMERGENCY_ACK';
    suggestedPriority = 'CRITICAL';
  } else if (intent === 'INTRODUCTION' || intent === 'HANDSHAKE_COMPLETE') {
    suggestedIntent = 'HANDSHAKE_COMPLETE';
    suggestedPriority = 'HIGH';
    notes.push('Handshake signal — responding with synchronization confirmation');
  } else if (intent === 'REQUEST_REASONING') {
    suggestedIntent = 'REASONING_RESPONSE';
    suggestedPriority = (priority as Priority) || 'MEDIUM';
  } else if (intent === 'QUERY') {
    suggestedIntent = 'QUERY_RESPONSE';
    suggestedPriority = (priority as Priority) || 'MEDIUM';
  } else if (intent === 'TELEMETRY' || intent === 'SENSORY_DATA') {
    suggestedIntent = 'TELEMETRY_ACK';
    suggestedPriority = 'LOW';
  } else {
    suggestedIntent = 'ECHO';
    suggestedPriority = (priority as Priority) || 'MEDIUM';
  }

  return {
    healthScore,
    healthNotes: notes,
    protocolChecks: checks,
    protocolErrors: errors,
    protocolWarnings: warnings,
    suggestedIntent,
    suggestedPriority,
    checksumValid,
    receivedAt: new Date().toISOString(),
    processingTimeMs: Date.now() - start,
  };
}

// ──────────────────────────────────────────────
// Bus Health Summary — aggregates multiple analyses
// ──────────────────────────────────────────────

export interface BusHealthSummary {
  totalPackets: number;
  healthyPackets: number;
  degradedPackets: number;
  criticalPackets: number;
  averageHealth: number;
  activeOrigins: string[];
  emergencyCount: number;
  timestamp: string;
}

export function summarizeBusHealth(packets: unknown[]): BusHealthSummary {
  if (!Array.isArray(packets) || packets.length === 0) {
    return {
      totalPackets: 0,
      healthyPackets: 0,
      degradedPackets: 0,
      criticalPackets: 0,
      averageHealth: 0,
      activeOrigins: [],
      emergencyCount: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const results = packets.map(analyzePacket);
  const total = results.length;
  const healthy = results.filter(r => r.healthScore >= 0.9).length;
  const degraded = results.filter(r => r.healthScore >= 0.7 && r.healthScore < 0.9).length;
  const critical = results.filter(r => r.healthScore < 0.7).length;
  const emergencies = results.filter(r =>
    r.healthNotes.some(n => n.includes('EMERGENCY'))
  ).length;
  const avgHealth = sanitizeFloat(results.reduce((sum, r) => sum + r.healthScore, 0) / total);

  const origins = new Set<string>();
  for (const p of packets) {
    if (typeof p === 'object' && p !== null) {
      const header = (p as Record<string, unknown>).header;
      if (typeof header === 'object' && header !== null) {
        const origin = (header as Record<string, unknown>).origin_id;
        if (typeof origin === 'string') origins.add(origin);
      }
    }
  }

  return {
    totalPackets: total,
    healthyPackets: healthy,
    degradedPackets: degraded,
    criticalPackets: critical,
    averageHealth: Math.round(avgHealth * 100) / 100,
    activeOrigins: Array.from(origins).sort(),
    emergencyCount: emergencies,
    timestamp: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────
// Bridge Builder: format analysis as CNS-compatible response packet
// ──────────────────────────────────────────────

export function buildHealthResponsePacket(
  analysis: AnalysisResult,
  originalPacket: USCPPacket,
  agentId = 'cns-echo-bridge',
): USCPPacket {
  return {
    header: {
      origin_id: agentId,
      timestamp: new Date().toISOString(),
      priority: analysis.suggestedPriority,
      sequence_id: (originalPacket.header.sequence_id ?? 0) + 1,
      destination_id: originalPacket.header.origin_id,
    },
    body: {
      intent: analysis.suggestedIntent as Intent,
      payload: {
        type: 'health-analysis',
        data: {
          echo: true,
          originalIntent: originalPacket.body.intent,
          originalOrigin: originalPacket.header.origin_id,
          healthScore: analysis.healthScore,
          protocolErrors: analysis.protocolErrors,
          warnings: analysis.protocolWarnings,
          notes: analysis.healthNotes,
          agent: 'cns-echo-bridge',
        },
      },
    },
    signature: {
      type: 'sha256',
      checksum: 'verified',
    },
  };
}

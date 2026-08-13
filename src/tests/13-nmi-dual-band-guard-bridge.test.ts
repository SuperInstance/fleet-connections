// ============================================================================
// Tests for Connection 13: Hermes-NMI ↔ Dual-Band-Guard Bridge
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  classifyExecutionSurprise,
  extractSurpriseFromExecution,
  buildFeedbackReport,
  type ExecutionSurprise,
} from '../connections/13-nmi-dual-band-guard-bridge.js';

// ── Helpers ──

function smallSurprise(overrides: Partial<ExecutionSurprise> = {}): ExecutionSurprise {
  return {
    intent: 'Navigate',
    prediction: 'Success',
    observation: 'Success',
    magnitude: 0.05,
    recurrence: 1,
    hasOscillated: false,
    tensionAtExecution: 0.0,
    ...overrides,
  };
}

function largeSurprise(overrides: Partial<ExecutionSurprise> = {}): ExecutionSurprise {
  return {
    intent: 'Interact',
    prediction: 'Success',
    observation: 'Error: agent crashed',
    magnitude: 0.9,
    recurrence: 1,
    hasOscillated: false,
    tensionAtExecution: 0.3,
    ...overrides,
  };
}

function oscillatingSurprise(overrides: Partial<ExecutionSurprise> = {}): ExecutionSurprise {
  return {
    intent: 'Navigate',
    prediction: 'Arrived at target',
    observation: 'Arrived at wrong position',
    magnitude: 0.4,
    recurrence: 3,
    hasOscillated: true,
    tensionAtExecution: 0.5,
    ...overrides,
  };
}

function recurringSurprise(count: number): ExecutionSurprise {
  return {
    intent: 'Observe',
    prediction: 'Sensor data collected',
    observation: 'Sensor timeout',
    magnitude: 0.3,
    recurrence: count,
    hasOscillated: false,
    tensionAtExecution: 0.2,
  };
}

// ── Classification Tests ──

describe('NMI ↔ Dual-Band-Guard Bridge — Classification', () => {
  describe('correctable surprises', () => {
    test('small first-time error is correctable', () => {
      const result = classifyExecutionSurprise(smallSurprise());
      expect(result.band).toBe('correctable');
      expect(result.routing).toBe('train');
    });

    test('moderate first-time error at low tension is correctable', () => {
      const result = classifyExecutionSurprise(largeSurprise({ recurrence: 1, tensionAtExecution: 0.2 }));
      expect(result.band).toBe('correctable');
      expect(result.routing).toBe('train');
    });

    test('zero magnitude (success) is correctable', () => {
      const result = classifyExecutionSurprise(smallSurprise({ magnitude: 0.0 }));
      expect(result.band).toBe('correctable');
      expect(result.routing).toBe('train');
    });

    test('exactly at magnitude floor is correctable', () => {
      const result = classifyExecutionSurprise(smallSurprise({ magnitude: 0.009 }));
      expect(result.band).toBe('correctable');
    });
  });

  describe('irreducible surprises', () => {
    test('oscillating surprise is irreducible', () => {
      const result = classifyExecutionSurprise(oscillatingSurprise());
      expect(result.band).toBe('irreducible');
      expect(result.routing).toBe('preserve');
      expect(result.explanation).toContain('oscillated');
    });

    test('surprise recurring past threshold is irreducible', () => {
      const result = classifyExecutionSurprise(recurringSurprise(7));
      expect(result.band).toBe('irreducible');
      expect(result.routing).toBe('preserve');
      expect(result.explanation).toContain('threshold');
    });

    test('surprise recurring well past threshold is irreducible', () => {
      const result = classifyExecutionSurprise(recurringSurprise(20));
      expect(result.band).toBe('irreducible');
    });

    test('oscillation overrides low recurrence', () => {
      const result = classifyExecutionSurprise(oscillatingSurprise({ recurrence: 1 }));
      expect(result.band).toBe('irreducible');
    });
  });

  describe('escalation', () => {
    test('high tension + high magnitude escalates', () => {
      const result = classifyExecutionSurprise(largeSurprise({
        tensionAtExecution: 0.85,
        magnitude: 0.7,
        recurrence: 1,
        hasOscillated: false,
      }));
      expect(result.routing).toBe('escalate');
      expect(result.band).toBe('irreducible');
      expect(result.explanation).toContain('Escalating');
    });

    test('high tension + low magnitude does NOT escalate', () => {
      const result = classifyExecutionSurprise(smallSurprise({
        tensionAtExecution: 0.9,
        magnitude: 0.005,
      }));
      expect(result.routing).toBe('train');
    });

    test('low tension + high magnitude does NOT escalate', () => {
      const result = classifyExecutionSurprise(largeSurprise({
        tensionAtExecution: 0.3,
        magnitude: 0.6,
        recurrence: 1,
      }));
      expect(result.routing).toBe('train');
    });

    test('exactly 0.8 tension with 0.5 magnitude does NOT escalate (boundary)', () => {
      const result = classifyExecutionSurprise(largeSurprise({
        tensionAtExecution: 0.8,
        magnitude: 0.5,
        recurrence: 1,
      }));
      // Condition is > 0.8 AND > 0.5, so exactly at boundary doesn't trigger
      expect(result.routing).not.toBe('escalate');
    });
  });
});

// ── Surprise Extraction Tests ──

describe('NMI ↔ Dual-Band-Guard Bridge — Surprise Extraction', () => {
  test('success produces zero magnitude', () => {
    const s = extractSurpriseFromExecution('Navigate', 'Success', 'Success', 3, 0.1, 0);
    expect(s.magnitude).toBe(0.0);
    expect(s.recurrence).toBe(1);
    expect(s.hasOscillated).toBe(false);
  });

  test('Error state produces high magnitude', () => {
    const s = extractSurpriseFromExecution('Navigate', 'Success', 'Error: crashed', 2, 0.3, 0);
    expect(s.magnitude).toBe(0.9);
  });

  test('Failure state produces moderate magnitude', () => {
    const s = extractSurpriseFromExecution('Interact', 'Success', 'Failure', 1, 0.2, 0);
    expect(s.magnitude).toBe(0.6);
  });

  test('PartialSuccess produces low magnitude', () => {
    const s = extractSurpriseFromExecution('Observe', 'FullData', 'PartialSuccess', 1, 0.1, 0);
    expect(s.magnitude).toBe(0.3);
  });

  test('recurrence increments from previous failures', () => {
    const s = extractSurpriseFromExecution('Navigate', 'Success', 'Error', 1, 0.2, 5);
    expect(s.recurrence).toBe(6);
  });

  test('success after previous failures marks oscillation', () => {
    const s = extractSurpriseFromExecution('Navigate', 'Success', 'Success', 2, 0.1, 3);
    expect(s.hasOscillated).toBe(true);
  });

  test('success with no previous failures does NOT oscillate', () => {
    const s = extractSurpriseFromExecution('Navigate', 'Success', 'Success', 1, 0.1, 0);
    expect(s.hasOscillated).toBe(false);
  });

  test('tension is preserved', () => {
    const s = extractSurpriseFromExecution('Rest', 'Idle', 'Idle', 0, 0.65, 0);
    expect(s.tensionAtExecution).toBe(0.65);
  });
});

// ── Feedback Report Tests ──

describe('NMI ↔ Dual-Band-Guard Bridge — Feedback Report', () => {
  test('empty classified list produces empty report', () => {
    const report = buildFeedbackReport([]);
    expect(report.totalSurprises).toBe(0);
    expect(report.preservationRatio).toBe(0);
    expect(report.isDomesticated).toBe(false);
  });

  test('all correctable produces low preservation ratio', () => {
    const classified = [
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(smallSurprise()),
    ];
    const report = buildFeedbackReport(classified);
    expect(report.correctable).toBe(3);
    expect(report.irreducible).toBe(0);
    expect(report.preservationRatio).toBe(0);
    expect(report.isDomesticated).toBe(false); // only 3 items, not > 5
  });

  test('domestication trap detected when >5 surprises all correctable', () => {
    const classified = Array.from({ length: 6 }, () =>
      classifyExecutionSurprise(smallSurprise()),
    );
    const report = buildFeedbackReport(classified);
    expect(report.isDomesticated).toBe(true);
    expect(report.summary).toContain('WARNING');
  });

  test('mixed classification produces balanced ratio', () => {
    const classified = [
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(oscillatingSurprise()),
      classifyExecutionSurprise(recurringSurprise(10)),
    ];
    const report = buildFeedbackReport(classified);
    expect(report.correctable).toBe(2);
    expect(report.irreducible).toBe(2);
    expect(report.preservationRatio).toBe(0.5);
    // At exactly 0.5, it's not > 0.5, so summary should be healthy
    expect(report.summary).toContain('Healthy');
  });

  test('escalated surprises are counted separately', () => {
    const classified = [
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(largeSurprise({ tensionAtExecution: 0.9, magnitude: 0.7 })),
      classifyExecutionSurprise(largeSurprise({ tensionAtExecution: 0.9, magnitude: 0.7 })),
    ];
    const report = buildFeedbackReport(classified);
    expect(report.escalated).toBe(2);
    expect(report.summary).toContain('escalated');
  });

  test('healthy mix produces healthy summary', () => {
    const classified = [
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(smallSurprise()),
      classifyExecutionSurprise(oscillatingSurprise()),
    ];
    const report = buildFeedbackReport(classified);
    expect(report.summary).toContain('Healthy');
    expect(report.preservationRatio).toBeCloseTo(0.25);
  });

  test('preservation ratio is in unit interval', () => {
    for (let i = 0; i <= 10; i++) {
      const classified = Array.from({ length: 10 }, (_, j) =>
        classifyExecutionSurprise(j < i ? oscillatingSurprise() : smallSurprise()),
      );
      const report = buildFeedbackReport(classified);
      expect(report.preservationRatio).toBeGreaterThanOrEqual(0);
      expect(report.preservationRatio).toBeLessThanOrEqual(1);
    }
  });
});

// ── Integration Scenario Tests ──

describe('NMI ↔ Dual-Band-Guard Bridge — Integration Scenarios', () => {
  test('full cycle: navigate → fail → classify → report', () => {
    // Agent tries to navigate, gets an error
    const surprise = extractSurpriseFromExecution(
      'Navigate', 'Success', 'Error: path blocked', 2, 0.3, 0,
    );
    expect(surprise.magnitude).toBe(0.9);

    const classified = classifyExecutionSurprise(surprise);
    expect(classified.band).toBe('correctable'); // first time, no oscillation
    expect(classified.routing).toBe('train');

    const report = buildFeedbackReport([classified]);
    expect(report.totalSurprises).toBe(1);
    expect(report.correctable).toBe(1);
  });

  test('full cycle: repeated navigation failures → irreducible', () => {
    // Same navigation error keeps happening
    const surprises = Array.from({ length: 8 }, (_, i) =>
      extractSurpriseFromExecution('Navigate', 'Success', 'Error: path blocked', 1, 0.4, i),
    );
    const classified = surprises.map(classifyExecutionSurprise);
    const report = buildFeedbackReport(classified);

    // The last one should be irreducible (recurrence 8 > threshold 7)
    expect(classified[7].band).toBe('irreducible');
    expect(report.irreducible).toBeGreaterThanOrEqual(1);
  });

  test('full cycle: high tension crash → escalation', () => {
    // Agent is under extreme tension and crashes
    const surprise = extractSurpriseFromExecution(
      'Reflex', 'Success', 'Error: system overload', 1, 0.95, 0,
    );
    const classified = classifyExecutionSurprise(surprise);

    expect(classified.routing).toBe('escalate');
    expect(classified.band).toBe('irreducible');

    const report = buildFeedbackReport([classified]);
    expect(report.escalated).toBe(1);
  });
});

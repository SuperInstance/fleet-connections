// ============================================================================
// Connection 13: Hermes-NMI ↔ Dual-Band-Guard Bridge
// ============================================================================
//
// The NMI translates intent into muscle commands. When a command fails
// (agent in error state, energy exceeded, constraint violated), the
// resulting surprise needs classification: is this a learnable mistake
// (the model should adapt) or an irreducible feature of the environment
// (the model should preserve this knowledge without adapting)?
//
// The dual-band-guard makes this classification. The bridge feeds
// execution failures from the NMI into the guard's classification,
// producing a routing decision: train on this error, or log it as
// irreducible world-knowledge.
//
// Flow:
//   NMI dispatch → execution result → surprise extraction → guard classify
//   → correctable: feed back as training signal
//   → irreducible: preserve in tension log (the world refused to be modeled)
// ============================================================================

// ── Types (mirrors from hermes-nmi and dual-band-guard) ──

export type SurpriseBand = 'correctable' | 'irreducible';

export interface ExecutionSurprise {
  /** The intent that was dispatched. */
  intent: string;
  /** What was predicted to happen. */
  prediction: string;
  /** What actually happened. */
  observation: string;
  /** Magnitude of the error (0.0 = perfect, 1.0 = complete failure). */
  magnitude: number;
  /** How many times this type of surprise has occurred. */
  recurrence: number;
  /** Whether the surprise has decreased after a previous occurrence. */
  hasOscillated: boolean;
  /** Tension level at time of execution (0.0–1.0). */
  tensionAtExecution: number;
}

export interface ClassifiedSurprise {
  surprise: ExecutionSurprise;
  band: SurpriseBand;
  /** What should happen next. */
  routing: 'train' | 'preserve' | 'escalate';
  /** Human-readable explanation. */
  explanation: string;
}

// ── Bridge Logic ──

const CORRECTABLE_RECURRENCE_THRESHOLD = 7;
const IRREDUCIBLE_MAGNITUDE_FLOOR = 0.01;

/**
 * Classify an execution surprise using dual-band-guard logic.
 *
 * Mirrors StructuralGuard from dual-band-guard:
 * - Below magnitude floor → correctable (too small to matter)
 * - Has oscillated (came back after correction) → irreducible
 * - Recurred past threshold → irreducible
 * - Otherwise → correctable
 */
export function classifyExecutionSurprise(surprise: ExecutionSurprise): ClassifiedSurprise {
  // Below the floor — too small to care about
  if (surprise.magnitude < IRREDUCIBLE_MAGNITUDE_FLOOR) {
    return {
      surprise,
      band: 'correctable',
      routing: 'train',
      explanation: `Magnitude ${surprise.magnitude.toFixed(4)} below floor ${IRREDUCIBLE_MAGNITUDE_FLOOR}. Minor error — safe to learn from.`,
    };
  }

  // Oscillating — the world keeps refusing the correction
  if (surprise.hasOscillated) {
    return {
      surprise,
      band: 'irreducible',
      routing: 'preserve',
      explanation: `Surprise oscillated after correction. The environment is refusing to be modeled here. Preserving as irreducible.`,
    };
  }

  // Recurring past threshold — not converging
  if (surprise.recurrence >= CORRECTABLE_RECURRENCE_THRESHOLD) {
    return {
      surprise,
      band: 'irreducible',
      routing: 'preserve',
      explanation: `Surprise recurred ${surprise.recurrence} times (threshold: ${CORRECTABLE_RECURRENCE_THRESHOLD}). Model is not converging. Preserving as irreducible.`,
    };
  }

  // High tension amplifies — if tension is critical and magnitude is high, escalate
  if (surprise.tensionAtExecution > 0.8 && surprise.magnitude > 0.5) {
    return {
      surprise,
      band: 'irreducible',
      routing: 'escalate',
      explanation: `High tension (${surprise.tensionAtExecution.toFixed(2)}) + high magnitude (${surprise.magnitude.toFixed(2)}). Agent is strained and the error is large. Escalating to CNS for re-routing.`,
    };
  }

  // Normal correctable error
  return {
    surprise,
    band: 'correctable',
    routing: 'train',
    explanation: `First-time error (magnitude ${surprise.magnitude.toFixed(4)}, recurrence ${surprise.recurrence}). Model can learn from this.`,
  };
}

/**
 * Extract a surprise from an NMI execution result.
 *
 * Compares what was expected (the command chain) with what happened
 * (the telemetry). Produces a surprise suitable for guard classification.
 */
export function extractSurpriseFromExecution(
  intent: string,
  expectedState: string,
  actualState: string,
  stepCount: number,
  tension: number,
  previousFailures: number,
): ExecutionSurprise {
  const succeeded = actualState === 'Success' || actualState === 'Idle';
  const prediction = expectedState;
  const observation = succeeded ? expectedState : actualState;

  // Magnitude: 0 if success, proportional to failure type
  let magnitude = 0.0;
  if (!succeeded) {
    if (actualState.startsWith('Error')) magnitude = 0.9;
    else if (actualState === 'Failure') magnitude = 0.6;
    else if (actualState === 'PartialSuccess') magnitude = 0.3;
    else magnitude = 0.4; // unknown state — moderate surprise
  }

  return {
    intent,
    prediction,
    observation,
    magnitude,
    recurrence: previousFailures + 1,
    hasOscillated: previousFailures > 0 && succeeded, // succeeded after previous failure = oscillation on next failure
    tensionAtExecution: tension,
  };
}

/**
 * Build a feedback report for the CNS from classified surprises.
 *
 * This is how the NMI tells the brain: "here's what I learned,
 * here's what I couldn't learn, and here's what I need you to decide."
 */
export interface FeedbackReport {
  totalSurprises: number;
  correctable: number;
  irreducible: number;
  escalated: number;
  preservationRatio: number;
  isDomesticated: boolean;
  summary: string;
}

export function buildFeedbackReport(classified: ClassifiedSurprise[]): FeedbackReport {
  const total = classified.length;
  const correctable = classified.filter(c => c.band === 'correctable').length;
  const irreducible = classified.filter(c => c.band === 'irreducible').length;
  const escalated = classified.filter(c => c.routing === 'escalate').length;
  const preservationRatio = total > 0 ? irreducible / total : 0;

  // Domestication trap: zero preservation means the system is consuming everything
  const isDomesticated = total > 5 && preservationRatio === 0.0;

  let summary: string;
  if (isDomesticated) {
    summary = `WARNING: Domestication trap detected. ${total} surprises classified, all correctable. The system is consuming everything — no irreducible knowledge preserved.`;
  } else if (escalated > 0) {
    summary = `${escalated} surprise(s) escalated to CNS. ${correctable} correctable, ${irreducible} irreducible. Agent needs guidance.`;
  } else if (preservationRatio > 0.5) {
    summary = `High preservation ratio (${(preservationRatio * 100).toFixed(1)}%). The environment is largely irreducible for this agent. Consider re-routing or upgrading equipment.`;
  } else {
    summary = `Healthy classification. ${correctable} correctable, ${irreducible} irreducible. Preservation ratio: ${(preservationRatio * 100).toFixed(1)}%.`;
  }

  return {
    totalSurprises: total,
    correctable,
    irreducible,
    escalated,
    preservationRatio,
    isDomesticated,
    summary,
  };
}

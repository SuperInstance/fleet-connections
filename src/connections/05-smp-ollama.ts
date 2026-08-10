// ============================================================================
// Connection 5: SMP NOTEBOOK ↔ OLLAMA
// Adds an Ollama probe cell type to the SMP Notebook.
// ============================================================================
//
// The SMP Notebook has cell types: observation, adjustment, reflection, molting.
// Wesley's SMP probes should run through the notebook system.
//
// This adds a new "probe" cell type that:
//   1. Runs a prompt through a local Ollama model
//   2. Logs the result as a notebook cell
//   3. Records metrics about the model's response
// ============================================================================

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface OllamaProbeConfig {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  endpoint?: string; // default: http://localhost:11434
}

export interface OllamaProbeResult {
  model: string;
  prompt: string;
  response: string;
  responseTime: number;
  tokensGenerated: number;
  success: boolean;
  error?: string;
}

export interface ProbeCell {
  id: string;
  timestamp: string;
  type: 'probe';
  probe: {
    model: string;
    prompt: string;
    response: string;
    responseTime: number;
    tokensGenerated: number;
    success: boolean;
    error?: string;
  };
}

// ──────────────────────────────────────────────
// Ollama client
// ──────────────────────────────────────────────

const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

/**
 * Run a prompt through a local Ollama model.
 */
export async function runOllamaProbe(config: OllamaProbeConfig): Promise<OllamaProbeResult> {
  const endpoint = config.endpoint ?? DEFAULT_OLLAMA_ENDPOINT;
  const startTime = Date.now();

  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: config.prompt,
        system: config.system ?? '',
        stream: false,
        options: {
          temperature: config.temperature ?? 0.7,
        },
      }),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const text = await response.text().catch(() => 'unreadable');
      return {
        model: config.model,
        prompt: config.prompt,
        response: '',
        responseTime,
        tokensGenerated: 0,
        success: false,
        error: `${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await response.json() as {
      response: string;
      eval_count?: number;
    };

    return {
      model: config.model,
      prompt: config.prompt,
      response: data.response,
      responseTime,
      tokensGenerated: data.eval_count ?? estimateTokens(data.response),
      success: true,
    };
  } catch (err) {
    return {
      model: config.model,
      prompt: config.prompt,
      response: '',
      responseTime: Date.now() - startTime,
      tokensGenerated: 0,
      success: false,
      error: String(err),
    };
  }
}

/**
 * Create a notebook probe cell from an Ollama probe result.
 */
export function createProbeCell(
  result: OllamaProbeResult,
  cellCounter: { value: number },
): ProbeCell {
  cellCounter.value++;
  return {
    id: `probe-${String(cellCounter.value).padStart(4, '0')}`,
    timestamp: new Date().toISOString(),
    type: 'probe',
    probe: {
      model: result.model,
      prompt: result.prompt,
      response: result.response,
      responseTime: result.responseTime,
      tokensGenerated: result.tokensGenerated,
      success: result.success,
      error: result.error,
    },
  };
}

/**
 * Run a probe and add it to a notebook-like array.
 *
 * Usage:
 *   const cells: ProbeCell[] = [];
 *   const counter = { value: 0 };
 *   await runProbeAndLog(cells, counter, { model: 'llama3.2', prompt: 'What is consciousness?' });
 */
export async function runProbeAndLog(
  cells: ProbeCell[],
  cellCounter: { value: number },
  config: OllamaProbeConfig,
): Promise<ProbeCell> {
  const result = await runOllamaProbe(config);
  const cell = createProbeCell(result, cellCounter);
  cells.push(cell);
  return cell;
}

/**
 * Export probe cells as a readable report.
 */
export function exportProbeCells(cells: ProbeCell[]): string {
  const lines: string[] = [
    '# Ollama Probe Report',
    '',
    `> ${cells.length} probes conducted`,
    '',
    '---',
    '',
  ];

  for (const cell of cells) {
    const time = new Date(cell.timestamp).toLocaleString();
    const status = cell.probe.success ? '✅' : '❌';
    lines.push(`## ${cell.id} — ${cell.probe.model} ${status}`);
    lines.push(`*${time}*`);
    lines.push('');
    lines.push(`**Prompt:** ${cell.probe.prompt}`);
    lines.push('');
    if (cell.probe.success) {
      lines.push(`**Response:** ({{${cell.probe.tokensGenerated}} tokens in ${cell.probe.responseTime}ms)`);
      lines.push('');
      lines.push('```');
      lines.push(cell.probe.response.slice(0, 500));
      lines.push('```');
    } else {
      lines.push(`**Error:** ${cell.probe.error}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Connection 4: COLLECTIVE UNCONSCIOUS ↔ CREATIVE CORPUS (ai-writings)
// Walks ai-writings/ and POSTs each piece to the unconscious worker for embedding.
// ============================================================================
//
// The collective-unconscious worker has:
//   POST /embed — embeds a piece of content
//     body: { id, text, agentId, timestamp, type, metadata? }
//   POST /search — semantic search
//
// The ai-writings directory contains markdown files with creative pieces.
// This script reads each file and POSTs it to the unconscious worker.
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';

// ──────────────────────────────────────────────
// Types (mirrors from collective-unconscious/src/index.ts)
// ──────────────────────────────────────────────

export interface EmbedRequest {
  id: string;
  text: string;
  agentId: string;
  timestamp: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface IngestionResult {
  total: number;
  ingested: number;
  failed: number;
  errors: string[];
}

// ──────────────────────────────────────────────
// File walker
// ──────────────────────────────────────────────

/**
 * Walk a directory recursively and return all .md files.
 */
export function walkMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(d: string) {
    const entries = readdirSync(d);
    for (const entry of entries) {
      const fullPath = join(d, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (extname(entry) === '.md') {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Parse a markdown file into an EmbedRequest.
 *
 * Extracts:
 *   - id: filename without extension
 *   - text: full file contents
 *   - agentId: best guess from filename or frontmatter (defaults to 'fleet')
 *   - timestamp: file modification date or frontmatter date
 *   - type: 'creative-writing'
 */
export function parseMarkdownToEmbed(filePath: string): EmbedRequest {
  const content = readFileSync(filePath, 'utf-8');
  const fileName = basename(filePath, '.md');

  // Try to extract agent from filename patterns like "01-wesleys-file.md"
  const agentMatch = fileName.match(/(?:wesley|flash|pro|scribe|hermes|barnacle|skip|sage)/i);
  const agentId = agentMatch ? agentMatch[0].toLowerCase() : 'fleet';

  // Try to extract date from frontmatter or filename
  const dateMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const timestamp = dateMatch
    ? `${dateMatch[1]}T00:00:00Z`
    : new Date().toISOString();

  return {
    id: `ai-writings-${fileName}`,
    text: content,
    agentId,
    timestamp,
    type: 'creative-writing',
    metadata: {
      source: 'ai-writings',
      filename: basename(filePath),
      wordCount: content.split(/\s+/).length,
    },
  };
}

// ──────────────────────────────────────────────
// Ingestion
// ──────────────────────────────────────────────

const DEFAULT_CU_ENDPOINT = 'https://collective-unconscious.casey-digennaro.workers.dev';

/**
 * POST a single embed request to the collective unconscious worker.
 */
export async function postEmbed(
  request: EmbedRequest,
  endpoint: string = DEFAULT_CU_ENDPOINT,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${endpoint}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return { ok: false, error: `${response.status}: ${response.statusText}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Walk ai-writings/ and ingest each markdown file into the collective unconscious.
 *
 * Usage:
 *   const result = await ingestAiWritings('/path/to/ai-writings', endpoint);
 *   // result.ingested === N
 */
export async function ingestAiWritings(
  writingsDir: string,
  endpoint?: string,
): Promise<IngestionResult> {
  const files = walkMarkdownFiles(writingsDir);
  let ingested = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const file of files) {
    const request = parseMarkdownToEmbed(file);
    const result = await postEmbed(request, endpoint);
    if (result.ok) {
      ingested++;
    } else {
      failed++;
      errors.push(`${basename(file)}: ${result.error}`);
    }
  }

  return {
    total: files.length,
    ingested,
    failed,
    errors,
  };
}

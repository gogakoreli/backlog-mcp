import type { Entity } from '@backlog-mcp/shared';
import type { Resource, SearchSnippet } from './types.js';

// ── Server-side snippet generation (ADR-0073) ──────────────────────
//
// Generates plain-text snippets server-side so both MCP tools and HTTP
// endpoints return consistent match context. This is the single source
// of truth for snippet generation — the UI's client-side @orama/highlight
// can still be used for HTML rendering, but the server snippet provides
// the canonical match context for MCP tool consumers.

const SNIPPET_WINDOW = 120; // chars of context around match

/**
 * Generate a plain-text snippet for a task, showing where the query matched.
 */
export function generateTaskSnippet(task: Entity, query: string): SearchSnippet {
  const fields: { name: string; value: string }[] = [
    { name: 'title', value: task.title },
    { name: 'description', value: task.description || '' },
    { name: 'evidence', value: (task.evidence || []).join(' ') },
    { name: 'blocked_reason', value: (task.blocked_reason || []).join(' ') },
    { name: 'references', value: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' ') },
  ];
  return generateSnippetFromFields(fields, query);
}

/**
 * Generate a plain-text snippet for a resource.
 */
export function generateResourceSnippet(resource: Resource, query: string): SearchSnippet {
  const fields: { name: string; value: string }[] = [
    { name: 'title', value: resource.title },
    { name: 'content', value: resource.content },
  ];
  return generateSnippetFromFields(fields, query);
}

/**
 * Core snippet generation: finds the first field containing a query match,
 * extracts a window of context around it, and lists all matched fields.
 */
function generateSnippetFromFields(
  fields: { name: string; value: string }[],
  query: string,
): SearchSnippet {
  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/).filter(Boolean);
  const matchedFields: string[] = [];
  let firstField = '';
  let firstText = '';

  for (const { name, value } of fields) {
    if (!value) continue;
    const valueLower = value.toLowerCase();
    // Check if any query word appears in this field
    const hasMatch = queryWords.some(w => valueLower.includes(w));
    if (!hasMatch) continue;

    matchedFields.push(name);

    if (!firstField) {
      firstField = name;
      // Find first query word position and extract window
      let earliestPos = valueLower.length;
      for (const w of queryWords) {
        const pos = valueLower.indexOf(w);
        if (pos !== -1 && pos < earliestPos) earliestPos = pos;
      }

      const windowStart = Math.max(0, earliestPos - 30);
      const windowEnd = Math.min(value.length, windowStart + SNIPPET_WINDOW);
      let text = value.slice(windowStart, windowEnd).trim();
      // Add ellipsis if we truncated
      if (windowStart > 0) text = '...' + text;
      if (windowEnd < value.length) text = text + '...';
      // Collapse whitespace for clean output
      firstText = text.replace(/\s+/g, ' ');
    }
  }

  if (!firstField) {
    // No match found — fallback to title
    return { field: 'title', text: fields[0]?.value || '', matched_fields: [] };
  }

  return { field: firstField, text: firstText, matched_fields: matchedFields };
}

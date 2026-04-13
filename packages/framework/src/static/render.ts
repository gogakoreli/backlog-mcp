/**
 * Static HTML renderer for Nisli-style templates.
 *
 * This module is intentionally DOM-free. It renders tagged templates to HTML
 * strings for build-time/static use cases, not live browser bindings.
 */

export interface StaticResult {
  toString(): string;
  __staticResult: true;
}

export interface RawHtml {
  value: string;
  __raw: true;
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch] ?? ch);
}

function isStaticResult(value: unknown): value is StaticResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__staticResult' in value &&
    (value as StaticResult).__staticResult === true &&
    typeof (value as StaticResult).toString === 'function'
  );
}

function isRawHtml(value: unknown): value is RawHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__raw' in value &&
    (value as RawHtml).__raw === true &&
    typeof (value as RawHtml).value === 'string'
  );
}

export function staticHtml(strings: TemplateStringsArray, ...values: unknown[]): StaticResult {
  const result: string[] = [];

  for (let i = 0; i < strings.length; i++) {
    result.push(strings[i] ?? '');

    if (i < values.length) {
      result.push(renderToString(values[i]));
    }
  }

  const output = result.join('');

  return {
    __staticResult: true as const,
    toString: () => output,
  };
}

export function raw(value: string): RawHtml {
  return {
    __raw: true as const,
    value,
  };
}

export function renderToString(value: unknown): string {
  if (value == null || value === false || value === true) {
    return '';
  }

  if (isStaticResult(value)) {
    return value.toString();
  }

  if (isRawHtml(value)) {
    return value.value;
  }

  if (Array.isArray(value)) {
    return value.map(renderToString).join('');
  }

  return escapeHtml(String(value));
}

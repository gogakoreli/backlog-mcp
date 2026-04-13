/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { raw, renderToString, staticHtml, type StaticResult } from './index.js';

describe('static html renderer', () => {
  it('renders static markup', () => {
    const result = staticHtml`<p>Hello</p>`;

    expect(result.toString()).toBe('<p>Hello</p>');
    expect(result.__staticResult).toBe(true);
  });

  it('escapes interpolated values by default', () => {
    const result = staticHtml`<p>${`&<>"'`}</p>`;

    expect(result.toString()).toBe('<p>&amp;&lt;&gt;&quot;&#39;</p>');
  });

  it('escapes rendered primitive values', () => {
    expect(renderToString('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderToString(42)).toBe('42');
    expect(renderToString(0)).toBe('0');
  });

  it('preserves raw html', () => {
    const result = staticHtml`<article>${raw('<strong>safe upstream html</strong>')}</article>`;

    expect(result.toString()).toBe('<article><strong>safe upstream html</strong></article>');
    expect(renderToString(raw('<em>trusted</em>'))).toBe('<em>trusted</em>');
  });

  it('renders nested templates', () => {
    const child = staticHtml`<span>${'Nested'}</span>`;
    const parent = staticHtml`<div>${child}</div>`;

    expect(parent.toString()).toBe('<div><span>Nested</span></div>');
  });

  it('flattens arrays recursively', () => {
    const result = staticHtml`<ul>${[
      staticHtml`<li>${'A'}</li>`,
      [staticHtml`<li>${'B'}</li>`, null, false],
      raw('<li>C</li>'),
    ]}</ul>`;

    expect(result.toString()).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
  });

  it('renders nullish and boolean values as empty strings', () => {
    expect(renderToString(null)).toBe('');
    expect(renderToString(undefined)).toBe('');
    expect(renderToString(false)).toBe('');
    expect(renderToString(true)).toBe('');
    expect(staticHtml`a${null}b${undefined}c${false}d${true}e`.toString()).toBe('abcde');
  });

  it('uses the same resolution rules for renderToString and interpolation', () => {
    const value = [staticHtml`<b>${'bold'}</b>`, raw('<i>raw</i>'), '<plain>'];

    expect(renderToString(value)).toBe('<b>bold</b><i>raw</i>&lt;plain&gt;');
    expect(staticHtml`${value}`.toString()).toBe('<b>bold</b><i>raw</i>&lt;plain&gt;');
  });

  it('does not require browser globals', () => {
    expect('document' in globalThis).toBe(false);
    expect('customElements' in globalThis).toBe(false);
  });

  it('only treats branded static results as trusted templates', () => {
    const fake: StaticResult = {
      __staticResult: true,
      toString: () => '<strong>ok</strong>',
    };

    expect(renderToString(fake)).toBe('<strong>ok</strong>');
    expect(renderToString({ toString: () => '<strong>escaped</strong>' })).toBe('&lt;strong&gt;escaped&lt;/strong&gt;');
  });
});

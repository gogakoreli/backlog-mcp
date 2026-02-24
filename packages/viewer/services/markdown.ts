/**
 * markdown.ts — Shared marked + highlight.js configuration.
 *
 * Single source of truth for markdown parsing and syntax highlighting.
 * Consumed by md-block (markdown rendering) and resource-viewer (code files).
 */

import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import { markedHighlight } from 'marked-highlight';
import 'highlight.js/styles/github-dark.css';

import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

// ── hljs language registration ──────────────────────────────────────
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

// ── marked configuration ────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: true });

marked.use(markedHighlight({
  emptyLangClass: 'hljs',
  langPrefix: 'hljs language-',
  highlight(code: string, lang: string) {
    if (lang === 'mermaid') return code;
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
}));

marked.use({
  extensions: [{
    name: 'autolink',
    level: 'inline' as const,
    start(src: string) { return src.match(/(https?|file|mcp):\/\//)?.index; },
    tokenizer(src: string) {
      const match = src.match(/^(https?|file|mcp):\/\/[^\s<>"']+/);
      if (match) return { type: 'link', raw: match[0], href: match[0], text: match[0], tokens: [] };
    },
  }],
  renderer: {
    code(token: { text: string; lang?: string }) {
      if (token.lang === 'mermaid') {
        return `<pre class="mermaid">${token.text}</pre>`;
      }
      return false as unknown as string;
    },
    heading(token: { text: string; depth: number }) {
      const level = Math.min(6, token.depth);
      const id = token.text.toLowerCase().replace(/[^\w]+/g, '-');
      return `<h${level} id="${id}">${token.text}</h${level}>`;
    },
    link(token: { href: string; title?: string | null; text: string }) {
      const title = token.title ? ` title="${token.title}"` : '';
      if (token.href.startsWith('http')) {
        return `<a href="${token.href}"${title} target="_blank" rel="noopener">${token.text}</a>`;
      }
      return `<a href="${token.href}"${title}>${token.text}</a>`;
    },
  },
});

export { marked, hljs };

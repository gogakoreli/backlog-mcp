/**
 * <md-block> custom element
 * @author Lea Verou
 * Modified: bundled deps, file:// link support
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

let Prism: any = null;

// Fix indentation
function deIndent(text: string) {
	let indent = text.match(/^[\r\n]*([\t ]+)/);

	if (indent) {
		text = text.replace(RegExp("^" + indent[1], "gm"), "");
	}

	return text;
}

export class MarkdownElement extends HTMLElement {
	_mdContent: string | undefined;
	_contentFromHTML = false;
	untrusted = false;
	renderer: Record<string, any>;
	static renderer: Record<string, any> = {};

	constructor() {
		super();

		this.renderer = Object.assign({}, (this.constructor as typeof MarkdownElement).renderer);

		for (let property in this.renderer) {
			this.renderer[property] = this.renderer[property].bind(this);
		}
	}

	get rendered() {
		return this.getAttribute("rendered");
	}

	get mdContent() {
		return this._mdContent;
	}

	set mdContent(html: string | undefined) {
		this._mdContent = html;
		this._contentFromHTML = false;

		this.render();
	}

	connectedCallback() {
		Object.defineProperty(this, "untrusted", {
			value: this.hasAttribute("untrusted"),
			enumerable: true,
			configurable: false,
			writable: false
		});

		if (this._mdContent === undefined) {
			this._contentFromHTML = true;
			this._mdContent = deIndent(this.innerHTML);
			// https://github.com/markedjs/marked/issues/874#issuecomment-339995375
			// marked expects markdown quotes (>) to be un-escaped, otherwise they won't render correctly
			this._mdContent = this._mdContent.replace(/&gt;/g, '>');
			// Restore < that were mangled by HTML parsing (e.g. <string, becomes </string.>)
			this._mdContent = this._mdContent.replace(/<\/([a-z]+)\.\s*>/gi, '<$1,');
		}

		this.render();
	}

	_parse(): string {
		return '';
	}

	async render() {
		if (!this.isConnected || this._mdContent === undefined) {
			return;
		}

		marked.setOptions({
			gfm: true,
			breaks: true,
		});

		marked.use({ renderer: this.renderer });

		// Auto-linkify plain URLs
		marked.use({
			extensions: [{
				name: 'autolink',
				level: 'inline',
				start(src: string) { return src.match(/(https?|file):\/\//)?.index; },
				tokenizer(src: string) {
					const match = src.match(/^(https?|file):\/\/[^\s<>"']+/);
					if (match) {
						return { type: 'autolink', raw: match[0], href: match[0] };
					}
				},
				renderer(token: any) {
					return `<a href="${token.href}">${token.href}</a>`;
				}
			}]
		});

		let html = this._parse();

		if (this.untrusted) {
			let mdContent = this._mdContent;
			html = DOMPurify.sanitize(html);
			if (this._mdContent !== mdContent) {
				// While we were running this async call, the content changed
				// We don't want to overwrite with old data. Abort mission!
				return;
			}
		}

		this.innerHTML = html;

		if (Prism) {
			Prism.highlightAllUnder(this);
		}

		if ((this as any).src) {
			this.setAttribute("rendered", this._contentFromHTML ? "fallback" : "remote");
		}
		else {
			this.setAttribute("rendered", this._contentFromHTML ? "content" : "property");
		}

		// Fire event
		let event = new CustomEvent("md-render", { bubbles: true, composed: true });
		this.dispatchEvent(event);

		// Make external links open in new tab
		this.querySelectorAll('a[href^="http"]').forEach(a => {
			a.setAttribute('target', '_blank');
			a.setAttribute('rel', 'noopener');
		});

		// Convert file:// links to use server endpoint
		this.querySelectorAll('a[href^="file://"]').forEach(a => {
			const path = a.getAttribute('href')!.replace('file://', '');
			(a as HTMLElement).onclick = (e) => { 
				e.preventDefault(); 
				fetch(`/open-file?path=${encodeURIComponent(path)}`); 
			};
		});
	}
}

export class MarkdownSpan extends MarkdownElement {
	constructor() {
		super();
	}

	_parse() {
		return marked.parseInline(this._mdContent || '') as string;
	}

	static renderer = {
		codespan(this: MarkdownSpan, token: { text: string }) {
			let code = token.text;
			if (this._contentFromHTML) {
				code = code.replace(/&amp;(?=[lg]t;)/g, "&");
			}
			else {
				code = code.replace(/</g, "&lt;");
			}

			return `<code>${code}</code>`;
		}
	};
}

export class MarkdownBlock extends MarkdownElement {
	_src: URL | undefined;
	_hmin: number | undefined;
	_hlinks: string | undefined;

	constructor() {
		super();
	}

	get src(): URL | undefined {
		return this._src;
	}

	set src(value: string | URL | undefined) {
		if (value) this.setAttribute("src", String(value));
	}

	get hmin(): number {
		return this._hmin || 1;
	}

	set hmin(value: string | number) {
		this.setAttribute("hmin", String(value));
	}

	get hlinks(): string | null {
		return this._hlinks ?? null;
	}

	set hlinks(value: string | null) {
		if (value) this.setAttribute("hlinks", value);
	}

	_parse() {
		return marked.parse(this._mdContent || '') as string;
	}

	static renderer = Object.assign({
		heading(this: MarkdownBlock, token: { text: string; depth: number }) {
			const text = token.text;
			let level = Math.min(6, token.depth + (this.hmin - 1));
			const id = text.toLowerCase().replace(/[^\w]+/g, '-');
			const hlinks = this.hlinks;

			let content;

			if (hlinks === null) {
				// No heading links
				content = text;
			}
			else {
				content = `<a href="#${id}" class="anchor">`;

				if (hlinks === "") {
					// Heading content is the link
					content += text + "</a>";
				}
				else {
					// Headings are prepended with a linked symbol
					content += hlinks + "</a>" + text;
				}
			}

			return `<h${level} id="${id}">${content}</h${level}>`;
		},

		code(this: MarkdownBlock, token: { text: string; lang?: string }) {
			let code = token.text;
			const language = token.lang || '';
			if (this._contentFromHTML) {
				code = code.replace(/&amp;(?=[lg]t;)/g, "&");
			}
			else {
				code = code.replace(/</g, "&lt;");
			}

			return `<pre class="language-${language}"><code>${code}</code></pre>`;
		}
	}, MarkdownSpan.renderer);

	static get observedAttributes() {
		return ["src", "hmin", "hlinks"];
	}

	attributeChangedCallback(name: string, oldValue: string, newValue: string) {
		if (oldValue === newValue) {
			return;
		}

		switch (name) {
			case "src":
				let url;
				try {
					url = new URL(newValue, location.href);
				}
				catch (e) {
					return;
				}

				let prevSrc = this.src;
				this._src = url;

				if (this.src !== prevSrc && this.src) {
					fetch(this.src)
						.then(response => {
							if (!response.ok) {
								throw new Error(`Failed to fetch ${this.src}: ${response.status} ${response.statusText}`);
							}

							return response.text();
						})
						.then(text => {
							this.mdContent = text;
						})
						.catch(_e => { });
				}

				break;
			case "hmin":
				if (Number(newValue) > 0) {
					this._hmin = +newValue;

					this.render();
				}
				break;
			case "hlinks":
				this._hlinks = newValue;
				this.render();
		}
	}
}


customElements.define("md-block", MarkdownBlock);
customElements.define("md-span", MarkdownSpan);

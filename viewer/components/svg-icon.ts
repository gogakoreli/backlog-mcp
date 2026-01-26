/**
 * Reusable SVG icon component using mask-image for styling.
 * 
 * ## Icon System Architecture
 * 
 * **Build System:**
 * - SVG files are pure shapes (no hardcoded colors)
 * - esbuild bundles with `--loader:.svg=file` (serves as separate files)
 * - Files get content hashes for cache busting (e.g., `task-ABC123.svg`)
 * - TypeScript imports and CSS url() references auto-updated by esbuild
 * 
 * **Why This Is Resilient:**
 * 1. **Proper caching:** Each icon cached separately, change one = re-download one
 * 2. **No duplication:** Single file referenced by both TS and CSS
 * 3. **Cache busting:** Hashed filenames invalidate cache on changes
 * 4. **Consistent styling:** All icons colored via CSS (mask-image + background)
 * 5. **Maintainable:** Add/change icons without touching build config
 * 
 * **Usage:**
 * ```typescript
 * import { taskIcon } from '../icons/index.js';
 * this.innerHTML = `<svg-icon src="${taskIcon}"></svg-icon>`;
 * ```
 * 
 * **Styling:**
 * Icons inherit color from parent via `currentColor`, or can be styled with CSS:
 * ```css
 * .my-icon { background: linear-gradient(...); }
 * ```
 * 
 * @element svg-icon
 * @attr {string} src - Path to SVG file (from icon imports)
 * @attr {string} [size="1em"] - Icon size (any CSS unit)
 */
export class SvgIcon extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['src', 'size'];
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const src = this.getAttribute('src');
    const size = this.getAttribute('size') || '1em';
    
    if (!src) return;
    
    this.style.cssText = `
      display: inline-block;
      width: ${size};
      height: ${size};
      background-color: currentColor;
      mask-image: url('${src}');
      -webkit-mask-image: url('${src}');
      mask-size: contain;
      -webkit-mask-size: contain;
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-position: center;
      vertical-align: middle;
    `;
  }
}

customElements.define('svg-icon', SvgIcon);

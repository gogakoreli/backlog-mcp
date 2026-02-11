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
 * const icon = SvgIcon({ src: signal(taskIcon), size: signal('16px') });
 * ```
 * 
 * **Styling:**
 * Icons inherit color from parent via `currentColor`, or can be styled with CSS:
 * ```css
 * .my-icon { background: linear-gradient(...); }
 * ```
 * 
 * @element svg-icon
 * @prop {string} src - Path to SVG file (from icon imports)
 * @prop {string} [size="1em"] - Icon size (any CSS unit)
 */
import { effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';

export const SvgIcon = component<{ src: string; size?: string; class?: string }>('svg-icon', (props, host) => {
  // BRIDGE:ATTR — HTML-parser attributes to prop signals. Needed when <svg-icon>
  // is used as an HTML tag (e.g., in md-block output or html:inner content)
  // rather than via factory composition. Intentional, not debt.
  for (const attr of ['src', 'size', 'class'] as const) {
    const v = host.getAttribute(attr);
    if (v && !props[attr]?.value) props[attr]!.value = v;
  }
  effect(() => {
    const src = props.src.value;
    const size = props.size?.value || '1em';
    if (props.class?.value) host.className = props.class.value;
    if (!src) return;
    host.style.cssText = `display:inline-block;width:${size};height:${size};background-color:currentColor;mask-image:url('${src}');-webkit-mask-image:url('${src}');mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center;vertical-align:middle;`;
  });

  return html``;
});

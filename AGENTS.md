# AGENTS.md — Guidelines for AI Agents Working in backlog-mcp

## Testing

### Philosophy

**Unit tests only. No integration tests.**

- Unit tests mock external dependencies (filesystem, network, etc.)
- Tests should be fast, deterministic, and isolated
- If tests touch real filesystem, they're not unit tests

### How It Works

All tests use **memfs** for in-memory filesystem mocking. Zero real file I/O.

1. `vitest.config.ts` loads `src/__tests__/helpers/setup.ts` globally (server package)
2. `setup.ts` mocks `node:fs` with memfs before any test runs
3. Tests call real production code (e.g., `storage.add()`)
4. Production code calls `writeFileSync`/`readFileSync` → intercepted by memfs → stored in RAM
5. Filesystem resets between test files (not between individual tests)

### Test Locations

| Package | Test location | Count |
|---------|--------------|-------|
| Server | `packages/server/src/__tests__/*.test.ts` | 495 |
| Framework | `packages/framework/src/*.test.ts` | 215 |
| Viewer | `packages/viewer/**/*.test.ts` | 92 |

```bash
pnpm test                                # All 802 tests
pnpm --filter backlog-mcp test           # Server only
pnpm --filter @nisli/core test           # Framework only
pnpm --filter @backlog-mcp/viewer test   # Viewer only
```

### Rules

**DO:**
- Write unit tests that use the mocked fs automatically
- Create test data using production APIs (`storage.add()`, etc.)
- Use `beforeAll`/`afterAll` for setup/teardown within a test file
- Mock external modules explicitly with `vi.mock()` when needed
- Use `tmpdir()` for path strings — only fs operations are mocked

**DON'T:**
- Don't write custom fs mocks — use the global memfs setup
- Don't use `beforeEach` to reset filesystem (breaks `beforeAll` patterns)
- Don't rewrite tests to fit mocks — fix the mock instead

### Correct Patterns

```typescript
// Test using production APIs — memfs handles I/O
it('should create a task', () => {
  const task = createTask({ id: 'TASK-0001', title: 'Test' });
  storage.add(task);
  const retrieved = storage.get('TASK-0001');
  expect(retrieved?.title).toBe('Test');
});

// Mock paths module when needed
beforeEach(() => {
  vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue('/test/data');
});

// Mock specific modules for isolation
vi.mock('../storage/backlog.js', () => ({
  storage: { list: vi.fn(), get: vi.fn() },
}));
```

### Framework Tests

Framework tests use `jsdom` environment (no memfs needed). They test signals, templates, components, and DOM behavior directly:

```typescript
import { signal, computed, flush } from './signal.js';

it('should track dependencies', () => {
  const a = signal(1);
  const b = computed(() => a.value * 2);
  expect(b.value).toBe(2);
  a.set(5);
  flush();
  expect(b.value).toBe(10);
});
```

### Debugging Test Failures

- **ENOENT** — file wasn't created in virtual fs before reading. Check `storage.add()` was called.
- **Cannot read properties of undefined** — module loaded before mock. Move `vi.mock()` to top of file.
- **Tests pass individually but fail together** — shared state. Filesystem resets per file, not per test.

## Code Style

- **`index.ts` files are barrel exports only** — never put implementation in `index.ts`
- **No re-exporting between packages** — import from the source package directly
- **Minimal code** — only what's needed to solve the problem
- **Declarative with named functions** — not inline callbacks

## Monorepo Architecture

### Package Structure

Four workspace packages:

| Package | npm name | Published | Purpose |
|---------|----------|-----------|---------|
| `packages/shared` | `@backlog-mcp/shared` | No (private) | Entity types, ID utilities |
| `packages/server` | `backlog-mcp` | Yes | MCP server, CLI, HTTP API |
| `packages/framework` | `@nisli/core` | Yes | Reactive web component framework |
| `packages/viewer` | `@backlog-mcp/viewer` | No (private) | Web UI, built assets copied into server |

### Internal Package Pattern (Compiled Package)

Shared and framework export source in dev, dist at publish time:

```json
{
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  }
}
```

- Dev: TypeScript resolves imports directly from source — no build step needed
- Build: tsdown inlines shared code into server's bundle via `noExternal: ['@backlog-mcp/shared']`

### Why `devDependencies` for `@backlog-mcp/shared`

Shared is in server's `devDependencies`, not `dependencies`:

- **If `dependencies`**: `npm install backlog-mcp` tries to fetch `@backlog-mcp/shared` from registry → fails (private)
- **If `devDependencies`**: consumers never try to install it → no problem
- tsdown bundles it regardless of placement since it's imported

### Publishing

Two published packages, both via CI:

**Server** (`backlog-mcp`):
```yaml
cd packages/server
cp ../../README.md README.md    # Root README for npm
pnpm pack                       # workspace:* → real versions
npm publish backlog-mcp-*.tgz --provenance --access public
```

**Framework** (`@nisli/core`):
```yaml
cd packages/framework
pnpm pack
npm publish nisli-core-*.tgz --provenance --access public
```

`pnpm pack` resolves `workspace:*` to real version numbers. `npm publish` is used (not `pnpm publish`) for OIDC trusted publishing support.

### tsdown Bundling Config

```
skipNodeModulesBundle: true          # Externalize all node_modules
noExternal: ['@backlog-mcp/shared']  # Override: inline shared
```

Both are needed. Without `noExternal`, `skipNodeModulesBundle` would externalize shared via the pnpm workspace symlink.

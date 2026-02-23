# AGENTS.md - Testing Guidelines for backlog-mcp

## Philosophy

**Unit tests only. No integration tests.**

- Unit tests mock external dependencies (filesystem, network, etc.)
- Tests should be fast, deterministic, and isolated
- If tests touch real filesystem, they're not unit tests

## Testing Strategy

All tests use **memfs** for in-memory filesystem mocking. Zero real file I/O.

### How It Works

1. `vitest.config.ts` loads `src/__tests__/helpers/setup.ts` globally
2. `setup.ts` mocks `node:fs` with memfs before any test runs
3. Tests call real production code (e.g., `storage.add()`)
4. Production code calls `writeFileSync`/`readFileSync` → intercepted by memfs → stored in RAM
5. Filesystem resets between test files (not between individual tests)

### Why memfs?

- Battle-tested library (recommended by Vitest docs)
- Complete fs API implementation
- No flaky tests from race conditions or temp directory issues
- Tests cannot accidentally corrupt real data

### Key Files

- `src/__tests__/helpers/setup.ts` - Global setup, mocks `node:fs`
- `src/__tests__/helpers/virtual-fs.ts` - memfs wrapper, pre-populates `package.json`
- `vitest.config.ts` - References setup via `setupFiles`

## Rules

### DO

- Write unit tests that use the mocked fs automatically
- Create test data within tests using production APIs (`storage.add()`, etc.)
- Use `beforeAll`/`afterAll` for setup/teardown within a test file
- Mock external modules explicitly with `vi.mock()` when needed
- Use `tmpdir()` for path strings - it's fine, only fs operations are mocked

### DON'T

- Don't write custom fs mocks - use the global memfs setup
- Don't use `beforeEach` to reset filesystem (breaks `beforeAll` patterns)
- Don't rewrite tests to fit mocks - if tests need rewriting, the mock is wrong

## Anti-Patterns

### ❌ Custom fs mocks per test file

```typescript
// BAD - duplicates setup, incomplete, inconsistent
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  // ... missing methods will break
}));
```

### ❌ Useless tests that test nothing

```typescript
// BAD - if you're writing this, something is wrong
it('should work', () => {
  expect(true).toBe(true);
});
```

### ❌ Rewriting tests to accommodate mocks

If existing tests break when you add mocking, the mock is incomplete. Fix the mock, not the tests.

## Correct Patterns

### ✅ Test using production APIs

```typescript
// GOOD - uses real storage code, memfs handles I/O
it('should create a task', () => {
  const task = createTask({ id: 'TASK-0001', title: 'Test' });
  storage.add(task);
  
  const retrieved = storage.get('TASK-0001');
  expect(retrieved?.title).toBe('Test');
});
```

### ✅ Mock paths module when needed

```typescript
// GOOD - redirects storage to test directory
beforeEach(() => {
  vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue('/test/data');
});
```

### ✅ Mock specific modules for isolation

```typescript
// GOOD - isolates unit under test from dependencies
vi.mock('../storage/backlog.js', () => ({
  storage: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));
```

### ✅ Using tmpdir() is fine

```typescript
// OK - tmpdir() just returns a string, fs operations are mocked
const testDir = join(tmpdir(), `test-${Date.now()}`);
mkdirSync(testDir, { recursive: true }); // Goes to memfs, not disk
```

## Debugging Test Failures

### "ENOENT: no such file or directory"

- File wasn't created in virtual fs before reading
- Check that `storage.add()` or `writeFileSync()` was called first
- Verify `paths.backlogDataDir` is mocked to correct test path

### "Cannot read properties of undefined"

- Module loaded before mock was applied
- Move `vi.mock()` calls to top of file, before imports

### Tests pass individually but fail together

- Shared state between test files
- Filesystem resets per file, not per test - use `beforeAll` for setup

## Adding New Tests

1. Create test file in `src/__tests__/`
2. Import what you need - fs is already mocked globally
3. Mock `paths.backlogDataDir` if testing storage
4. Write tests using production APIs
5. Run `pnpm test` to verify

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storage } from '../storage/backlog.js';
import { paths } from '../utils/paths.js';

describe('MyFeature', () => {
  beforeEach(() => {
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue('/test/backlog');
  });

  it('should do something', () => {
    // Test code here - fs operations go to memfs automatically
  });
});
```

## Summary

- **memfs mocks all fs operations globally** - no setup needed per test
- **Tests use real production code** - only I/O is faked
- **Never rewrite tests to fit mocks** - fix the mock instead
- **Unit tests only** - fast, deterministic, isolated

## Code Style Rules

- **`index.ts` files are barrel exports only** — never put implementation code in `index.ts`. Use descriptive file names for modules (e.g., `entity-types.ts`, not `index.ts`). Index files should only re-export from sibling modules.
- **No re-exporting between packages** — import from the source, not through intermediaries. If you need `EntityType`, import from `@backlog-mcp/shared`, not from a module that re-exports it.

## Monorepo Architecture

### Package Structure

Three workspace packages, one published npm package:

- `packages/shared` — entity types, private, never published
- `packages/server` — MCP server, published as `backlog-mcp` on npm
- `packages/viewer` — web UI, private, built assets copied into server

### Internal Package Pattern (Turborepo "Compiled Package")

Shared exports source in dev, dist at publish time:

```json
// packages/shared/package.json
{
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  }
}
```

- Dev: TypeScript resolves imports directly from source — no build step needed for typecheck
- Build: tsdown inlines shared code into server's bundle via `noExternal: ['@backlog-mcp/shared']`

### Why `devDependencies` for `@backlog-mcp/shared`

Shared is in server's `devDependencies`, not `dependencies`. This is intentional:

- **If `dependencies`**: consumers run `npm install backlog-mcp` → npm tries to fetch `@backlog-mcp/shared` from registry → fails (private, doesn't exist on npm)
- **If `devDependencies`**: consumers never try to install it → no problem
- tsdown bundles devDependencies that are imported, so the code is inlined regardless of placement

### Publishing: `pnpm pack` → `npm publish`

CI uses a two-step publish to handle two constraints:

1. **`pnpm pack`** — resolves `workspace:*` to real version numbers (e.g., `0.40.0`). npm doesn't understand workspace protocol.
2. **`npm publish <tarball>`** — required for OIDC trusted publishing. pnpm doesn't reliably support npm's trusted publishing (pnpm/pnpm#9812).

```yaml
# .github/workflows/auto-tag.yml
cd packages/server
pnpm pack                    # workspace:* → 0.40.0
npm publish backlog-mcp-*.tgz --provenance --access public
```

### Why This Differs from Turborepo Examples

Turborepo's internal package docs show apps (`apps/web`) consuming internal packages. Apps get **deployed** (e.g., to Vercel) — the whole repo is cloned, `pnpm install` resolves workspace links, and the built output goes to a CDN. `workspace:*` never leaves the repo.

Our server is both an app AND a published npm package. The `package.json` goes to a public registry where strangers run `npm install`. That's why we need `devDependencies` + `pnpm pack` — to ensure no private/workspace references leak into published metadata.

### tsdown Bundling Config

```
skipNodeModulesBundle: true   — externalize all node_modules
noExternal: ['@backlog-mcp/shared']  — override: inline shared
```

Both are needed. Without `noExternal`, `skipNodeModulesBundle` would externalize shared via the pnpm workspace symlink in `node_modules`.

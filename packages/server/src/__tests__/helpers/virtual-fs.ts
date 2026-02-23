/**
 * Virtual filesystem using memfs - battle-tested in-memory fs mock
 * https://vitest.dev/guide/mocking/file-system
 */
import { fs, vol } from 'memfs';

// Pre-populate with package.json (read at module load)
const CWD = process.cwd();
vol.fromJSON({
  [`${CWD}/package.json`]: JSON.stringify({ name: 'backlog-mcp', version: '0.0.0-test' }),
});

export { fs, vol };

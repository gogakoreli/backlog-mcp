import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Check if viewer is running on the specified port
 */
export function isViewerRunning(port: number = 3030): Promise<boolean> {
  return new Promise((resolve) => {
    const client = createConnection({ port }, () => {
      client.end();
      resolve(true);
    });
    client.on('error', () => resolve(false));
  });
}

/**
 * Get version from running viewer via HTTP
 */
export async function getViewerVersion(port: number = 3030): Promise<string | null> {
  try {
    const response = await fetch(`http://localhost:${port}/version`);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Get current package version from package.json
 */
export function getCurrentVersion(): string {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version;
}

/**
 * Find PID listening on specified port using lsof (macOS/Linux)
 */
export function getPidOnPort(port: number): number | null {
  try {
    const output = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
    return parseInt(output);
  } catch {
    return null;
  }
}

/**
 * Kill viewer process on specified port
 */
export function killViewer(port: number = 3030): boolean {
  const pid = getPidOnPort(port);
  if (!pid) return false;
  
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn viewer as detached process
 */
export function spawnDetachedViewer(port: number = 3030): void {
  const viewerPath = join(__dirname, 'viewer-standalone.js');
  spawn('node', [viewerPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BACKLOG_VIEWER_PORT: port.toString() }
  }).unref();
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure viewer is running with correct version
 * - If not running, spawn it
 * - If running with old version, restart it
 * - If running with current version, do nothing
 */
export async function ensureViewer(port: number = 3030): Promise<void> {
  const running = await isViewerRunning(port);
  
  if (!running) {
    console.error(`Starting backlog viewer on port ${port}...`);
    spawnDetachedViewer(port);
    return;
  }
  
  const runningVersion = await getViewerVersion(port);
  const currentVersion = getCurrentVersion();
  
  if (!runningVersion) {
    console.error(`Backlog viewer running on port ${port} (version check failed)`);
    return;
  }
  
  if (runningVersion !== currentVersion) {
    console.error(`Restarting backlog viewer (${runningVersion} → ${currentVersion})...`);
    const killed = killViewer(port);
    if (killed) {
      await sleep(500);
      spawnDetachedViewer(port);
    } else {
      console.error(`Failed to restart viewer (could not kill process on port ${port})`);
    }
  } else {
    console.error(`Backlog viewer already running on port ${port} (v${runningVersion})`);
  }
}

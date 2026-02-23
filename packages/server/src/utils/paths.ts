import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Runtime environment modes
 */
export enum RuntimeEnvironment {
  Development = 'development',
  Production = 'production',
}

/**
 * Centralized path resolution for the entire application.
 * All file paths and directory references should go through this singleton.
 */
export class PathResolver {
  private static instance: PathResolver;
  
  /** Current runtime environment */
  public readonly environment: RuntimeEnvironment;
  
  /** Root directory of the npm package (where package.json lives) */
  public readonly projectRoot: string;
  
  /** Root directory of compiled output (dist/) */
  public readonly distRoot: string;
  
  /** Directory containing built viewer assets (dist/viewer/) */
  public readonly viewerDist: string;
  
  /** Parsed package.json metadata */
  public readonly packageJson: { name: string; version: string; [key: string]: any };
  
  private constructor() {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    
    this.environment = this.detectEnvironment();
    const paths = this.resolvePaths(currentDir, this.environment);
    
    this.projectRoot = paths.projectRoot;
    this.distRoot = paths.distRoot;
    this.viewerDist = paths.viewerDist;
    
    // Load package.json once
    const pkgPath = join(this.projectRoot, 'package.json');
    this.packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  }
  
  public static getInstance(): PathResolver {
    if (!PathResolver.instance) {
      PathResolver.instance = new PathResolver();
    }
    return PathResolver.instance;
  }
  
  /**
   * Get the application version from package.json
   */
  public getVersion(): string {
    return this.packageJson.version;
  }
  
  /**
   * Get backlog data directory path.
   * 
   * Reads from BACKLOG_DATA_DIR environment variable, defaults to './data'.
   * Relative paths are resolved against project root.
   * Absolute paths (starting with / or ~) are returned as-is.
   * 
   * @example
   * // BACKLOG_DATA_DIR not set → '/path/to/project/data'
   * // BACKLOG_DATA_DIR='./my-data' → '/path/to/project/my-data'
   * // BACKLOG_DATA_DIR='/absolute/path' → '/absolute/path'
   * // BACKLOG_DATA_DIR='~/Documents/data' → '~/Documents/data'
   */
  public get backlogDataDir(): string {
    const dataDir = process.env.BACKLOG_DATA_DIR ?? 'data';
    const isAbsolutePath = dataDir.startsWith('/') || dataDir.startsWith('~');
    
    return isAbsolutePath ? dataDir : join(this.projectRoot, dataDir);
  }
  
  /**
   * Resolve a path relative to project root
   * @example paths.fromRoot('data', 'tasks') → '/path/to/package/data/tasks'
   */
  public fromRoot(...paths: string[]): string {
    return join(this.projectRoot, ...paths);
  }
  
  /**
   * Resolve a path relative to dist/
   * @example paths.fromDist('server', 'index.mjs') → '/path/to/package/dist/server/index.mjs'
   */
  public fromDist(...paths: string[]): string {
    return join(this.distRoot, ...paths);
  }
  
  /**
   * Resolve path to a package binary using Node.js module resolution.
   * 
   * Uses require.resolve to find the package wherever npm places it (local node_modules,
   * hoisted to parent, or pnpm virtual store). Reads the bin field from package.json
   * instead of assuming .bin/ symlink location.
   * 
   * @param binName - Package name (e.g., 'mcp-remote')
   * @returns Absolute path to the binary file
   * @throws Error if package not found or has no bin field
   * @example paths.getBinPath('mcp-remote') // → '/path/to/node_modules/mcp-remote/dist/proxy.js'
   */
  public getBinPath(binName: string): string {
    // Create require function from current module context
    const require = createRequire(import.meta.url);
    
    // Let Node.js find the package (handles hoisting automatically)
    const packageJsonPath = require.resolve(`${binName}/package.json`);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    
    // Read bin field from package.json (source of truth)
    if (!packageJson.bin) {
      throw new Error(`Package '${binName}' has no bin field in package.json`);
    }
    
    const binRelativePath = typeof packageJson.bin === 'string' 
      ? packageJson.bin 
      : packageJson.bin[binName];
    
    if (!binRelativePath) {
      const availableBins = Object.keys(packageJson.bin).join(', ');
      throw new Error(`Package '${binName}' has no bin entry for '${binName}'. Available: ${availableBins}`);
    }
    
    // Resolve absolute path to binary
    const packageDir = dirname(packageJsonPath);
    return join(packageDir, binRelativePath);
  }
  
  /**
   * Detect runtime environment based on NODE_ENV
   * Defaults to production if not set
   */
  private detectEnvironment(): RuntimeEnvironment {
    const env = process.env.NODE_ENV;
    return env === 'development' ? RuntimeEnvironment.Development : RuntimeEnvironment.Production;
  }
  
  /**
   * Resolve all paths based on current directory and environment
   * @param currentDir - Directory where this file is located
   * @param environment - Current runtime environment
   * @returns Object containing all resolved paths
   */
  /**
   * Resolve all directory paths based on current location and environment
   * @param currentDir - Directory containing this file (src/utils or dist/utils)
   * @param environment - Current runtime environment
   * @returns Resolved paths for project root, dist, and viewer
   */
  private resolvePaths(currentDir: string, environment: RuntimeEnvironment): {
    projectRoot: string;
    distRoot: string;
    viewerDist: string;
  } {
    switch (environment) {
      case RuntimeEnvironment.Development: {
        // Dev mode: this file is at packages/server/src/utils/paths.ts
        const srcIndex = currentDir.indexOf('/src/');
        const projectRoot = currentDir.substring(0, srcIndex);
        const distRoot = join(projectRoot, 'dist');
        // Monorepo: viewer is a sibling package
        const viewerDist = join(projectRoot, '../viewer/dist');
        return { projectRoot, distRoot, viewerDist };
      }
      
      case RuntimeEnvironment.Production: {
        // Production: this file is at dist/utils/paths.mjs
        // Go up two levels to reach project root
        const distRoot = dirname(currentDir);
        const projectRoot = dirname(distRoot);
        const viewerDist = join(distRoot, 'viewer');
        return { projectRoot, distRoot, viewerDist };
      }
    }
  }
}

// Export singleton instance
export const paths = PathResolver.getInstance();

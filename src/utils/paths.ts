import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

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
class PathResolver {
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
   * Resolve data directory to absolute path
   * @param dataDir - Relative or absolute data directory path
   * @returns Absolute path to data directory
   */
  public resolveDataDir(dataDir: string): string {
    if (dataDir.startsWith('/')) {
      return dataDir;
    }
    return this.fromRoot(dataDir);
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
   * Get path to a binary in node_modules/.bin
   * @example paths.getBinPath('mcp-remote') → '/path/to/package/node_modules/.bin/mcp-remote'
   */
  public getBinPath(binName: string): string {
    return join(this.projectRoot, 'node_modules', '.bin', binName);
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
        // Dev mode: this file is at src/utils/paths.ts
        // Extract project root from the path
        const srcIndex = currentDir.indexOf('/src/');
        const projectRoot = currentDir.substring(0, srcIndex);
        const distRoot = join(projectRoot, 'dist');
        const viewerDist = join(distRoot, 'viewer');
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

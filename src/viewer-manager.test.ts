import { describe, it, expect, vi } from 'vitest';
import { getCurrentVersion, getViewerVersion } from './viewer-manager.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('viewer-manager', () => {
  describe('getCurrentVersion', () => {
    it('should return version from package.json', () => {
      const version = getCurrentVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version).toBe('0.18.0');
    });
  });

  describe('getViewerVersion', () => {
    it('should return version from HTTP endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: async () => '1.2.3'
      });

      const version = await getViewerVersion(3030);
      expect(version).toBe('1.2.3');
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3030/version');
    });

    it('should return null on fetch error', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const version = await getViewerVersion(3030);
      expect(version).toBeNull();
    });

    it('should return null on non-ok response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false
      });

      const version = await getViewerVersion(3030);
      expect(version).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  paths: { userData: 'C:/Users/x/AppData/Roaming/sc-data-uploader' } as Record<string, string>,
  getPath(name: string): string {
    return this.paths[name];
  },
  setPath: vi.fn(function (this: { paths: Record<string, string> }, name: string, value: string) {
    this.paths[name] = value;
  }),
}));

vi.mock('electron', () => ({ app: electronApp }));

describe('devUserDataPath', () => {
  it('suffixes the path of an unpackaged run', async () => {
    const { devUserDataPath } = await import('../src/main/dev-user-data.js');
    expect(devUserDataPath('C:/AppData/Roaming/uploader', false)).toBe('C:/AppData/Roaming/uploader-dev');
  });

  it('keeps the path of a packaged build', async () => {
    const { devUserDataPath } = await import('../src/main/dev-user-data.js');
    expect(devUserDataPath('C:/AppData/Roaming/uploader', true)).toBeNull();
  });

  it('never suffixes twice and ignores an empty path', async () => {
    const { devUserDataPath } = await import('../src/main/dev-user-data.js');
    expect(devUserDataPath('C:/AppData/Roaming/uploader-dev', false)).toBeNull();
    expect(devUserDataPath('', false)).toBeNull();
  });
});

describe('module evaluation', () => {
  beforeEach(() => {
    vi.resetModules();
    electronApp.setPath.mockClear();
    electronApp.paths.userData = 'C:/Users/x/AppData/Roaming/sc-data-uploader';
  });

  it('redirects userData on import when unpackaged', async () => {
    electronApp.isPackaged = false;
    await import('../src/main/dev-user-data.js');
    expect(electronApp.setPath).toHaveBeenCalledOnce();
    expect(electronApp.getPath('userData')).toBe('C:/Users/x/AppData/Roaming/sc-data-uploader-dev');
  });

  it('leaves a packaged build untouched', async () => {
    electronApp.isPackaged = true;
    await import('../src/main/dev-user-data.js');
    expect(electronApp.setPath).not.toHaveBeenCalled();
    expect(electronApp.getPath('userData')).toBe('C:/Users/x/AppData/Roaming/sc-data-uploader');
  });
});

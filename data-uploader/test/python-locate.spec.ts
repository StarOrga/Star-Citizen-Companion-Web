import { describe, it, expect } from 'vitest';
import {
  packagedPythonMissing,
  pythonSpawnEnoentMessage,
  PACKAGED_PYTHON_MISSING,
} from '../src/lib/python-locate';

describe('packagedPythonMissing', () => {
  it('flags a packaged build that fell back to the bare-python dev path', () => {
    expect(packagedPythonMissing('dev-path', true)).toBe(PACKAGED_PYTHON_MISSING);
  });

  it('does NOT flag a dev build on the dev path (python may be on PATH)', () => {
    expect(packagedPythonMissing('dev-path', false)).toBeNull();
  });

  it('does NOT flag when the embedded/env interpreter resolved', () => {
    expect(packagedPythonMissing('packaged', true)).toBeNull();
    expect(packagedPythonMissing('env', true)).toBeNull();
  });
});

describe('pythonSpawnEnoentMessage', () => {
  it('packaged ENOENT reads as a corrupt/incomplete install', () => {
    expect(pythonSpawnEnoentMessage('python', true)).toBe(PACKAGED_PYTHON_MISSING);
  });

  it('dev ENOENT names the interpreter and the dev-build fix', () => {
    const msg = pythonSpawnEnoentMessage('python', false);
    expect(msg).toContain("'python'");
    expect(msg).toContain('SC_EXTRACT_PYTHON');
    expect(msg).not.toBe(PACKAGED_PYTHON_MISSING);
  });
});

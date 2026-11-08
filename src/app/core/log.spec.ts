import { logError, logWarn } from './log';

describe('log', () => {
  it('logWarn prefixes the scope and passes the context', () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    const ctx = { id: 1 };
    logWarn('codex', 'list failed', ctx);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[codex] list failed', ctx);
  });

  it('logWarn omits the context argument when none is given', () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    logWarn('news', 'feed stale');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[news] feed stale');
    expect(vi.mocked(warn).mock.lastCall!.length).toBe(1);
  });

  it('logError writes at error level, not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    const error = vi.spyOn(console, 'error').mockReturnValue(undefined as never);
    const err = new Error('boom');
    logError('app', 'bootstrap failed', err);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[app] bootstrap failed', err);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logError without context passes a single argument', () => {
    const error = vi.spyOn(console, 'error').mockReturnValue(undefined as never);
    logError('app', 'x');
    expect(vi.mocked(error).mock.lastCall!).toEqual(['[app] x']);
  });
});

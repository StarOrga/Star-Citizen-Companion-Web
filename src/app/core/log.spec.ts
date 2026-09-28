import { logError, logWarn } from './log';

describe('log', () => {
  it('logWarn prefixes the scope and passes the context', () => {
    const warn = spyOn(console, 'warn');
    const ctx = { id: 1 };
    logWarn('codex', 'list failed', ctx);
    expect(warn).toHaveBeenCalledOnceWith('[codex] list failed', ctx);
  });

  it('logWarn omits the context argument when none is given', () => {
    const warn = spyOn(console, 'warn');
    logWarn('news', 'feed stale');
    expect(warn).toHaveBeenCalledOnceWith('[news] feed stale');
    expect(warn.calls.mostRecent().args.length).toBe(1);
  });

  it('logError writes at error level, not warn', () => {
    const warn = spyOn(console, 'warn');
    const error = spyOn(console, 'error');
    const err = new Error('boom');
    logError('app', 'bootstrap failed', err);
    expect(error).toHaveBeenCalledOnceWith('[app] bootstrap failed', err);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logError without context passes a single argument', () => {
    const error = spyOn(console, 'error');
    logError('app', 'x');
    expect(error.calls.mostRecent().args).toEqual(['[app] x']);
  });
});

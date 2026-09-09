import { renderHook, act } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

/** A controllable stand-in for a real WakeLockSentinel. */
function makeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
  };
  return sentinel;
}

type Sentinel = ReturnType<typeof makeSentinel>;

/** Installs a fake `navigator.wakeLock`. happy-dom ships none. */
function installWakeLock(request: (type?: string) => Promise<unknown>) {
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
}

function installGrantingWakeLock() {
  const sentinels: Sentinel[] = [];
  const request = vi.fn(async () => {
    const s = makeSentinel();
    sentinels.push(s);
    return s;
  });
  installWakeLock(request);
  return { request, sentinels };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

const fireVisibilityChange = () => document.dispatchEvent(new Event('visibilitychange'));

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('useWakeLock', () => {
  it('does nothing when the browser has no Wake Lock API', () => {
    expect('wakeLock' in navigator).toBe(false);
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });

  it('requests a screen lock while active', async () => {
    const { request } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('does not request while inactive', async () => {
    const { request } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(false));
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('defers the request until a hidden document becomes visible', async () => {
    const { request } = installGrantingWakeLock();
    setVisibility('hidden');
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).not.toHaveBeenCalled();

    // Reachable: OS lock-screen / Bluetooth transport controls flip
    // `isPlaying` while the tab is hidden, so the effect can mount hidden.
    // The listener must be registered even when the first acquire bails.
    setVisibility('visible');
    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('releases the lock when it stops being active', async () => {
    const { sentinels } = installGrantingWakeLock();
    const { rerender } = renderHook(({ a }: { a: boolean }) => useWakeLock(a), {
      initialProps: { a: true },
    });
    await act(async () => {});
    expect(sentinels).toHaveLength(1);

    await act(async () => {
      rerender({ a: false });
    });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('releases the lock on unmount', async () => {
    const { sentinels } = installGrantingWakeLock();
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(sentinels).toHaveLength(1);

    await act(async () => {
      unmount();
    });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('re-acquires when the document becomes visible again', async () => {
    const { request, sentinels } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledTimes(1);

    // The browser auto-releases the lock when the document is hidden.
    sentinels[0].released = true;
    setVisibility('hidden');
    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not stack a second lock while one is still held', async () => {
    const { request } = installGrantingWakeLock();
    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('recovers from a refused request', async () => {
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('NotAllowedError');
      return makeSentinel();
    });
    installWakeLock(request);

    await act(async () => {
      renderHook(() => useWakeLock(true));
    });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireVisibilityChange();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases a sentinel that arrives after the effect was torn down', async () => {
    let resolveRequest: (s: Sentinel) => void = () => {};
    const pending = new Promise<Sentinel>((resolve) => {
      resolveRequest = resolve;
    });
    installWakeLock(vi.fn(() => pending));

    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();

    const late = makeSentinel();
    await act(async () => {
      resolveRequest(late);
      await pending;
      await Promise.resolve();
    });

    expect(late.release).toHaveBeenCalled();
  });
});

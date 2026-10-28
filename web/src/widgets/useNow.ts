import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `everyMs` so "in 20 minutes", the now-line and "due today" don't go stale on a
 * dashboard left open all day. Ticks land on the interval's boundary (a 60s tick flips with the wall clock's minute),
 * and the time is re-read when the tab becomes visible again, since timers in background tabs are throttled.
 */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const tick = () => setNow(new Date());
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, everyMs);
    }, everyMs - (Date.now() % everyMs));
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [everyMs]);
  return now;
}

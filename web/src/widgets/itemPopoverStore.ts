/**
 * Which item popover is open, dashboard-wide. One at a time: the calendar views, the to-do list, the course pane and
 * every other place that wraps a row in `ItemPopover` share this, so opening one closes whichever was open. The key is
 * the mounted popover's instance id (not the item id: the same item can be on the calendar and in the to-do list, and
 * only the one that was clicked should open). Module-level state read through `useSyncExternalStore`; nothing else
 * in the app needs to know.
 */
let openKey: string | null = null;
const listeners = new Set<() => void>();

export function readOpenItemPopover(): string | null {
  return openKey;
}

export function subscribeOpenItemPopover(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Opens `key` (closing whatever was open) or, with null, closes everything. */
export function setOpenItemPopover(key: string | null): void {
  if (openKey === key) return;
  openKey = key;
  for (const cb of [...listeners]) cb();
}

/** Closes `key` if it is the open one; a stale close (the popover already lost to another) changes nothing. */
export function closeItemPopover(key: string): void {
  if (openKey === key) setOpenItemPopover(null);
}

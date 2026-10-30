import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeItemPopover, readOpenItemPopover, setOpenItemPopover, subscribeOpenItemPopover } from './itemPopoverStore';

afterEach(() => setOpenItemPopover(null));

describe('itemPopoverStore', () => {
  it('holds one open key: opening another replaces it', () => {
    setOpenItemPopover('a');
    expect(readOpenItemPopover()).toBe('a');
    setOpenItemPopover('b');
    expect(readOpenItemPopover()).toBe('b');
  });

  it('notifies subscribers on every change and not on a no-op', () => {
    const cb = vi.fn();
    const off = subscribeOpenItemPopover(cb);
    setOpenItemPopover('a');
    setOpenItemPopover('a');
    setOpenItemPopover(null);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setOpenItemPopover('b');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('a close from a popover that already lost to another leaves the new one open', () => {
    setOpenItemPopover('a');
    setOpenItemPopover('b');
    closeItemPopover('a');
    expect(readOpenItemPopover()).toBe('b');
    closeItemPopover('b');
    expect(readOpenItemPopover()).toBeNull();
  });
});

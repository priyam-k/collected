import { useEffect, useRef, useState, type RefObject } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Selects an element's text so a blocked clipboard still leaves one keystroke to copy it. */
function selectText(el: HTMLElement | null): boolean {
  const sel = window.getSelection();
  if (!el || !sel) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/**
 * A Copy button for a block of text: the clipboard first, and if that is blocked, the text in `fallback` selected
 * (and copied the old way where that still works). Says "Copied" for two seconds.
 */
export function CopyButton({ text, fallback, label }: { text: string; fallback: RefObject<HTMLElement | null>; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const key = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C';
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      done = selectText(fallback.current);
    }
    setState(done ? 'copied' : 'selected');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <Button type="button" size="sm" variant="secondary" onClick={copy} aria-label={label}>
      {state === 'copied' ? <Check className="text-positive" /> : <Copy />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'selected' ? `Selected, press ${key}` : 'Copy'}</span>
    </Button>
  );
}

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Required fields of a settings form, marked on a submit that comes too early. `checks` maps each field to why it is
 * not ready (null once it is). The submit button stays clickable: `attempt()` returns true when every check passes
 * and otherwise marks the failing fields and focuses the first. A mark clears as soon as its field passes.
 *
 *   const marks = useFormMarks({ email: email.trim() ? null : 'Enter your email' });
 *   <Field label="Email" {...marks.field('email')}><Input {...marks.input('email')} /></Field>
 *   <Button variant={marks.complete ? 'default' : 'secondary'}>…</Button>
 */
export function useFormMarks<K extends string>(checks: Record<K, string | null>) {
  const [marked, setMarked] = useState<ReadonlySet<K>>(() => new Set());
  const els = useRef(new Map<K, HTMLElement>());
  const id = useId();
  const keys = Object.keys(checks) as K[];
  const failing = keys.filter((k) => checks[k]);

  // Fixed fields drop their mark; it does not come back until the next early submit.
  const failingKey = failing.join('\0');
  useEffect(() => {
    setMarked((m) => {
      const next = new Set([...m].filter((k) => failing.includes(k)));
      return next.size === m.size ? m : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failingKey]);

  const reset = useCallback(() => setMarked((m) => (m.size ? new Set() : m)), []);
  const isMarked = (k: K) => marked.has(k) && !!checks[k];
  const errorId = (k: K) => `${id}-${k}-error`;
  return {
    complete: failing.length === 0,
    /** True when the form can be submitted; otherwise marks what is missing and focuses the first such field. */
    attempt(): boolean {
      if (!failing.length) return true;
      setMarked(new Set(failing));
      els.current.get(failing[0]!)?.focus();
      return false;
    },
    /** Drops every mark (stable, safe in an effect). */
    reset,
    /** Props for the `Field` around the input: the reason replaces the hint while marked. */
    field: (k: K) => ({ error: isMarked(k) ? checks[k] : null, errorId: errorId(k) }),
    /** Props for the input itself. */
    input: (k: K) => ({
      ref: (el: HTMLElement | null) => {
        if (el) els.current.set(k, el);
        else els.current.delete(k);
      },
      'aria-invalid': isMarked(k) ? (true as const) : undefined,
      'aria-describedby': isMarked(k) ? errorId(k) : undefined,
      className: isMarked(k) ? 'invalid' : undefined,
    }),
    isMarked,
  };
}

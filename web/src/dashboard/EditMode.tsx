import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface EditModeCtx {
  editMode: boolean;
  setEditMode(v: boolean): void;
  toggle(): void;
}

const Ctx = createContext<EditModeCtx | null>(null);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const toggle = useCallback(() => setEditMode((v) => !v), []);

  // `e` toggles edit mode; Escape leaves it. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'e') {
        ev.preventDefault();
        toggle();
      } else if (ev.key === 'Escape') setEditMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const value = useMemo(() => ({ editMode, setEditMode, toggle }), [editMode, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditMode(): EditModeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEditMode outside EditModeProvider');
  return v;
}

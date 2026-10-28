import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  /** The control that opens the dialog. Rendered as is; the dialog opens on its click. */
  trigger?: (open: () => void) => ReactNode;
  /** Controlled use: pass `open` and `onOpenChange` instead of `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for removals and overwrites. */
  destructive?: boolean;
  /**
   * Runs on confirm. A promise keeps the dialog open with the button pending until it settles;
   * it closes on success and stays open on failure (the caller shows the error), so a retry is one click.
   */
  onConfirm: () => unknown | Promise<unknown>;
};

/**
 * A yes/no question before something that cannot be taken back. Enter answers with the focused
 * button: confirm for a plain question, Cancel for a destructive one, so a reflexive Enter never
 * deletes or discards. Escape and clicking outside cancel, except while the action is in flight,
 * when the dialog cannot be dismissed and the buttons are disabled.
 */
export function ConfirmDialog({ trigger, open: openProp, onOpenChange, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, onConfirm }: Props) {
  const [openState, setOpenState] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    if (pending && !v) return;
    if (openProp === undefined) setOpenState(v);
    onOpenChange?.(v);
  };
  const confirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      setPending(false);
      if (openProp === undefined) setOpenState(false);
      onOpenChange?.(false);
    } catch {
      // The caller reports the failure; keep the dialog so it can be retried or cancelled.
      setPending(false);
    }
  };
  return (
    <>
      {trigger?.(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (destructive ? cancelRef : confirmRef).current?.focus();
          }}
          onEscapeKeyDown={(e) => pending && e.preventDefault()} onInteractOutside={(e) => pending && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription className="text-[13.5px] leading-relaxed text-sub">{description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRef} variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button ref={confirmRef} variant={destructive ? 'destructive' : 'default'} onClick={() => void confirm()} disabled={pending} aria-busy={pending}>
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

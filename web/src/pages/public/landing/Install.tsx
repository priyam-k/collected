import { useId, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLiquid } from '@/lib/liquid';
import { cn } from '@/lib/utils';
import { CopyButton } from './CopyButton';

/** The short paste-into-your-agent prompt. README.md carries the same text under "Set up with your AI agent"; keep them equal. */
export const AGENT_PROMPT =
  'Install collected (`brew install priyam-k/collected/collected-cli`, or `npm i -g collected-cli` if you have Node 22+), ' +
  'then run `collected quickstart --agent` and follow what it prints. ' +
  'Ask me before anything that opens my browser or creates accounts; never ask me to paste secrets into this chat.';

type Method = 'brew' | 'npm';
const METHODS: Method[] = ['brew', 'npm'];
const INSTALL: Record<Method, string> = {
  brew: 'brew install priyam-k/collected/collected-cli',
  npm: 'npm i -g collected-cli',
};
const KEY = 'collected.install';

/* The chosen install method, shared by every block on the page and remembered across visits where storage allows. */
let method: Method = (() => {
  try {
    return localStorage.getItem(KEY) === 'npm' ? 'npm' : 'brew';
  } catch {
    return 'brew';
  }
})();
const listeners = new Set<() => void>();
function setMethod(m: Method) {
  method = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // private window or blocked storage: the choice lasts for this page only
  }
  listeners.forEach((l) => l());
}
function useMethod(): Method {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => method,
  );
}

/** The install commands for the chosen method: the package, then the setup wizard. */
export function installLines(m: Method): string[] {
  return [INSTALL[m], 'collected quickstart'];
}

/** brew | npm, as a segmented control. */
function MethodTabs() {
  const current = useMethod();
  const liquid = useLiquid<HTMLDivElement>();
  return (
    <div className="seg" role="group" aria-label="Install with" ref={liquid}>
      {METHODS.map((m) => (
        <button key={m} type="button" className={cn('min-w-[3.75rem] font-mono', current === m && 'seg-on')} aria-pressed={current === m} onClick={() => setMethod(m)}>
          {m}
        </button>
      ))}
    </div>
  );
}

/** Shell commands in a well, one per line behind a muted prompt. Long lines scroll inside the well, never the page. */
function Shell({ lines, codeRef, className }: { lines: string[]; codeRef: Ref<HTMLElement>; className?: string }) {
  return (
    <pre className={cn('overflow-x-auto rounded-[14px] bg-well px-4 py-3 font-mono text-[12px] leading-7 text-ink sm:text-[13px]', className)}>
      <code ref={codeRef}>
        {lines.map((line, i) => (
          <span key={line}>
            <span className="select-none text-ter">$ </span>
            {line}
            {i < lines.length - 1 ? '\n' : null}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** The method tabs, a Copy button, and the two commands. Used in the hero and on the laptop card. */
export function InstallCommands({ className, shellClassName }: { className?: string; shellClassName?: string }) {
  const lines = installLines(useMethod());
  const code = useRef<HTMLElement>(null);
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <MethodTabs />
        <CopyButton text={lines.join('\n')} fallback={code} label="Copy the install commands" />
      </div>
      <Shell lines={lines} codeRef={code} className={shellClassName} />
    </div>
  );
}

/** The hero's get-started block: install and run the wizard, and under a toggle, the two-line prompt for an agent. */
export function GetStarted() {
  const [open, setOpen] = useState(false);
  const prompt = useRef<HTMLElement>(null);
  const panel = useId();
  return (
    <div className="surface mx-auto mt-9 w-full max-w-xl p-3 text-left sm:p-4">
      <InstallCommands />
      <p className="px-1 pt-2.5 text-[12.5px] leading-relaxed text-ter">
        Runs on your laptop. No server, no Google Cloud project; data stays in <span className="font-mono text-[12px] text-sub">~/.collected</span>.
      </p>
      <div className="mt-3 border-t border-line pt-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panel : undefined}
          onClick={() => setOpen((o) => !o)}
          className="-mx-1 flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium text-sub transition-colors hover:text-ink"
        >
          Setting up with an AI agent?
          <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
        </button>
        {open && (
          <div id={panel} className="pt-2">
            <div className="flex items-center justify-between gap-3 pb-2.5 pl-1">
              <p className="label">Paste into your agent</p>
              <CopyButton text={AGENT_PROMPT} fallback={prompt} label="Copy the agent prompt" />
            </div>
            <pre className="overflow-auto rounded-[14px] bg-well px-4 py-3 font-mono text-[12px] leading-[1.65] text-ink whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-[12.5px]">
              <code ref={prompt}>{AGENT_PROMPT}</code>
            </pre>
            <p className="px-1 pt-2.5 text-[12.5px] text-ter">Works with Claude Code, Cursor, Codex and anything that can run a shell</p>
          </div>
        )}
      </div>
    </div>
  );
}

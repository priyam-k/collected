import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The paste-into-your-agent setup prompt. README.md carries the same text under "Set up with your AI agent"; keep them equal. */
export const AGENT_PROMPT =
  'Set up collected for me. It is an open-source student dashboard and CLI that pulls Canvas, Gradescope, Google Calendar, Todoist and Google Tasks into one board, and it is readable by agents like you. ' +
  'Start by reading https://raw.githubusercontent.com/priyam-k/collected/main/skills/collected/SKILL.md and https://raw.githubusercontent.com/priyam-k/collected/main/agent/README.md. ' +
  'Then ask me one question: run it on this computer (nothing to host, data stays in ~/.collected) or self-host it on my own server (Docker, a domain, a Google Cloud project)? ' +
  'Laptop path: check Node 22 or newer, run `npm i -g collected-cli` and `collected init --local`, then connect Canvas with a personal access token (Canvas → Account → Settings → + New Access Token; run `collected connect canvas --token`, which prompts for it; if your school disabled tokens, `collected connect canvas` reads the browser cookie instead), ' +
  'ask before `collected connect google calendar` and `collected connect google tasks` since they open my browser, tell me how to paste a Todoist token in Settings → Sources, run `collected daemon install`, then `collected ui` and show me `collected agenda`. ' +
  'Self-host path: walk me through https://raw.githubusercontent.com/priyam-k/collected/main/docs/self-host.md step by step and ask before anything that creates accounts or costs money. ' +
  'Never ask me to paste secrets into this chat; the CLI prompts for them itself.';

/** Selects the prompt's text so a blocked clipboard still leaves one keystroke to copy it. */
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

/** A compact card under the hero: the setup prompt in a well, with a Copy button that confirms for two seconds. */
export function AgentPrompt() {
  const text = useRef<HTMLElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const key = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C';
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
      done = true;
    } catch {
      done = selectText(text.current);
    }
    setState(done ? 'copied' : 'selected');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="surface mx-auto mt-10 w-full max-w-2xl p-3 text-left sm:p-4">
      <div className="flex items-center justify-between gap-3 pb-2.5 pl-1.5">
        <p className="label">Set up with your agent</p>
        <Button type="button" size="sm" variant="secondary" onClick={copy} aria-label="Copy the setup prompt">
          {state === 'copied' ? <Check className="text-positive" /> : <Copy />}
          <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'selected' ? `Selected, press ${key}` : 'Copy'}</span>
        </Button>
      </div>
      <pre className="max-h-[164px] overflow-auto rounded-[14px] bg-well px-4 py-3 font-mono text-[12px] leading-[1.65] text-ink whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-[12.5px]">
        <code ref={text}>{AGENT_PROMPT}</code>
      </pre>
      <p className="px-1.5 pt-2.5 text-[12.5px] text-ter">Works with Claude Code, Cursor, Codex and anything that can run a shell</p>
    </div>
  );
}

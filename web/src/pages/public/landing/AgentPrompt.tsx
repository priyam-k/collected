import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The paste-into-your-agent setup prompt. README.md carries the same text under "Set up with your AI agent"; keep them equal. */
export const AGENT_PROMPT =
  'Set up collected for me. ' +
  'It is an open-source student dashboard and CLI that pulls Canvas, Gradescope, Google Calendar, Todoist and Google Tasks into one board, readable by agents like you. ' +
  'First read https://raw.githubusercontent.com/priyam-k/collected/main/skills/collected/SKILL.md and https://raw.githubusercontent.com/priyam-k/collected/main/agent/README.md, and save the skill file where you keep skills (Claude Code: ~/.claude/skills/collected/SKILL.md) so you can use collected in later sessions; if you cannot write there, ask me to. ' +
  'Ask me one question: run it on this computer (nothing to host, data stays in ~/.collected) or self-host it on my own server (Docker, a domain, a Google Cloud project)? ' +
  'Before each step, say in one line what it does and why, and let me skip it. ' +
  'Laptop path: check Node 22 or newer, run `npm i -g collected-cli` and `collected init --local`. ' +
  'Canvas: run `collected connect canvas`; it reads my Canvas session cookie from the browser I am signed in with (Chrome, Brave, Edge, Arc, Firefox or Zen; on macOS one Keychain prompt appears, click Allow). ' +
  'If that fails or I would rather do it myself: in Canvas, DevTools → Application → Cookies → my Canvas domain, copy the value of canvas_session (older schools: _normandy_session) and paste it in Settings → Sources → Canvas, which has a field for just the value; on Windows use Firefox or that paste. ' +
  'If my school allows personal access tokens, `collected connect canvas --token` is the simpler route. ' +
  'Google: ask whether I want Calendar and Tasks connected now; `collected connect google calendar` and `collected connect google tasks` open my browser for consent, and I can do them later from Settings → Sources. ' +
  'Todoist: tell me where to paste a token (Settings → Sources). ' +
  'Then `collected daemon install` so it stays current, `collected ui` for the dashboard, and show me `collected agenda`. ' +
  'Self-host path: walk me through https://raw.githubusercontent.com/priyam-k/collected/main/docs/self-host.md step by step, asking before anything that creates accounts or costs money. ' +
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
      <pre className="max-h-[220px] overflow-auto rounded-[14px] bg-well px-4 py-3 font-mono text-[12px] leading-[1.65] text-ink whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-[12.5px]">
        <code ref={text}>{AGENT_PROMPT}</code>
      </pre>
      <p className="px-1.5 pt-2.5 text-[12.5px] text-ter">Works with Claude Code, Cursor, Codex and anything that can run a shell</p>
    </div>
  );
}

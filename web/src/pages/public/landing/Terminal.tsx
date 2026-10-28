import { useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { reducedMotion, useInView } from './motion';

/**
 * A terminal that types real `collected` commands and prints what they print (shaped like agent/src/collected.ts
 * output, on the demo semester). It loops while on screen; under reduced motion it shows the whole session at once.
 */

interface Scene {
  cmd: string;
  out: string[];
}

function scenes(): Scene[] {
  const today = new Date();
  const tmrw = addDays(today, 1);
  const fri = format(addDays(today, 2), 'EEE');
  return [
    {
      cmd: 'collected agenda --days 2',
      out: [
        `${format(today, 'EEE MMM d')}`,
        '  10:00  CS351 Lecture · Sci 120',
        '  17:00  Study group: CS351',
        '  23:59  [due] PHYS260 Lab report 5: RC circuits',
        `${format(tmrw, 'EEE MMM d')}`,
        '  09:30  MATH340 Lecture · Math 0401',
        '  23:59  [due] CS351 Problem set 6: dynamic programming',
      ],
    },
    {
      cmd: `collected task add "email TA about regrade ${fri.toLowerCase()} 5pm #School"`,
      out: [`added to Todoist: email TA about regrade · due ${fri} 5:00 PM`],
    },
    {
      cmd: 'collected grades',
      out: ['Course    Current  Graded', 'CS351     92.0%    1 of 3', 'MATH340   95.0%    1 of 3', 'STAT400   95.0%    1 of 3'],
    },
  ];
}

type Line = { kind: 'cmd' | 'out'; text: string };

/** Fixed height, newest lines at the bottom, older ones scrolling off the top. `reserve` keeps room at the bottom for something laid over it. */
export function Terminal({ className, reserve }: { className?: string; reserve?: boolean }) {
  const script = useMemo(scenes, []);
  const [ref, seen] = useInView<HTMLDivElement>();
  const [lines, setLines] = useState<Line[]>([]);
  const [typing, setTyping] = useState('');

  useEffect(() => {
    if (!seen) return;
    if (reducedMotion()) {
      setLines(script.flatMap((s) => [{ kind: 'cmd' as const, text: s.cmd }, ...s.out.map((t) => ({ kind: 'out' as const, text: t }))]));
      return;
    }
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!cancelled) {
        setLines([]);
        for (const s of script) {
          for (let i = 1; i <= s.cmd.length && !cancelled; i++) {
            setTyping(s.cmd.slice(0, i));
            await sleep(i === 1 ? 380 : 24 + Math.random() * 30);
          }
          await sleep(260);
          if (cancelled) return;
          setTyping('');
          setLines((l) => [...l, { kind: 'cmd', text: s.cmd }]);
          for (const t of s.out) {
            await sleep(70);
            if (cancelled) return;
            setLines((l) => [...l, { kind: 'out', text: t }]);
          }
          await sleep(1500);
        }
        await sleep(2600);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seen, script]);

  return (
    <div ref={ref} className={cn('terminal overflow-hidden rounded-[22px] text-[#e9e7e2] shadow-[0_30px_70px_-30px_rgba(0,0,0,.6)]', className)}>
      <div className="flex h-10 items-center gap-1.5 border-b border-white/[.06] px-4">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-[11.5px] text-white/45">zsh · ~/school</span>
      </div>
      <pre className={cn('m-0 flex h-[340px] flex-col justify-end overflow-hidden whitespace-pre-wrap px-5 py-4 font-mono text-[12.5px] leading-[1.7] sm:text-[13px]', reserve && 'sm:h-[430px] sm:pb-28')}>
        {lines.map((l, i) =>
          l.kind === 'cmd' ? (
            <div key={i}>
              <span className="text-[#7dd3a8]">❯ </span>
              {l.text}
            </div>
          ) : (
            <div key={i} className={cn('text-white/60', /^\S/.test(l.text) && !l.text.startsWith('added') && 'font-semibold text-white/85')}>
              {l.text}
            </div>
          ),
        )}
        <div>
          <span className="text-[#7dd3a8]">❯ </span>
          {typing}
          <span className="terminal-caret" />
        </div>
      </pre>
    </div>
  );
}

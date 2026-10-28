import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { AGENT_CLI, BASE_URL } from './env.js';

/** The temp directory global-setup made for this run. */
export const tmpDir = (): string => {
  const t = process.env.E2E_TMP;
  if (!t) throw new Error('E2E_TMP is not set: the specs must run through playwright.config.ts (global-setup)');
  return t;
};

/** Where the agent keeps agent.json, state.json and its cache for this run (COLLECTED_AGENT_HOME). */
export const agentHome = (): string => path.join(tmpDir(), 'agent-home');

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the built `collected` CLI (agent/dist/cli.js) against the e2e server. `input` is piped to stdin. */
export function cli(args: string[], opts: { input?: string } = {}): CliResult {
  const r = spawnSync(process.execPath, [AGENT_CLI, ...args], {
    encoding: 'utf8',
    input: opts.input,
    env: { ...process.env, COLLECTED_AGENT_HOME: agentHome(), TZ: 'America/New_York' },
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `cli` that must succeed; returns stdout. */
export function cliOk(args: string[], opts: { input?: string } = {}): string {
  const r = cli(args, opts);
  expect(r.status, `collected ${args.join(' ')}\n${r.stdout}\n${r.stderr}`).toBe(0);
  return r.stdout;
}

/** Points the CLI at the server with the helper key (idempotent: re-inits with --force). */
export function ensureAgentConfigured(): void {
  mkdirSync(agentHome(), { recursive: true });
  cliOk(['init', BASE_URL, '--force', '--device', 'e2e-box']);
  const key = process.env.E2E_HELPER_KEY;
  if (!key) throw new Error('E2E_HELPER_KEY is not set');
  cliOk(['auth', 'helper-key'], { input: `${key}\n` });
}

/** GET /api/<path> as JSON, failing the test on a non-2xx answer. */
export async function apiGet<T>(request: APIRequestContext, p: string): Promise<T> {
  const res = await request.get(`/api${p}`);
  expect(res.ok(), `GET /api${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Write to /api/<path> with a JSON body, failing the test on a non-2xx answer. */
export async function apiSend<T>(request: APIRequestContext, method: 'post' | 'put' | 'patch' | 'delete', p: string, data?: unknown): Promise<T> {
  const res = await request[method](`/api${p}`, { data });
  expect(res.ok(), `${method.toUpperCase()} /api${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** The dashboard, with the grid rendered (the five core widgets are present on a fresh database). */
export async function openDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /^Today,/ })).toBeVisible();
  await expect(widget(page, 'Classes overview')).toBeVisible();
}

/** The frame of one widget by its header title. */
export function widget(page: Page, title: string) {
  return page.locator('.react-grid-item').filter({ has: page.locator('.surface-head').getByText(title, { exact: true }) });
}

/** The right-hand course drawer. */
export function pane(page: Page) {
  return page.getByRole('dialog').filter({ has: page.locator('[data-slot="sheet-title"]') });
}

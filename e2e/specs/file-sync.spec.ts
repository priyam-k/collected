import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { FileSyncManifest, FileSyncManifestCourse } from '@collected/shared';
import { COURSE } from '../env.js';
import { apiGet, apiSend, cli, cliOk, ensureAgentConfigured, tmpDir } from '../helpers.js';

/*
 * File sync without Canvas: the server decides where every fixture file goes (rules, fallback), the agent links a
 * folder and plans the run, the report round-trips. What is NOT covered here: the download itself. The server
 * serves file bytes only by redirecting to Canvas's CDN with a live session, so without Canvas a real `sync`
 * fails closed on every file (asserted below) and no file ever lands in the folder.
 */
test.describe.serial('file sync', () => {
  const courseId = COURSE.cmsc422;
  let vault: string;

  test.beforeAll(() => {
    ensureAgentConfigured();
    vault = path.join(tmpDir(), 'vault', 'cmsc422');
    mkdirSync(vault, { recursive: true });
  });

  test('enabling sync on a course yields decisions for every fixture file', async ({ request }) => {
    const course = await apiSend<{ fileSync: { enabled: boolean; targets: { name: string }[] } | null }>(request, 'put', `/courses/${courseId}`, {
      fileSync: {
        enabled: true,
        targets: [{ name: 'slides', description: 'lecture slides and notes' }],
        rules: [{ target: 'slides', folder: '^/Lectures' }],
        fallback: 'unsorted',
      },
    });
    expect(course.fileSync?.enabled).toBe(true);
    expect(course.fileSync?.targets.map((t) => t.name)).toEqual(['slides']);

    const manifest = await apiGet<FileSyncManifest>(request, '/file-sync/manifest');
    const mc = manifest.courses.find((c) => c.course.id === courseId)!;
    expect(mc).toBeTruthy();
    const byName = Object.fromEntries(mc.files.map((f) => [f.filename, f.decision]));
    expect(Object.keys(byName).sort()).toEqual(['DecisionTreesNotes.pdf', 'decisionTreeCode.zip', 'lecture03_knn.pdf', 'syllabus.pdf']);
    expect(byName['lecture03_knn.pdf']).toMatchObject({ target: 'slides', decidedBy: 'rule' });
    expect(byName['DecisionTreesNotes.pdf']).toMatchObject({ target: 'slides', decidedBy: 'rule' });
    expect(byName['decisionTreeCode.zip']).toMatchObject({ target: 'unsorted', decidedBy: 'fallback' });
    expect(byName['syllabus.pdf']).toMatchObject({ target: 'unsorted', decidedBy: 'fallback' });

    const view = await apiGet<FileSyncManifestCourse>(request, `/file-sync/courses/${courseId}`);
    expect(view.files).toHaveLength(4);
    expect(view.files.every((f) => f.placed === null)).toBe(true);
  });

  test('a manual override wins over the rule', async ({ request }) => {
    const fileId = '90735997'; // lecture03_knn.pdf
    const updated = await apiSend<{ decision: { target: string; decidedBy: string } }>(request, 'put', `/file-sync/courses/${courseId}/files/${fileId}`, { target: 'unsorted' });
    expect(updated.decision).toMatchObject({ target: 'unsorted', decidedBy: 'manual' });
    const back = await apiSend<{ decision: { target: string; decidedBy: string } }>(request, 'put', `/file-sync/courses/${courseId}/files/${fileId}`, { target: null });
    expect(back.decision).toMatchObject({ target: 'slides', decidedBy: 'rule' });
    const bogus = await request.put(`/api/file-sync/courses/${courseId}/files/${fileId}`, { data: { target: 'elsewhere' } });
    expect(bogus.status()).toBe(422);
  });

  test('the agent links a folder and plans the run without touching the disk', async ({ request }) => {
    expect(cliOk(['files', 'link', courseId, vault])).toContain('root →');
    const listing = cliOk(['files', 'courses']);
    expect(listing).toContain(`CMSC422  (${courseId})  4 files`);
    expect(listing).toContain(path.join(vault, 'slides'));
    expect(listing).toContain(path.join(vault, 'unsorted'));

    const plan = cliOk(['sync', '--dry-run', '--no-model']);
    expect(plan).toContain('CMSC422: 4 files');
    // Rule hits keep the Canvas folder under the target: <vault>/slides/Lectures/.
    expect(plan).toMatch(/new: lecture03_knn\.pdf → .*slides\/Lectures \(folder ~ \/\^\/Lectures\/\)/);
    expect(plan).toMatch(/new: DecisionTreesNotes\.pdf → .*slides\/Lectures/);
    expect(plan).toMatch(/new: decisionTreeCode\.zip → .*unsorted\/Homework\/Code \(no rule matched\)/);
    expect(plan).toMatch(/new: syllabus\.pdf → .*unsorted \(no rule matched\)/);
    expect(plan).toContain('dry run: 1 course: 4 new, 0 updated, 0 moved, 0 adopted, 0 removed, 0 unchanged, 0 skipped');
    expect(readdirSync(vault)).toEqual([]);

    // Even a dry run reports where this device maps the targets.
    const devices = await apiGet<{ device: string; targets: Record<string, Record<string, string>> }[]>(request, '/file-sync/devices');
    const box = devices.find((d) => d.device === 'e2e-box')!;
    expect(box.targets[courseId]).toMatchObject({ slides: path.join(vault, 'slides'), unsorted: path.join(vault, 'unsorted') });
  });

  test('a real sync fails closed on every download while Canvas is not connected', () => {
    const r = cli(['sync', '--no-model']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/! lecture03_knn\.pdf: file 90735997: expected a redirect, got 404/);
    expect(r.stdout).toContain('Canvas is not connected');
    expect(r.stdout).toContain('4 errors');
    expect(existsSync(path.join(vault, 'slides'))).toBe(false);
    expect(existsSync(path.join(vault, 'unsorted'))).toBe(false);
  });

  test('a posted report shows up in the course view, and unknown files are ignored', async ({ request }) => {
    const localPath = path.join(vault, 'slides', 'lecture03_knn.pdf');
    const result = await apiSend<{ ok: boolean; placed: number; ignored: number }>(request, 'post', '/file-sync/report', {
      device: 'e2e-box',
      model: false,
      targets: { [courseId]: { slides: path.join(vault, 'slides') } },
      decisions: [],
      placed: [
        { courseId, fileId: '90735997', target: 'slides', localPath },
        { courseId, fileId: '424242', target: 'slides', localPath: path.join(vault, 'slides', 'nope.pdf') },
      ],
      removed: [],
      errors: [{ courseId, message: 'e2e: a note from the device' }],
    });
    expect(result).toMatchObject({ ok: true, placed: 2, ignored: 1 });

    const view = await apiGet<FileSyncManifestCourse>(request, `/file-sync/courses/${courseId}`);
    const knn = view.files.find((f) => f.fileId === '90735997')!;
    expect(knn.placed).toMatchObject({ target: 'slides', localPath, device: 'e2e-box' });
    expect(view.files.filter((f) => f.placed).map((f) => f.fileId)).toEqual(['90735997']);

    const devices = await apiGet<{ device: string; errors: { message: string }[] }[]>(request, '/file-sync/devices');
    expect(devices.find((d) => d.device === 'e2e-box')?.errors.map((e) => e.message)).toContain('e2e: a note from the device');
  });

  test('the course drawer shows the sync panel with the decisions', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('.react-grid-item').filter({ hasText: 'Classes overview' }).getByRole('button', { name: /CMSC422/ }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: /^Files/ }).click();
    await drawer.getByRole('button', { name: /Sync to laptop/ }).click();
    const knn = drawer.getByRole('combobox', { name: 'Folder for lecture03_knn.pdf' });
    await expect(knn).toBeVisible();
    await expect(knn.locator('option').first()).toHaveText('slides (auto)');
    await expect(drawer.getByRole('combobox', { name: 'Folder for syllabus.pdf' }).locator('option').first()).toHaveText('unsorted (auto)');
    await expect(drawer.getByText('on e2e-box')).toBeVisible();
  });
});

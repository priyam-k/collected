import { FILE_SYNC_SKIP, type FileSyncConfig, type FileSyncFile } from '@collected/shared';

export interface ModelAnswer {
  target: string;
  confidence: number | null;
  probabilities: Record<string, number> | null;
}

/** The slice of @receptron/laya we use; typed here so the agent builds without the package's own declarations. */
interface LayaLike {
  systemOne(
    subject: Record<string, string | null>,
    questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }>,
  ): Promise<{ answers: Record<string, { choice: string; probabilities?: Record<string, number> }> }>;
}

let loading: Promise<LayaLike> | null = null;

/**
 * Laya (open-weight System 1 decision model) running locally through ONNX. ~1.7 GB of weights download to
 * ~/.cache/receptron-laya on first use and the loaded model wants ~2 GB of RAM, so it is loaded once per run and
 * only when something actually needs classifying (DECISIONS 037).
 */
export async function loadModel(log: (msg: string) => void = () => {}): Promise<LayaLike> {
  if (!loading) {
    loading = (async () => {
      log('loading Laya (first run downloads the model weights, ~1.7 GB)…');
      const mod = (await import('@receptron/laya')) as unknown as { Laya: { load(): Promise<LayaLike> } };
      const t0 = Date.now();
      const laya = await mod.Laya.load();
      log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return laya;
    })();
  }
  return loading;
}

export const subjectFor = (f: FileSyncFile): Record<string, string | null> => ({
  title: f.title,
  filename: f.filename,
  folder: f.folderPath,
  module: f.moduleName,
  type: f.contentType,
});

export const criteriaFor = (cfg: FileSyncConfig): Record<string, string> => ({
  ...Object.fromEntries(cfg.targets.map((t) => [t.name, t.description || t.name])),
  [FILE_SYNC_SKIP]: cfg.skipHint || 'not worth keeping',
});

/** One decision: which target (or skip) this course file belongs to, with the model's confidence in that pick. */
export async function classify(model: LayaLike, cfg: FileSyncConfig, file: FileSyncFile): Promise<ModelAnswer> {
  const { answers } = await model.systemOne(subjectFor(file), {
    target: {
      type: 'choice',
      instructions: 'This is a file posted to a university course page. Which local folder should it be saved to, or should it be skipped?',
      criteria: criteriaFor(cfg),
    },
  });
  const a = answers.target;
  if (!a?.choice) throw new Error('model returned no choice');
  const probabilities = a.probabilities ?? null;
  const confidence = probabilities ? (probabilities[a.choice] ?? null) : null;
  return { target: a.choice, confidence, probabilities };
}

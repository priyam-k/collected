import { FILE_SYNC_SKIP, FILE_SYNC_UNSORTED, type FileSyncConfig, type FileSyncDecision, type FileSyncFile, type FileSyncRule } from './types.js';

/** Shared by the server (manifest, UI) and the agent (placing in the same run it classified): one place decides. */

const test = (pattern: string | null, value: string | null | undefined): boolean => {
  if (pattern == null) return true; // not part of the rule
  if (value == null) return false; // rule needs a field the file lacks
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
};

export function ruleMatches(rule: FileSyncRule, file: Pick<FileSyncFile, 'folderPath' | 'moduleName' | 'filename' | 'title'>): boolean {
  if (!rule.folder && !rule.module && !rule.name) return false;
  return test(rule.folder, file.folderPath) && test(rule.module, file.moduleName) && test(rule.name, file.filename || file.title);
}

export function describeRule(rule: FileSyncRule): string {
  const parts: string[] = [];
  if (rule.folder) parts.push(`folder ~ /${rule.folder}/`);
  if (rule.module) parts.push(`module ~ /${rule.module}/`);
  if (rule.name) parts.push(`name ~ /${rule.name}/`);
  return parts.join(' and ');
}

export interface FileSyncStateInput {
  manualTarget: string | null;
  model: { target: string; confidence: number | null } | null;
}

/**
 * Where a file goes. Precedence: manual override, first matching rule, model (thresholded to `unsorted`),
 * then the course's fallback. Returns null when the answer is "wait for the model".
 */
export function decideFile(config: FileSyncConfig, file: FileSyncFile, state: FileSyncStateInput): FileSyncDecision | null {
  if (state.manualTarget) return { target: state.manualTarget, decidedBy: 'manual', confidence: null, reason: 'set by hand' };
  for (const rule of config.rules) {
    if (ruleMatches(rule, file)) return { target: rule.target, decidedBy: 'rule', confidence: null, reason: describeRule(rule) };
  }
  if (state.model) {
    const conf = state.model.confidence;
    const sure = conf == null || conf >= config.threshold;
    if (sure) return { target: state.model.target, decidedBy: 'model', confidence: conf, reason: conf == null ? 'model' : `model ${conf.toFixed(2)}` };
    return { target: FILE_SYNC_UNSORTED, decidedBy: 'model', confidence: conf, reason: `model unsure (${conf.toFixed(2)} < ${config.threshold}) → ${FILE_SYNC_UNSORTED}` };
  }
  switch (config.fallback) {
    case 'model':
      return null;
    case 'unsorted':
      return { target: FILE_SYNC_UNSORTED, decidedBy: 'fallback', confidence: null, reason: 'no rule matched' };
    case 'skip':
      return { target: FILE_SYNC_SKIP, decidedBy: 'fallback', confidence: null, reason: 'no rule matched' };
  }
}

/** Target names a file may be sent to by hand or by the model: the course's targets plus the reserved two. */
export function allowedTargets(config: FileSyncConfig): string[] {
  return [...config.targets.map((t) => t.name), FILE_SYNC_UNSORTED, FILE_SYNC_SKIP];
}

import type { Course } from '@collected/shared';

/** Words for the stored course enums; the raw values ("ta", "both") are ids, not copy. */
export const ROLE_LABEL: Record<Course['role'], string> = { student: 'Student', ta: 'TA' };
export const SUBMITS_LABEL: Record<Course['submitsVia'], string> = { canvas: 'Canvas', gradescope: 'Gradescope', both: 'Both' };

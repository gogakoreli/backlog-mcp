// ============================================================================
// Task ID
// ============================================================================

const TASK_ID_PREFIX = 'TASK-';
const TASK_ID_PATTERN = /^TASK-(\d{4,})$/;

export function isValidTaskId(id: unknown): id is string {
  return typeof id === 'string' && TASK_ID_PATTERN.test(id);
}

export function parseTaskId(id: string): number | null {
  const match = TASK_ID_PATTERN.exec(id);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

export function formatTaskId(num: number): string {
  return `${TASK_ID_PREFIX}${num.toString().padStart(4, '0')}`;
}

export function nextTaskId(existingTasks: ReadonlyArray<{ id: string }>): string {
  let maxNum = 0;
  for (const task of existingTasks) {
    const num = parseTaskId(task.id);
    if (num !== null && num > maxNum) {
      maxNum = num;
    }
  }
  return formatTaskId(maxNum + 1);
}

// ============================================================================
// Status
// ============================================================================

/**
 * Status semantics (locked definitions):
 * - open: work is defined but not started
 * - in_progress: someone is actively working to produce artifacts
 * - blocked: progress is impossible without external change
 * - verifying: work claims submitted, awaiting audit
 * - done: claims verified; required evidence exists (terminal)
 * - cancelled: work intentionally abandoned (terminal)
 */
export const STATUSES = ['open', 'in_progress', 'blocked', 'verifying', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

// ============================================================================
// Structured Types
// ============================================================================

export interface Dod {
  checklist: string[];
}

export interface Evidence {
  artifacts: string[];
  commands?: string[];
  notes?: string;
}

export interface Blocked {
  reason: string;
  dependency?: string;
}

// ============================================================================
// Task
// ============================================================================

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: Status;
  created_at: string;
  updated_at: string;
  dod?: Dod;
  evidence?: Evidence;
  blocked?: Blocked | null;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateTaskInput {
  id?: string;
  title: string;
  description?: string;
  dod?: Dod;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidStatus(value: unknown): value is Status {
  return typeof value === 'string' && STATUSES.includes(value as Status);
}

function isValidISOTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function validateDod(dod: unknown, errors: ValidationError[], prefix: string): void {
  if (typeof dod !== 'object' || dod === null) {
    errors.push({ field: prefix, message: 'must be an object' });
    return;
  }
  const d = dod as Record<string, unknown>;
  if (!Array.isArray(d.checklist)) {
    errors.push({ field: `${prefix}.checklist`, message: 'must be an array' });
  } else if (!d.checklist.every((item) => isNonEmptyString(item))) {
    errors.push({ field: `${prefix}.checklist`, message: 'all items must be non-empty strings' });
  }
}

function validateEvidence(evidence: unknown, errors: ValidationError[], prefix: string): void {
  if (typeof evidence !== 'object' || evidence === null) {
    errors.push({ field: prefix, message: 'must be an object' });
    return;
  }
  const e = evidence as Record<string, unknown>;

  if (e.artifacts !== undefined) {
    if (!Array.isArray(e.artifacts)) {
      errors.push({ field: `${prefix}.artifacts`, message: 'must be an array' });
    } else if (!e.artifacts.every((item) => isNonEmptyString(item))) {
      errors.push({ field: `${prefix}.artifacts`, message: 'all items must be non-empty strings' });
    }
  }

  if (e.commands !== undefined) {
    if (!Array.isArray(e.commands)) {
      errors.push({ field: `${prefix}.commands`, message: 'must be an array' });
    } else if (!e.commands.every((item) => typeof item === 'string')) {
      errors.push({ field: `${prefix}.commands`, message: 'all items must be strings' });
    }
  }

  if (e.notes !== undefined && typeof e.notes !== 'string') {
    errors.push({ field: `${prefix}.notes`, message: 'must be a string' });
  }
}

function validateBlocked(blocked: unknown, errors: ValidationError[], prefix: string): void {
  if (typeof blocked !== 'object' || blocked === null) {
    errors.push({ field: prefix, message: 'must be an object' });
    return;
  }
  const b = blocked as Record<string, unknown>;

  if (!isNonEmptyString(b.reason)) {
    errors.push({ field: `${prefix}.reason`, message: 'must be a non-empty string' });
  }

  if (b.dependency !== undefined && typeof b.dependency !== 'string') {
    errors.push({ field: `${prefix}.dependency`, message: 'must be a string' });
  }
}

export function validateTask(task: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof task !== 'object' || task === null) {
    return { valid: false, errors: [{ field: 'task', message: 'must be an object' }] };
  }

  const t = task as Record<string, unknown>;

  // Required fields
  if (!isValidTaskId(t.id)) {
    errors.push({ field: 'id', message: 'must be in format TASK-XXXX (e.g., TASK-0001)' });
  }

  if (!isNonEmptyString(t.title)) {
    errors.push({ field: 'title', message: 'must be a non-empty string' });
  }

  if (t.description !== undefined && typeof t.description !== 'string') {
    errors.push({ field: 'description', message: 'must be a string if present' });
  }

  if (!isValidStatus(t.status)) {
    errors.push({ field: 'status', message: `must be one of: ${STATUSES.join(', ')}` });
  }

  if (!isValidISOTimestamp(t.created_at)) {
    errors.push({ field: 'created_at', message: 'must be a valid ISO8601 timestamp' });
  }

  if (!isValidISOTimestamp(t.updated_at)) {
    errors.push({ field: 'updated_at', message: 'must be a valid ISO8601 timestamp' });
  }

  // Status-specific validation
  if (t.status === 'blocked') {
    if (!t.blocked) {
      errors.push({ field: 'blocked', message: 'required when status is blocked' });
    } else {
      validateBlocked(t.blocked, errors, 'blocked');
    }
  }

  // verifying and done both require dod + evidence
  if (t.status === 'verifying' || t.status === 'done') {
    // dod.checklist required non-empty
    if (!t.dod) {
      errors.push({ field: 'dod', message: `required when status is ${t.status}` });
    } else {
      validateDod(t.dod, errors, 'dod');
      const dod = t.dod as Record<string, unknown>;
      if (Array.isArray(dod.checklist) && dod.checklist.length === 0) {
        errors.push({ field: 'dod.checklist', message: `must be non-empty when status is ${t.status}` });
      }
    }

    // evidence.artifacts required at least 1
    if (!t.evidence) {
      errors.push({ field: 'evidence', message: `required when status is ${t.status}` });
    } else {
      validateEvidence(t.evidence, errors, 'evidence');
      const evidence = t.evidence as Record<string, unknown>;
      if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
        errors.push({ field: 'evidence.artifacts', message: `must have at least 1 artifact when status is ${t.status}` });
      }
    }
  }

  // Validate optional fields structure when present (skip if already validated above)
  const requiresEvidence = t.status === 'verifying' || t.status === 'done';
  if (t.dod !== undefined && !requiresEvidence) {
    validateDod(t.dod, errors, 'dod');
  }

  if (t.evidence !== undefined && !requiresEvidence) {
    validateEvidence(t.evidence, errors, 'evidence');
  }

  if (t.blocked !== undefined && t.blocked !== null && t.status !== 'blocked') {
    validateBlocked(t.blocked, errors, 'blocked');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ============================================================================
// Factory
// ============================================================================

export function createTask(
  input: CreateTaskInput,
  existingTasks: ReadonlyArray<{ id: string }> = []
): Task {
  const now = new Date().toISOString();
  const id = input.id ?? nextTaskId(existingTasks);

  return {
    id,
    title: input.title,
    description: input.description,
    status: 'open',
    created_at: now,
    updated_at: now,
    dod: input.dod,
  };
}

export function validateCreateTaskInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: [{ field: 'input', message: 'must be an object' }] };
  }

  const i = input as Record<string, unknown>;

  if (i.id !== undefined && !isValidTaskId(i.id)) {
    errors.push({ field: 'id', message: 'must be in format TASK-XXXX if provided' });
  }

  if (!isNonEmptyString(i.title)) {
    errors.push({ field: 'title', message: 'must be a non-empty string' });
  }

  if (i.description !== undefined && typeof i.description !== 'string') {
    errors.push({ field: 'description', message: 'must be a string if present' });
  }

  if (i.dod !== undefined) {
    validateDod(i.dod, errors, 'dod');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ============================================================================
// Mutation Authority
// ============================================================================

/**
 * Mutation rules (locked):
 * - title, description: mutable in open, in_progress, blocked
 * - dod: mutable in open, in_progress (frozen once in verifying)
 * - evidence: set only via transition to verifying (not directly mutable)
 * - blocked: set only via transition to blocked (not directly mutable)
 * - id, status, created_at, updated_at: never directly mutable
 */

export type MutableField = 'title' | 'description' | 'dod';

const FIELD_MUTABILITY: Record<MutableField, readonly Status[]> = {
  title: ['open', 'in_progress', 'blocked'],
  description: ['open', 'in_progress', 'blocked'],
  dod: ['open', 'in_progress'],
} as const;

export function canMutateField(field: MutableField, status: Status): boolean {
  return FIELD_MUTABILITY[field].includes(status);
}

export function getMutableFields(status: Status): MutableField[] {
  return (Object.keys(FIELD_MUTABILITY) as MutableField[]).filter((field) =>
    FIELD_MUTABILITY[field].includes(status)
  );
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dod?: Dod;
}

export type UpdateResult =
  | { ok: true; task: Task }
  | { ok: false; errors: ValidationError[] };

export function updateTask(task: Task, input: UpdateTaskInput): UpdateResult {
  const errors: ValidationError[] = [];

  // Check mutation authority for each field being updated
  if (input.title !== undefined && !canMutateField('title', task.status)) {
    errors.push({ field: 'title', message: `cannot modify in status '${task.status}'` });
  }

  if (input.description !== undefined && !canMutateField('description', task.status)) {
    errors.push({ field: 'description', message: `cannot modify in status '${task.status}'` });
  }

  if (input.dod !== undefined && !canMutateField('dod', task.status)) {
    errors.push({ field: 'dod', message: `cannot modify in status '${task.status}'` });
  }

  // Validate field values
  if (input.title !== undefined && !isNonEmptyString(input.title)) {
    errors.push({ field: 'title', message: 'must be a non-empty string' });
  }

  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.push({ field: 'description', message: 'must be a string' });
  }

  if (input.dod !== undefined) {
    validateDod(input.dod, errors, 'dod');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Apply updates
  const now = new Date().toISOString();
  const updatedTask: Task = {
    ...task,
    updated_at: now,
  };

  if (input.title !== undefined) {
    updatedTask.title = input.title;
  }

  if (input.description !== undefined) {
    updatedTask.description = input.description;
  }

  if (input.dod !== undefined) {
    updatedTask.dod = input.dod;
  }

  return { ok: true, task: updatedTask };
}

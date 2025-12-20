import type { Task, Status, Blocked, Dod, Evidence, ValidationError } from './schema.js';

// ============================================================================
// Constants
// ============================================================================

export const TERMINAL_STATUSES: readonly Status[] = ['done', 'cancelled'] as const;

/**
 * State machine transitions:
 *
 * open ──────► in_progress ──────► verifying ──────► done
 *   │               │                  │
 *   │               │                  ├─► in_progress (rejected)
 *   │               │                  │
 *   │               │                  └─► cancelled
 *   │               │
 *   │               ├────────────────► blocked
 *   │               │                     │
 *   │               │                     ├─► in_progress
 *   │               │                     │
 *   │               │                     └─► cancelled
 *   │               │
 *   │               └────────────────► cancelled
 *   │
 *   └────────────────────────────────► cancelled
 */
const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['blocked', 'verifying', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  verifying: ['done', 'in_progress', 'cancelled'],
  done: [],
  cancelled: [],
} as const;

// ============================================================================
// Transition Input Types
// ============================================================================

export interface TransitionToBlocked {
  to: 'blocked';
  blocked: Blocked;
}

export interface TransitionToVerifying {
  to: 'verifying';
  dod: Dod;
  evidence: Evidence;
}

export interface TransitionToDone {
  to: 'done';
}

export interface TransitionToInProgress {
  to: 'in_progress';
}

export interface TransitionToCancelled {
  to: 'cancelled';
}

export type TransitionInput =
  | TransitionToBlocked
  | TransitionToVerifying
  | TransitionToDone
  | TransitionToInProgress
  | TransitionToCancelled;

// ============================================================================
// Result Types
// ============================================================================

export type TransitionResult =
  | { ok: true; task: Task }
  | { ok: false; errors: ValidationError[] };

// ============================================================================
// Helpers
// ============================================================================

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

// ============================================================================
// Query Functions
// ============================================================================

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function getAllowedTransitions(from: Status): readonly Status[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isTerminal(status: Status): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ============================================================================
// Transition Validators
// ============================================================================

function validateBlockedInput(input: TransitionToBlocked, errors: ValidationError[]): void {
  if (!input.blocked || typeof input.blocked !== 'object') {
    errors.push({ field: 'blocked', message: 'required for transition to blocked' });
    return;
  }

  if (!isNonEmptyString(input.blocked.reason)) {
    errors.push({ field: 'blocked.reason', message: 'must be a non-empty string' });
  }

  if (input.blocked.dependency !== undefined && typeof input.blocked.dependency !== 'string') {
    errors.push({ field: 'blocked.dependency', message: 'must be a string if present' });
  }
}

function validateVerifyingInput(input: TransitionToVerifying, errors: ValidationError[]): void {
  // Validate dod
  if (!input.dod || typeof input.dod !== 'object') {
    errors.push({ field: 'dod', message: 'required for transition to verifying' });
  } else if (!isNonEmptyStringArray(input.dod.checklist)) {
    errors.push({ field: 'dod.checklist', message: 'must be a non-empty array of non-empty strings' });
  }

  // Validate evidence
  if (!input.evidence || typeof input.evidence !== 'object') {
    errors.push({ field: 'evidence', message: 'required for transition to verifying' });
    return;
  }

  if (!isNonEmptyStringArray(input.evidence.artifacts)) {
    errors.push({ field: 'evidence.artifacts', message: 'must have at least 1 non-empty artifact' });
  }

  if (input.evidence.commands !== undefined) {
    if (!Array.isArray(input.evidence.commands)) {
      errors.push({ field: 'evidence.commands', message: 'must be an array if present' });
    } else if (!input.evidence.commands.every((c) => typeof c === 'string')) {
      errors.push({ field: 'evidence.commands', message: 'all items must be strings' });
    }
  }

  if (input.evidence.notes !== undefined && typeof input.evidence.notes !== 'string') {
    errors.push({ field: 'evidence.notes', message: 'must be a string if present' });
  }
}

function validateDoneTransition(task: Task, errors: ValidationError[]): void {
  // Structural verification: task must already have dod and evidence from verifying state
  if (!task.dod || !Array.isArray(task.dod.checklist) || task.dod.checklist.length === 0) {
    errors.push({ field: 'dod.checklist', message: 'must be non-empty to complete verification' });
  }

  if (!task.evidence || !Array.isArray(task.evidence.artifacts) || task.evidence.artifacts.length === 0) {
    errors.push({ field: 'evidence.artifacts', message: 'must have at least 1 artifact to complete verification' });
  }
}

// ============================================================================
// Transition Function
// ============================================================================

export function transition(task: Task, input: TransitionInput): TransitionResult {
  const errors: ValidationError[] = [];
  const from = task.status;
  const to = input.to;

  // Check if transition is allowed by state machine
  if (!canTransition(from, to)) {
    const allowed = getAllowedTransitions(from);
    const allowedStr = allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
    errors.push({
      field: 'status',
      message: `cannot transition from '${from}' to '${to}'. Allowed: ${allowedStr}`,
    });
    return { ok: false, errors };
  }

  // Validate transition-specific requirements
  switch (input.to) {
    case 'blocked':
      validateBlockedInput(input, errors);
      break;
    case 'verifying':
      validateVerifyingInput(input, errors);
      break;
    case 'done':
      validateDoneTransition(task, errors);
      break;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build the updated task
  const now = new Date().toISOString();
  const updatedTask: Task = {
    ...task,
    status: to,
    updated_at: now,
  };

  // Apply transition-specific changes
  switch (input.to) {
    case 'blocked':
      updatedTask.blocked = input.blocked;
      break;

    case 'verifying':
      updatedTask.dod = input.dod;
      updatedTask.evidence = input.evidence;
      updatedTask.blocked = null;
      break;

    case 'done':
      // No changes needed - dod and evidence already set from verifying
      updatedTask.blocked = null;
      break;

    case 'in_progress':
      if (from === 'blocked') {
        // Clear blocked field when unblocking
        updatedTask.blocked = null;
      } else if (from === 'verifying') {
        // Rejection: clear evidence, keep dod for retry
        updatedTask.evidence = undefined;
      }
      break;

    case 'cancelled':
      updatedTask.blocked = null;
      break;
  }

  return { ok: true, task: updatedTask };
}

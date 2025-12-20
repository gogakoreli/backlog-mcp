// Schema
export {
  // Task ID utilities
  isValidTaskId,
  parseTaskId,
  formatTaskId,
  nextTaskId,
  // Status
  STATUSES,
  type Status,
  // Structured types
  type Dod,
  type Evidence,
  type Blocked,
  // Task
  type Task,
  type CreateTaskInput,
  // Validation
  type ValidationError,
  type ValidationResult,
  validateTask,
  validateCreateTaskInput,
  // Factory
  createTask,
  // Mutation authority
  type MutableField,
  type UpdateTaskInput,
  type UpdateResult,
  canMutateField,
  getMutableFields,
  updateTask,
} from './schema.js';

// Transitions
export {
  TERMINAL_STATUSES,
  type TransitionToBlocked,
  type TransitionToVerifying,
  type TransitionToDone,
  type TransitionToInProgress,
  type TransitionToCancelled,
  type TransitionInput,
  type TransitionResult,
  canTransition,
  getAllowedTransitions,
  isTerminal,
  transition,
} from './transitions.js';

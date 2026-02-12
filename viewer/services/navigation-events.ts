/**
 * navigation-events.ts — Typed emitter for task navigation.
 *
 * Replaces document CustomEvent strings (task-select, scope-enter)
 * with typed, DI-injected events per `emitter-typed-events`.
 */
import { Emitter } from '@framework/emitter.js';

export class NavigationEvents extends Emitter<{
  'task-select': { taskId: string };
  'scope-enter': { scopeId: string };
}> {}

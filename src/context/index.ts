export { hydrateContext, type HydrationServiceDeps } from './hydration-service.js';
export type {
  ContextRequest,
  ContextResponse,
  ContextEntity,
  ContextResource,
  ContextActivity,
  ContextMetadata,
  Fidelity,
} from './types.js';
export { estimateTokens, applyBudget, downgradeEntity, downgradeResource } from './token-budget.js';
export { resolveFocal, taskToContextEntity } from './stages/focal-resolution.js';
export { expandRelations } from './stages/relational-expansion.js';

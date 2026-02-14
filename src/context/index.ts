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
export { resolveFocal, taskToContextEntity, type SearchDeps } from './stages/focal-resolution.js';
export { expandRelations } from './stages/relational-expansion.js';
export { enrichSemantic, type SemanticEnrichmentDeps } from './stages/semantic-enrichment.js';
export { overlayTemporal, type TemporalOverlayDeps } from './stages/temporal-overlay.js';

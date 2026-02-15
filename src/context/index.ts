export { hydrateContext, type HydrationServiceDeps } from './hydration-service.js';
export type {
  ContextRequest,
  ContextResponse,
  ContextEntity,
  ContextResource,
  ContextActivity,
  ContextMetadata,
  SessionSummary,
  Fidelity,
} from './types.js';
export { estimateTokens, applyBudget, downgradeEntity, downgradeResource, estimateSessionSummaryTokens } from './token-budget.js';
export { resolveFocal, taskToContextEntity, type SearchDeps } from './stages/focal-resolution.js';
export { expandRelations } from './stages/relational-expansion.js';
export { enrichSemantic, type SemanticEnrichmentDeps } from './stages/semantic-enrichment.js';
export { overlayTemporal, type TemporalOverlayDeps } from './stages/temporal-overlay.js';
export { deriveSessionSummary, type SessionMemoryDeps } from './stages/session-memory.js';
export { traverseCrossReferences, extractEntityIds, buildReverseReferenceIndex, lookupReverseReferences, type CrossReferenceTraversalDeps } from './stages/cross-reference-traversal.js';

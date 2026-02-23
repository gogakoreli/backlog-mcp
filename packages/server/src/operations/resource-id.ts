/**
 * Resource ID extraction from tool params/results.
 * Each tool has its own extraction strategy.
 */

type Extractor = (params: Record<string, unknown>, result: unknown) => string | undefined;

const ID_RE = /(TASK|EPIC|FLDR|ARTF|MLST)-\d+/;

const extractors: Record<string, Extractor> = {
  backlog_create: (_, result) => {
    const text = (result as any)?.content?.[0]?.text as string | undefined;
    return text ? ID_RE.exec(text)?.[0] : undefined;
  },

  backlog_update: (params) => params.id as string | undefined,

  backlog_delete: (params) => params.id as string | undefined,

  write_resource: (params) => {
    const uri = params.uri as string | undefined;
    return uri ? ID_RE.exec(uri)?.[0] : undefined;
  },
};

/**
 * Extract resource ID from tool params or result for filtering.
 */
export function extractResourceId(
  tool: string,
  params: Record<string, unknown>,
  result: unknown
): string | undefined {
  const extractor = extractors[tool];
  return extractor ? extractor(params, result) : undefined;
}

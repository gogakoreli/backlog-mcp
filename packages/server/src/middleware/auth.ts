import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Skip auth for health check and version
  if (request.url === '/health' || request.url === '/version') {
    return;
  }

  // API key auth for MCP endpoint (optional, for cloud deployment)
  if (request.url.startsWith('/mcp') && process.env.API_KEY) {
    const apiKey = request.headers.authorization;
    if (apiKey !== `Bearer ${process.env.API_KEY}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  }
}

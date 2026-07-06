// GET /openapi.json — hand-written OpenAPI 3.1 spec.
// Public endpoint (no auth) so embedded Scalar UIs and AI tools can fetch it.
// Concept §0, §2, §8 — referenced from /docs and from the embed snippet.

import type { Context } from './_router.ts';

export const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'SC Companion Public API',
    version: '1.0.0',
    description:
      'Read-only access to Star Citizen Verse data — patch versions, news, ships, components. ' +
      'Bearer tokens (`scc_live_*`) are created in the admin UI at `/admin/api-tokens`. ' +
      'Rate-limited per token; see response headers `X-RateLimit-*`. ' +
      'Patch-version-aware: pass `?patch=` or omit for the current LIVE version.',
    contact: {
      name: 'SC Companion',
      url: 'https://sc-companion.vercel.app',
    },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'https://sc-companion.vercel.app', description: 'Production' },
  ],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'scc_live_<32 chars>',
        description:
          'API token created in the admin UI. Send as `Authorization: Bearer scc_live_...`. ' +
          'Each token has scopes (see below). Tokens are sha256-hashed at rest; the plaintext is shown ONCE at creation.',
      },
    },
    parameters: {
      PatchParam: {
        name: 'patch',
        in: 'query',
        description: 'Patch version (e.g. `4.8.0-LIVE.1825000`). Omit for the current LIVE version.',
        required: false,
        schema: { type: 'string' },
      },
      SourceParam: {
        name: 'source',
        in: 'query',
        description: 'Filter news by source channel.',
        required: false,
        schema: { type: 'string', enum: ['comm-link', 'spectrum', 'youtube', 'patch'] },
      },
    },
    headers: {
      XRateLimitLimit: {
        description: 'Maximum requests per minute for this token.',
        schema: { type: 'integer' },
      },
      XRateLimitRemaining: {
        description: 'Remaining requests in the current 60-second window.',
        schema: { type: 'integer' },
      },
      XRateLimitReset: {
        description: 'Unix epoch (seconds) at which the rate window resets.',
        schema: { type: 'integer' },
      },
      XCache: {
        description: 'Cache hit/miss indicator for cached endpoints.',
        schema: { type: 'string', enum: ['HIT', 'MISS'] },
      },
      XPatchVersion: {
        description: 'Patch version the response is anchored to (if applicable).',
        schema: { type: 'string' },
      },
      RetryAfter: {
        description: 'Seconds to wait before retrying after a 429.',
        schema: { type: 'integer' },
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'unauthorized' },
              message: { type: 'string', example: 'Invalid or revoked token.' },
            },
          },
        },
      },
      NewsItem: {
        type: 'object',
        required: ['source', 'title', 'url', 'published_at'],
        properties: {
          source: { type: 'string', enum: ['comm-link', 'spectrum', 'youtube', 'patch'] },
          title: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          thumbnail: { type: ['string', 'null'], format: 'uri' },
          published_at: { type: 'string', format: 'date-time' },
        },
      },
      NewsResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/NewsItem' } },
          meta: {
            type: 'object',
            properties: {
              count: { type: 'integer' },
              patch_version: { type: ['string', 'null'] },
              cached_at: { type: ['string', 'null'], format: 'date-time' },
            },
          },
        },
      },
      PatchResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            properties: {
              live: { type: ['string', 'null'], example: '4.8.0-LIVE.1825000' },
              ptu: { type: ['string', 'null'] },
              eptu: { type: ['string', 'null'] },
            },
          },
          meta: {
            type: 'object',
            properties: {
              detected_at: {
                type: 'object',
                properties: {
                  live: { type: ['string', 'null'], format: 'date-time' },
                  ptu: { type: ['string', 'null'], format: 'date-time' },
                  eptu: { type: ['string', 'null'], format: 'date-time' },
                },
              },
            },
          },
        },
      },
      EmptyListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: {} },
          meta: {
            type: 'object',
            properties: {
              patch_version: { type: ['string', 'null'] },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/v1/news': {
      get: {
        summary: 'List recent Verse news',
        description: 'Returns up to 50 items from the last 90 days, ordered by `published_at` DESC.',
        tags: ['Read'],
        security: [{ BearerAuth: ['news:read'] }],
        parameters: [{ $ref: '#/components/parameters/SourceParam' }],
        responses: {
          '200': {
            description: 'News list',
            headers: {
              'X-RateLimit-Limit': { $ref: '#/components/headers/XRateLimitLimit' },
              'X-RateLimit-Remaining': { $ref: '#/components/headers/XRateLimitRemaining' },
              'X-RateLimit-Reset': { $ref: '#/components/headers/XRateLimitReset' },
              'X-Cache': { $ref: '#/components/headers/XCache' },
              'X-Patch-Version': { $ref: '#/components/headers/XPatchVersion' },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NewsResponse' } } },
          },
          '401': errorRef('Unauthorized'),
          '403': errorRef('Forbidden (scope)'),
          '429': errorRef('Rate-limited'),
        },
      },
    },
    '/v1/patch': {
      get: {
        summary: 'Current LIVE / PTU / EPTU patch versions',
        tags: ['Read'],
        security: [{ BearerAuth: ['patch:read'] }],
        responses: {
          '200': {
            description: 'Patch versions',
            headers: {
              'X-RateLimit-Limit': { $ref: '#/components/headers/XRateLimitLimit' },
              'X-RateLimit-Remaining': { $ref: '#/components/headers/XRateLimitRemaining' },
              'X-RateLimit-Reset': { $ref: '#/components/headers/XRateLimitReset' },
              'X-Cache': { $ref: '#/components/headers/XCache' },
              'X-Patch-Version': { $ref: '#/components/headers/XPatchVersion' },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PatchResponse' } } },
          },
          '401': errorRef('Unauthorized'),
          '403': errorRef('Forbidden (scope)'),
          '429': errorRef('Rate-limited'),
        },
      },
    },
    '/v1/ships': {
      get: {
        summary: 'Ship roster (stub — data ingestion pending)',
        description: 'Returns an empty `data` array until the ship-data ingestion pipeline lands. ' +
          'See `meta.message` for status.',
        tags: ['Read'],
        security: [{ BearerAuth: ['ships:read'] }],
        parameters: [{ $ref: '#/components/parameters/PatchParam' }],
        responses: {
          '200': {
            description: 'Ship list (currently empty)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmptyListResponse' } } },
          },
          '401': errorRef('Unauthorized'),
          '403': errorRef('Forbidden (scope)'),
          '429': errorRef('Rate-limited'),
        },
      },
    },
    '/v1/components': {
      get: {
        summary: 'Component catalog (stub — data ingestion pending)',
        description: 'Returns an empty `data` array until the component-data ingestion pipeline lands.',
        tags: ['Read'],
        security: [{ BearerAuth: ['components:read'] }],
        parameters: [{ $ref: '#/components/parameters/PatchParam' }],
        responses: {
          '200': {
            description: 'Component list (currently empty)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmptyListResponse' } } },
          },
          '401': errorRef('Unauthorized'),
          '403': errorRef('Forbidden (scope)'),
          '429': errorRef('Rate-limited'),
        },
      },
    },
    '/v1/tokens': {
      get: {
        summary: 'List my API tokens (admin only)',
        description: 'Session-authed endpoint — uses the Supabase session JWT, not a Bearer API token. ' +
          'Caller must have `profiles.role = admin`.',
        tags: ['Admin'],
        responses: {
          '200': {
            description: 'Token list (metadata only — plaintext never returned)',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array' } } } } },
          },
          '401': errorRef('Unauthorized'),
          '403': errorRef('Not an admin'),
        },
      },
      post: {
        summary: 'Create a new API token (admin only)',
        description: 'Returns the plaintext token ONCE in the response body. Persisted as sha256 hash.',
        tags: ['Admin'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'scopes'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 80 },
                  scopes: {
                    type: 'array',
                    items: { type: 'string', enum: ['news:read', 'patch:read', 'ships:read', 'components:read', '*:read', 'admin:tokens'] },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Token created — plaintext shown ONCE.',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { plaintext: { type: 'string' }, token: { type: 'object' } } } } } } },
          },
          '400': errorRef('Invalid input'),
          '401': errorRef('Unauthorized'),
          '403': errorRef('Not an admin'),
          '409': errorRef('Token with this name already exists'),
        },
      },
    },
    '/v1/tokens/{id}': {
      delete: {
        summary: 'Revoke an API token (soft-delete)',
        tags: ['Admin'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Revoked', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '401': errorRef('Unauthorized'),
          '403': errorRef('Not an admin'),
          '404': errorRef('Not found or already revoked'),
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'OpenAPI 3.1 specification (public)',
        tags: ['Meta'],
        security: [],
        responses: {
          '200': { description: 'This document.', content: { 'application/json': {} } },
        },
      },
    },
    '/docs': {
      get: {
        summary: 'Interactive API reference (Scalar UI)',
        tags: ['Meta'],
        security: [],
        responses: {
          '200': { description: 'HTML page rendering Scalar against `/openapi.json`.', content: { 'text/html': {} } },
        },
      },
    },
  },
  tags: [
    { name: 'Read', description: 'Bearer-authenticated read endpoints (`*:read` scopes).' },
    { name: 'Admin', description: 'Session-authenticated token management. Admin role required.' },
    { name: 'Meta', description: 'Public meta endpoints — spec + docs.' },
  ],
  'x-scopes': {
    'news:read': 'Read /v1/news',
    'patch:read': 'Read /v1/patch',
    'ships:read': 'Read /v1/ships*',
    'components:read': 'Read /v1/components*',
    '*:read': 'Shortcut: all read endpoints',
    'admin:tokens': 'Manage API tokens via /v1/tokens (admin role still required)',
  },
};

function errorRef(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
  };
}

export function serve(ctx: Context): Response {
  ctx.responseHeaders.set('content-type', 'application/json; charset=utf-8');
  ctx.responseHeaders.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return new Response(JSON.stringify(SPEC, null, 2), { status: 200, headers: ctx.responseHeaders });
}

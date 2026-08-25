/**
 * OpenAPI 3.1 fragments for the v2 envelope, RFC 7807 errors, and cursor pagination.
 * Consumed by swagger-jsdoc (`apis` includes this file) and by the surface schema test.
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     V2Meta:
 *       type: object
 *       required: [request_id, version]
 *       properties:
 *         request_id:
 *           type: string
 *           examples: [req_7c2a1e]
 *         version:
 *           type: string
 *           enum: [v2]
 *     V2Pagination:
 *       type: object
 *       required: [next_cursor, has_more, limit]
 *       properties:
 *         next_cursor:
 *           type: string
 *           nullable: true
 *           description: Opaque cursor. Pass back unchanged; do not parse.
 *         has_more:
 *           type: boolean
 *         limit:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     V2Success:
 *       type: object
 *       required: [data, meta]
 *       properties:
 *         data: {}
 *         meta:
 *           $ref: '#/components/schemas/V2Meta'
 *         pagination:
 *           $ref: '#/components/schemas/V2Pagination'
 *     V2Problem:
 *       type: object
 *       required: [type, title, status, detail, instance, request_id]
 *       properties:
 *         type:
 *           type: string
 *           format: uri
 *           examples: [https://syncro.app/problems/validation]
 *         title:
 *           type: string
 *         status:
 *           type: integer
 *         detail:
 *           type: string
 *         instance:
 *           type: string
 *           examples: [/api/v2/subscriptions]
 *         request_id:
 *           type: string
 *         errors:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               field: { type: string }
 *               message: { type: string }
 */

export const V2_OPENAPI_TAG = 'v2';

/**
 * Shared contract for offline sync mutations.
 *
 * Both the client mutation queue and the /api/sync/offline route validate
 * against these schemas, so queued mutations can be validated, retried, and
 * resolved deterministically. The top-level objects are strict: adding a new
 * offline field requires an explicit schema addition here.
 */

import { z } from "zod"

const createMutationSchema = z
  .object({
    type: z.literal("create"),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()

const updateMutationSchema = z
  .object({
    type: z.literal("update"),
    payload: z
      .object({
        id: z.string().min(1, "id is required"),
        version: z.number().int().nonnegative().optional(),
      })
      .catchall(z.unknown()),
  })
  .strict()

const deleteMutationSchema = z
  .object({
    type: z.literal("delete"),
    payload: z.object({ id: z.string().min(1, "id is required") }),
  })
  .strict()

export const offlineMutationSchema = z.discriminatedUnion("type", [
  createMutationSchema,
  updateMutationSchema,
  deleteMutationSchema,
])

export type OfflineMutation = z.infer<typeof offlineMutationSchema>

/**
 * Conflict contract consumed by the client mutation queue.
 *
 * When a queued update loses to a newer server version, the route responds
 * with HTTP 409 and the standard error envelope; `error.details` carries this
 * shape. The client should replace its local copy with `serverData` (or apply
 * `resolvedData` when a merge was possible) and drop or re-queue the mutation.
 */
export type SyncConflictDetails = {
  conflict: true
  serverVersion: number
  clientVersion: number
  serverData: Record<string, unknown>
  resolvedData: Record<string, unknown>
}

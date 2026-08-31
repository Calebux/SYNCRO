import { z } from 'zod';

export const createTagSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must not exceed 50 characters'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex colour')
    .default('#6366f1'),
});

export const notesSchema = z.object({
  notes: z.string().max(5000, 'Notes must not exceed 5000 characters'),
});

export const addTagSchema = z.object({
  tag_id: z.string().uuid('tag_id must be a valid UUID'),
});

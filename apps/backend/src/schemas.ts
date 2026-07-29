import { z } from 'zod';
import { QueueStartMode } from './domain/constants';

export const staffPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/\S/, 'Password must include a non-space character');

export const createQueueSchema = z
  .strictObject({
    businessName: z.string().trim().min(1).max(100),
    password: staffPasswordSchema,
    description: z.string().trim().max(500).nullable().optional(),
    startMode: z.enum([QueueStartMode.Now, QueueStartMode.Scheduled]).default(QueueStartMode.Now),
    startLocal: z.string().trim().optional().or(z.literal('')),
    endDate: z.string().trim().optional().or(z.literal('')),
  })
  .superRefine((value, context) => {
    if (value.startMode === QueueStartMode.Scheduled && !value.startLocal) {
      context.addIssue({
        code: 'custom',
        message: 'Scheduled start is required',
        path: ['startLocal'],
      });
    }
  });

export const editEventSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    password: staffPasswordSchema.optional(),
    startLocal: z.string().trim().min(1).optional(),
    endDate: z.string().trim().optional(),
  })
  .refine(value => Object.values(value).some(item => item !== undefined), {
    message: 'At least one field is required',
  });

export const unlockSchema = z.strictObject({ credential: z.string().min(3).max(254) });
export const vendorAdminLoginSchema = z.strictObject({ key: z.string().min(1).max(512) });
export const joinSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,25}$/)
    .optional()
    .or(z.literal('')),
  message: z.string().trim().max(200).optional().or(z.literal('')),
});
export const archiveEventSchema = z.strictObject({ confirmationName: z.string() });
export const customerParamsSchema = z.strictObject({
  queueId: z.string().min(1),
  customerId: z.coerce.number().int().positive(),
});

export type CreateQueueDto = z.infer<typeof createQueueSchema>;
export type EditEventDto = z.infer<typeof editEventSchema>;
export type UnlockDto = z.infer<typeof unlockSchema>;
export type VendorAdminLoginDto = z.infer<typeof vendorAdminLoginSchema>;
export type JoinDto = z.infer<typeof joinSchema>;
export type ArchiveEventDto = z.infer<typeof archiveEventSchema>;

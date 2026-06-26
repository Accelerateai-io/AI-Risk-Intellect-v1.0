import { z } from "zod";

export const enqueueUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required.")
    .max(2048, "URL is too long.")
    .refine(
      (value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Enter a valid http or https URL." },
    ),
  suggestedName: z
    .string()
    .trim()
    .max(256, "Suggested name is too long.")
    .optional(),
});

export type EnqueueUrlInput = z.infer<typeof enqueueUrlSchema>;

/** Jobs page: queue article ingest (no RSS feed fields). */
export const enqueueJobUrlSchema = enqueueUrlSchema.pick({ url: true });

export type EnqueueJobUrlInput = z.infer<typeof enqueueJobUrlSchema>;

export const setLlmModelSchema = z.object({
  modelId: z.string().trim().min(1, "Model is required.").max(256),
});

export type SetLlmModelInput = z.infer<typeof setLlmModelSchema>;

export const invokeLlmModelSchema = z.object({
  modelId: z.string().trim().min(1, "Model is required.").max(256),
  prompt: z
    .string()
    .trim()
    .min(1, "Prompt is required.")
    .max(16_000, "Prompt is too long."),
  maxTokens: z.coerce.number().int().min(16).max(4096).optional(),
  temperature: z.coerce.number().min(0).max(1).optional(),
});

export type InvokeLlmModelInput = z.infer<typeof invokeLlmModelSchema>;

export const ingestLinkIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type IngestLinkIdParams = z.infer<typeof ingestLinkIdSchema>;

export const updateIngestLinkSchema = enqueueUrlSchema;

export type UpdateIngestLinkInput = z.infer<typeof updateIngestLinkSchema>;

export const startDiscoverySchema = z.object({
  ingestLinkIds: z
    .array(z.coerce.number().int().positive())
    .min(1, "Select at least one feed to run.")
    .optional(),
  ingestLinkItemIds: z
    .array(z.coerce.number().int().positive())
    .min(1, "Select at least one extracted URL to run.")
    .optional(),
}).refine((value) => {
  return (
    (value.ingestLinkIds?.length ?? 0) > 0 ||
    (value.ingestLinkItemIds?.length ?? 0) > 0
  );
}, {
  message: "Select at least one feed or extracted URL to run.",
});

export type StartDiscoveryInput = z.infer<typeof startDiscoverySchema>;

export const startReportsRunSchema = z
  .object({
    uploadIds: z
      .array(z.coerce.number().int().positive())
      .min(1, "Select at least one upload to run.")
      .optional(),
    reportIds: z
      .array(z.coerce.number().int().positive())
      .min(1, "Select at least one report URL to run.")
      .optional(),
  })
  .refine(
    (value) =>
      (value.uploadIds?.length ?? 0) > 0 || (value.reportIds?.length ?? 0) > 0,
    {
      message: "Select at least one upload or report URL to run.",
    },
  );

export type StartReportsRunInput = z.infer<typeof startReportsRunSchema>;

const cronDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date (YYYY-MM-DD).");

const cronTimeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/, "Use a valid time (HH:mm).");

const repeatUnitSchema = z.enum(["day", "week", "month", "year"]);

const cronTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Use a valid IANA timezone." },
  );

export const saveCronJobSchema = z
  .object({
    startDate: cronDateSchema,
    startTime: cronTimeSchema,
    timezone: cronTimezoneSchema,
    repeat: z.boolean(),
    repeatInterval: z.coerce.number().int().positive().max(365),
    repeatUnit: repeatUnitSchema,
    repeatDays: z.array(z.number().int().min(0).max(6)),
    ingestLinkIds: z
      .array(z.coerce.number().int().positive())
      .min(1, "Select at least one RSS feed."),
  })
  .refine(
    (value) =>
      !value.repeat ||
      value.repeatUnit !== "week" ||
      value.repeatDays.length > 0,
    {
      message: "Select at least one day for a weekly repeat.",
      path: ["repeatDays"],
    },
  );

export type SaveCronJobInput = z.infer<typeof saveCronJobSchema>;

export const cronJobIdSchema = z.object({
  id: z.enum(["rss-discovery"]),
});

export type CronJobIdParams = z.infer<typeof cronJobIdSchema>;

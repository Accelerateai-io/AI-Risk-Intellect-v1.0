import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { HttpError } from "../../utils/httpError.js";

/** Reset a terminal job to pending so the worker can process it again. */
export async function retryJob(jobId: number): Promise<{
  id: number;
  status: string;
}> {
  const [job] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw HttpError.notFound("Job not found.");
  }

  const terminal = new Set(["done", "skipped", "error", "failed", "completed"]);
  if (!terminal.has(job.status)) {
    throw HttpError.conflict(
      `Job is already ${job.status}. Wait for it to finish or stop the worker.`,
    );
  }

  const [updated] = await db
    .update(jobs)
    .set({
      status: "pending",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId))
    .returning({ id: jobs.id, status: jobs.status });

  if (!updated) {
    throw HttpError.internal("Failed to requeue job.");
  }

  return updated;
}

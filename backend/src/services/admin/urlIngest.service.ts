import {
  archiveIngestLink,
  createIngestLink,
  listActiveIngestLinks,
  updateIngestLink,
} from "../../services/admin/ingestLinks.service.js";

export { createIngestLink as enqueueUrl };

export type EnqueueUrlResult = Awaited<ReturnType<typeof createIngestLink>>;

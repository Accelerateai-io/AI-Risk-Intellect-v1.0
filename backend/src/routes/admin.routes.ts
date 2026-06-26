import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { enqueueUrlHandler } from "../controllers/admin/admin.controller.js";
import { enqueueJobUrlHandler } from "../controllers/admin/manualJobEnqueue.controller.js";
import {
  archiveIngestLinkHandler,
  exportIngestLinkItemsHandler,
  extractIngestLinkHandler,
  listIngestLinkItemsHandler,
  listIngestLinksHandler,
  restoreIngestLinkHandler,
  updateIngestLinkHandler,
} from "../controllers/admin/ingestLinks.controller.js";
import { listDiscoveryLogsHandler } from "../controllers/admin/discoveryLogs.controller.js";
import {
  getLlmModelHandler,
  getServicesStatusHandler,
  setLlmModelHandler,
  startDiscoveryHandler,
  startWorkerHandler,
  stopDiscoveryHandler,
  stopWorkerHandler,
  testLlmModelHandler,
  invokeLlmModelHandler,
} from "../controllers/admin/services.controller.js";
import {
  enqueueJobUrlSchema,
  enqueueUrlSchema,
  ingestLinkIdSchema,
  setLlmModelSchema,
  invokeLlmModelSchema,
  startDiscoverySchema,
  updateIngestLinkSchema,
  startReportsRunSchema,
  saveCronJobSchema,
  cronJobIdSchema,
} from "../validators/admin.validators.js";
import { etlUploadMiddleware } from "../middleware/upload.middleware.js";
import {
  extractReportUploadHandler,
  reuploadReportUploadHandler,
  uploadReportsEtlHandler,
} from "../controllers/admin/etlUpload.controller.js";
import {
  archiveReportUploadHandler,
  exportReportUploadItemsHandler,
  listReportUploadItemsHandler,
  listReportUploadsHandler,
} from "../controllers/admin/etlReportUploads.controller.js";
import { startReportsRunHandler } from "../controllers/admin/etlReportsRun.controller.js";
import { listReportsLogsHandler } from "../controllers/admin/reportsLogs.controller.js";
import {
  listCronJobsHandler,
  saveCronJobHandler,
  stopCronJobHandler,
} from "../controllers/admin/cronJobs.controller.js";
import { listCronJobLogsHandler } from "../controllers/admin/cronLogs.controller.js";
import { listApplicationLogsHandler } from "../controllers/admin/applicationLogs.controller.js";


export const adminRouter: Router = Router();

adminRouter.get(
  "/services/status",
  requireAuth,
  asyncHandler(getServicesStatusHandler),
);

adminRouter.get(
  "/cron-jobs",
  requireAuth,
  asyncHandler(listCronJobsHandler),
);

adminRouter.put(
  "/cron-jobs/:id",
  requireAuth,
  validate(cronJobIdSchema, "params"),
  validate(saveCronJobSchema),
  asyncHandler(saveCronJobHandler),
);

adminRouter.post(
  "/cron-jobs/:id/stop",
  requireAuth,
  validate(cronJobIdSchema, "params"),
  asyncHandler(stopCronJobHandler),
);

adminRouter.get(
  "/cron-jobs/logs",
  requireAuth,
  asyncHandler(listCronJobLogsHandler),
);

adminRouter.get(
  "/application-logs",
  requireAuth,
  asyncHandler(listApplicationLogsHandler),
);

adminRouter.post(
  "/services/discovery/start",
  requireAuth,
  validate(startDiscoverySchema),
  asyncHandler(startDiscoveryHandler),
);

adminRouter.post(
  "/services/discovery/stop",
  requireAuth,
  asyncHandler(stopDiscoveryHandler),
);

adminRouter.post(
  "/services/worker/start",
  requireAuth,
  asyncHandler(startWorkerHandler),
);

adminRouter.post(
  "/services/worker/stop",
  requireAuth,
  asyncHandler(stopWorkerHandler),
);

adminRouter.get(
  "/services/llm-model",
  requireAuth,
  asyncHandler(getLlmModelHandler),
);

adminRouter.put(
  "/services/llm-model",
  requireAuth,
  validate(setLlmModelSchema),
  asyncHandler(setLlmModelHandler),
);

adminRouter.post(
  "/services/llm-model/test",
  requireAuth,
  validate(setLlmModelSchema),
  asyncHandler(testLlmModelHandler),
);

adminRouter.post(
  "/services/llm-model/invoke",
  requireAuth,
  validate(invokeLlmModelSchema),
  asyncHandler(invokeLlmModelHandler),
);

adminRouter.get(
  "/discovery-logs",
  requireAuth,
  asyncHandler(listDiscoveryLogsHandler),
);

adminRouter.get(
  "/ingest-links",
  requireAuth,
  asyncHandler(listIngestLinksHandler),
);

adminRouter.patch(
  "/ingest-links/:id",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  validate(updateIngestLinkSchema),
  asyncHandler(updateIngestLinkHandler),
);

adminRouter.post(
  "/ingest-links/:id/archive",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(archiveIngestLinkHandler),
);

adminRouter.post(
  "/ingest-links/:id/restore",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(restoreIngestLinkHandler),
);

adminRouter.get(
  "/ingest-links/:id/items",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(listIngestLinkItemsHandler),
);

adminRouter.get(
  "/ingest-links/:id/export",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(exportIngestLinkItemsHandler),
);

adminRouter.post(
  "/ingest-links/:id/extract",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(extractIngestLinkHandler),
);

adminRouter.post(
  "/enqueue",
  requireAuth,
  validate(enqueueUrlSchema),
  asyncHandler(enqueueUrlHandler),
);

adminRouter.post(
  "/jobs/enqueue",
  requireAuth,
  validate(enqueueJobUrlSchema),
  asyncHandler(enqueueJobUrlHandler),
);

adminRouter.post(
  "/etl/reports/upload",
  requireAuth,
  etlUploadMiddleware,
  asyncHandler(uploadReportsEtlHandler),
);


adminRouter.get(
  "/etl/reports/uploads",
  requireAuth,
  asyncHandler(listReportUploadsHandler),
);

adminRouter.get(
  "/etl/reports/uploads/:id/items",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(listReportUploadItemsHandler),
);

adminRouter.get(
  "/etl/reports/uploads/:id/export",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(exportReportUploadItemsHandler),
);

adminRouter.post(
  "/etl/reports/uploads/:id/archive",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(archiveReportUploadHandler),
);

adminRouter.post(
  "/etl/reports/uploads/:id/extract",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  asyncHandler(extractReportUploadHandler),
);

adminRouter.post(
  "/etl/reports/uploads/:id/reupload",
  requireAuth,
  validate(ingestLinkIdSchema, "params"),
  etlUploadMiddleware,
  asyncHandler(reuploadReportUploadHandler),
);

adminRouter.post(
  "/etl/reports/start",
  requireAuth,
  validate(startReportsRunSchema),
  asyncHandler(startReportsRunHandler),
);

adminRouter.get(
  "/etl/reports/logs",
  requireAuth,
  asyncHandler(listReportsLogsHandler),
);

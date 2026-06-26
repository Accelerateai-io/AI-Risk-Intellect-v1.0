import express from "express";

import { analyzeUrl } from "../controllers/analyze.controller.js";

import { validate } from "../middlewares/validate.middleware.js";

import { analyzeSchema } from "../validators/analyze.validator.js";

const router = express.Router();

router.post(
  "/analyze-url",
  validate(analyzeSchema),
  analyzeUrl
);

export default router;
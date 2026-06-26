import rateLimit from "express-rate-limit";
import config from "../config/rateLimit.config.js";

const limiter = rateLimit({
  windowMs: config.windowMs,
  max: config.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests",
  },
});

export default limiter;
export default {
  windowMs: Number(process.env.WINDOW_MS) || 60_000,
  max: Number(process.env.MAX_REQUESTS) || 100,
};

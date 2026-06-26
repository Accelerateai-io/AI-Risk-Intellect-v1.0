import type { NextFunction, Request, Response } from "express";

function isLocalAddress(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.endsWith("127.0.0.1")
  );
}

/** Allow only same-host callers (discovery/worker child processes). */
export function requireLocalCaller(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const remote = req.socket.remoteAddress ?? "";
  if (!isLocalAddress(remote)) {
    res.status(403).json({
      ok: false,
      error: { message: "Forbidden" },
    });
    return;
  }
  next();
}

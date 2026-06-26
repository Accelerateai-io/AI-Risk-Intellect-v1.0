import type { Request } from "express";
import { UAParser } from "ua-parser-js";

export type RequestClientInfo = {
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  device: string | null;
  deviceType: "mobile" | "tablet" | "desktop" | "unknown";
};

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getClientIp(req: Request): string | null {
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  const realIp = headerValue(req.headers["x-real-ip"]);
  if (realIp) {
    return realIp;
  }

  const socketIp = req.socket.remoteAddress?.trim();
  if (socketIp) {
    return socketIp;
  }

  return req.ip?.trim() || null;
}

function resolveDeviceType(
  type: string | undefined,
): RequestClientInfo["deviceType"] {
  if (type === "mobile" || type === "tablet" || type === "desktop") {
    return type;
  }
  return "unknown";
}

export function getRequestClientInfo(req: Request): RequestClientInfo {
  const userAgent = headerValue(req.headers["user-agent"]) ?? null;
  const parsed = userAgent ? new UAParser(userAgent).getResult() : null;

  const browserName = parsed?.browser.name?.trim();
  const browserVersion = parsed?.browser.version?.trim();
  const osName = parsed?.os.name?.trim();
  const osVersion = parsed?.os.version?.trim();
  const deviceVendor = parsed?.device.vendor?.trim();
  const deviceModel = parsed?.device.model?.trim();

  const deviceLabel = [deviceVendor, deviceModel].filter(Boolean).join(" ") || null;

  return {
    ipAddress: getClientIp(req),
    userAgent,
    browser: browserName ?? null,
    browserVersion: browserVersion ?? null,
    os: osName ?? null,
    osVersion: osVersion ?? null,
    device: deviceLabel,
    deviceType: resolveDeviceType(parsed?.device.type),
  };
}

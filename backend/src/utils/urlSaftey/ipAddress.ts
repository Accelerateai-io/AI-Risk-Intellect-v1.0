import { isIP } from "node:net";

/** Mirrors Python `ipaddress` checks used in fetch_utils.validate_url. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map((n) => Number(n));
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}

export function isLoopbackIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ip.startsWith("127.");
  if (version === 6) return ip === "::1" || ip.toLowerCase() === "0:0:0:0:0:0:0:1";
  return false;
}

export function isLinkLocalIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map((n) => Number(n));
    return a === 169 && b === 254;
  }
  if (version === 6) return ip.toLowerCase().startsWith("fe80:");
  return false;
}

export function isReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b, c, d] = ip.split(".").map((n) => Number(n));
    if (a === 0) return true;
    if (a >= 224 && a <= 239) return true;
    if (a >= 240) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && b >= 18 && b <= 19) return true;
    if (a === 127) return false;
    if (d === 255) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::") return true;
    if (lower.startsWith("ff")) return true;
    if (lower.startsWith("2001:db8:")) return true;
  }
  return false;
}

export function isBlockedResolvedIp(ip: string): boolean {
  return (
    isPrivateIp(ip) ||
    isReservedIp(ip) ||
    isLoopbackIp(ip) ||
    isLinkLocalIp(ip)
  );
}

import dns from "dns/promises";
import net from "net";

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
];

export const validatePublicUrl = async (hostname) => {
  const { address } = await dns.lookup(hostname);

  if (
    PRIVATE_IP_RANGES.some((range) => range.test(address)) ||
    net.isPrivateIP?.(address)
  ) {
    throw new Error("Private/internal IPs are not allowed");
  }

  return true;
};
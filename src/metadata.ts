import { HttpError } from "./http";

export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "URL 格式不合法。");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpError(400, "只允许使用 http 或 https 链接。");
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) throw new HttpError(400, "URL 缺少域名。");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new HttpError(400, "不允许抓取本地或内部网络地址。");
  }
  if (isPrivateIpLiteral(hostname)) {
    throw new HttpError(400, "不允许抓取私网或回环地址。");
  }

  return parsed;
}

function isPrivateIpLiteral(hostname: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const [first, second] = hostname.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first === 0
    );
  }

  if (hostname.includes(":")) {
    const normalized = hostname.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }

  return false;
}

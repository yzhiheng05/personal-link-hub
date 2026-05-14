import { buildSessionCookie, clearSessionCookie, createSessionToken, readSession, sha256Hex } from "./auth";
import {
  createLink,
  createTag,
  ensureShortCode,
  getLinkById,
  getLinkByShortCode,
  listLinks,
  listTags,
  normalizeLinkInput,
  recordVisit,
  updateLink,
} from "./db";
import { HttpError, errorResponse, json, readJson, redirect } from "./http";
import { assertPublicHttpUrl } from "./metadata";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  SESSION_SECRET: string;
}

const PUBLIC_API_ROUTES = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/me"]);
const PROTECTED_PAGES = new Set(["/", "/index", "/new", "/link", "/taxonomy"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      validateConfig(env);
      const url = new URL(request.url);
      const pathname = url.pathname;
      const useSecureCookie = url.protocol === "https:";

      if (pathname === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env, useSecureCookie);
      }

      if (pathname === "/api/auth/logout" && request.method === "POST") {
        return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(useSecureCookie) } });
      }

      if (pathname === "/api/auth/me" && request.method === "GET") {
        const session = await readSession(request, env.SESSION_SECRET);
        return json({ authenticated: Boolean(session), username: session?.username ?? null });
      }

      if (pathname.startsWith("/s/") && request.method === "GET") {
        return await handleShortLink(pathname, env);
      }

      const session = await readSession(request, env.SESSION_SECRET);

      if (pathname.startsWith("/api/") && !PUBLIC_API_ROUTES.has(pathname)) {
        if (!session) return errorResponse(401, "需要先登录。");
        return await handleApi(request, env, pathname, url);
      }

      if (PROTECTED_PAGES.has(pathname) && !session) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("redirect", pathname);
        return redirect(loginUrl.toString(), 302);
      }

      return await serveAsset(request, env, pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message, error.details);
      }
      return errorResponse(500, error instanceof Error ? error.message : "Unexpected server error.");
    }
  },
};

async function handleLogin(request: Request, env: Env, useSecureCookie: boolean): Promise<Response> {
  const body = await readJson<{ username?: string; password?: string }>(request);
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!username || !password) {
    throw new HttpError(400, "用户名和密码不能为空。");
  }
  if (username !== env.ADMIN_USERNAME) {
    throw new HttpError(401, "用户名或密码错误。");
  }

  const passwordHash = await sha256Hex(password);
  if (passwordHash !== env.ADMIN_PASSWORD_HASH) {
    throw new HttpError(401, "用户名或密码错误。");
  }

  const token = await createSessionToken(username, env.SESSION_SECRET);
  return json({ ok: true, username }, { headers: { "Set-Cookie": buildSessionCookie(token, useSecureCookie) } });
}

async function handleApi(request: Request, env: Env, pathname: string, url: URL): Promise<Response> {
  if (pathname === "/api/links" && request.method === "GET") {
    const q = url.searchParams.get("q");
    const statusRaw = url.searchParams.get("status");
    const status = statusRaw === "active" || statusRaw === "archived" ? statusRaw : null;
    const tagIds = parseTagIds(url.searchParams.get("tagIds"));
    return json({ items: await listLinks(env, { q, status, tagIds }) });
  }

  if (pathname === "/api/links" && request.method === "POST") {
    const payload = normalizeLinkInput(await readJson<Record<string, unknown>>(request));
    assertValidLinkPayload(payload);
    assertPublicHttpUrl(payload.url);
    const result = await createLink(env, payload);
    return json(
      {
        item: result.link,
        duplicateWarning: result.duplicateCount > 0 ? `该 URL 已存在 ${result.duplicateCount} 条记录。` : null,
      },
      { status: 201 },
    );
  }

  const linkMatch = pathname.match(/^\/api\/links\/(\d+)$/);
  if (linkMatch?.[1] && request.method === "GET") {
    const link = await getLinkById(env, Number(linkMatch[1]));
    return link ? json({ item: link }) : errorResponse(404, "链接不存在。");
  }

  if (linkMatch?.[1] && request.method === "PATCH") {
    const payload = normalizeLinkInput(await readJson<Record<string, unknown>>(request));
    assertValidLinkPayload(payload);
    assertPublicHttpUrl(payload.url);
    const updated = await updateLink(env, Number(linkMatch[1]), payload);
    return updated ? json({ item: updated }) : errorResponse(404, "链接不存在。");
  }

  const shortLinkMatch = pathname.match(/^\/api\/links\/(\d+)\/short-link$/);
  if (shortLinkMatch?.[1] && request.method === "POST") {
    const shortCode = await ensureShortCode(env, Number(shortLinkMatch[1]));
    return json({ shortCode, shortUrl: `${url.origin}/s/${shortCode}` });
  }

  if (pathname === "/api/tags" && request.method === "GET") {
    return json({ items: await listTags(env) });
  }

  if (pathname === "/api/tags" && request.method === "POST") {
    const body = await readJson<{ name?: string }>(request);
    const name = String(body.name ?? "").trim();
    if (!name) throw new HttpError(400, "标签名称不能为空。");
    await createTag(env, name);
    return json({ ok: true }, { status: 201 });
  }

  if (pathname.startsWith("/api/categories")) {
    return errorResponse(410, "第一版已移除分类，请改用标签。", { replacement: "/api/tags" });
  }

  return errorResponse(404, "API route not found.");
}

async function handleShortLink(pathname: string, env: Env): Promise<Response> {
  const shortCode = pathname.slice(3).trim();
  if (!shortCode) return errorResponse(404, "短链不存在。");

  const link = await getLinkByShortCode(env, shortCode);
  if (!link) return errorResponse(404, "短链不存在。");

  await recordVisit(env, link.id);
  return redirect(link.url, 302);
}

async function serveAsset(request: Request, env: Env, pathname: string): Promise<Response> {
  if (pathname === "/") {
    const rootUrl = new URL(request.url);
    rootUrl.pathname = "/index";
    return env.ASSETS.fetch(new Request(rootUrl.toString(), request));
  }
  return env.ASSETS.fetch(request);
}

function validateConfig(env: Env): void {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    throw new Error("Missing ADMIN_USERNAME, ADMIN_PASSWORD_HASH, or SESSION_SECRET environment variables.");
  }
}

function assertValidLinkPayload(payload: ReturnType<typeof normalizeLinkInput>): void {
  if (!payload.url) {
    throw new HttpError(400, "URL 不能为空。");
  }
}

function parseTagIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
}

import { HttpError } from "./http";

interface Env {
  DB: D1Database;
}

export interface LinkRecord {
  id: number;
  url: string;
  short_code: string | null;
  title: string | null;
  site_name: string | null;
  favicon_url: string | null;
  cover_image_url: string | null;
  summary: string | null;
  note: string | null;
  category_id: number | null;
  category_name: string | null;
  status: "active" | "archived";
  metadata_status: "complete" | "partial";
  created_at: string;
  updated_at: string;
  last_visited_at: string | null;
  visit_count: number;
  tags: Array<{ id: number; name: string }>;
}

interface LinkFilters {
  q: string | null;
  tagIds: number[];
  status: "active" | "archived" | null;
}

interface LinkInput {
  url: string;
  title: string | null;
  siteName: string | null;
  faviconUrl: string | null;
  coverImageUrl: string | null;
  summary: string | null;
  note: string | null;
  status: "active" | "archived";
  metadataStatus: "complete" | "partial";
  tagIds: number[];
}

export async function listLinks(env: Env, filters: LinkFilters): Promise<LinkRecord[]> {
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];

  if (filters.q) {
    conditions.push("(l.title LIKE ? OR l.url LIKE ? OR COALESCE(l.note, '') LIKE ?)");
    const search = `%${filters.q}%`;
    bindings.push(search, search, search);
  }
  if (filters.status) {
    conditions.push("l.status = ?");
    bindings.push(filters.status);
  }
  if (filters.tagIds.length > 0) {
    const placeholders = filters.tagIds.map(() => "?").join(", ");
    conditions.push(`EXISTS (SELECT 1 FROM link_tags lt_filter WHERE lt_filter.link_id = l.id AND lt_filter.tag_id IN (${placeholders}))`);
    bindings.push(...filters.tagIds);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `
    SELECT
      l.id,
      l.url,
      l.short_code,
      l.title,
      l.site_name,
      l.favicon_url,
      l.cover_image_url,
      l.summary,
      l.note,
      l.category_id,
      c.name AS category_name,
      l.status,
      l.metadata_status,
      l.created_at,
      l.updated_at,
      l.last_visited_at,
      l.visit_count
    FROM links l
    LEFT JOIN categories c ON c.id = l.category_id
    ${whereClause}
    ORDER BY l.updated_at DESC, l.id DESC
  `;

  const { results } = await env.DB.prepare(query).bind(...bindings).all<Record<string, unknown>>();
  return Promise.all((results ?? []).map((row) => hydrateLink(env, row)));
}

export async function getLinkById(env: Env, id: number): Promise<LinkRecord | null> {
  const row = await env.DB.prepare(
    `SELECT l.*, c.name AS category_name FROM links l LEFT JOIN categories c ON c.id = l.category_id WHERE l.id = ?`,
  ).bind(id).first<Record<string, unknown>>();

  return row ? hydrateLink(env, row) : null;
}

export async function createLink(env: Env, input: LinkInput): Promise<{ link: LinkRecord; duplicateCount: number }> {
  const duplicate = await env.DB.prepare("SELECT COUNT(*) AS count FROM links WHERE url = ?").bind(input.url).first<{ count: number | string }>();
  const insertResult = await env.DB.prepare(
    `
      INSERT INTO links (
        url, title, site_name, favicon_url, cover_image_url, summary, note,
        category_id, status, metadata_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
  ).bind(
    input.url,
    input.title,
    input.siteName,
    input.faviconUrl,
    input.coverImageUrl,
    input.summary,
    input.note,
    input.status,
    input.metadataStatus,
  ).run();

  const linkId = Number(insertResult.meta.last_row_id);
  await replaceLinkTags(env, linkId, input.tagIds);
  const link = await getLinkById(env, linkId);
  if (!link) throw new Error("Failed to load created link.");

  return { link, duplicateCount: Number(duplicate?.count ?? 0) };
}

export async function updateLink(env: Env, id: number, input: LinkInput): Promise<LinkRecord | null> {
  await env.DB.prepare(
    `
      UPDATE links
      SET url = ?, title = ?, site_name = ?, favicon_url = ?, cover_image_url = ?, summary = ?,
          note = ?, category_id = NULL, status = ?, metadata_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
  ).bind(
    input.url,
    input.title,
    input.siteName,
    input.faviconUrl,
    input.coverImageUrl,
    input.summary,
    input.note,
    input.status,
    input.metadataStatus,
    id,
  ).run();

  await replaceLinkTags(env, id, input.tagIds);
  return getLinkById(env, id);
}

export async function ensureShortCode(env: Env, id: number): Promise<string> {
  const existing = await env.DB.prepare("SELECT short_code FROM links WHERE id = ?").bind(id).first<{ short_code: string | null }>();
  if (!existing) throw new HttpError(404, "链接不存在。");
  if (existing.short_code) return existing.short_code;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const shortCode = generateShortCode();
    try {
      const result = await env.DB.prepare("UPDATE links SET short_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND short_code IS NULL")
        .bind(shortCode, id)
        .run();
      if (Number(result.meta.changes ?? 0) > 0) return shortCode;
    } catch {
      continue;
    }

    const reloaded = await env.DB.prepare("SELECT short_code FROM links WHERE id = ?").bind(id).first<{ short_code: string | null }>();
    if (reloaded?.short_code) return reloaded.short_code;
  }

  throw new HttpError(500, "生成短链失败，请重试。");
}

export async function getLinkByShortCode(env: Env, shortCode: string): Promise<LinkRecord | null> {
  const row = await env.DB.prepare(
    `SELECT l.*, c.name AS category_name FROM links l LEFT JOIN categories c ON c.id = l.category_id WHERE l.short_code = ?`,
  ).bind(shortCode).first<Record<string, unknown>>();

  return row ? hydrateLink(env, row) : null;
}

export async function recordVisit(env: Env, linkId: number): Promise<void> {
  await env.DB.prepare("UPDATE links SET visit_count = visit_count + 1, last_visited_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(linkId)
    .run();
}

export async function listTags(env: Env): Promise<Array<{ id: number; name: string }>> {
  const { results } = await env.DB.prepare("SELECT id, name FROM tags ORDER BY name ASC").all<{ id: number; name: string }>();
  return (results ?? []).map((row) => ({ id: Number(row.id), name: String(row.name) }));
}

export async function createTag(env: Env, name: string): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO tags (name) VALUES (?)").bind(name).run();
  } catch (error) {
    throw mapUniqueNameError(error, "标签已存在。");
  }
}

export function normalizeLinkInput(payload: Partial<LinkInput & { tagIds: Array<number | string> }>): LinkInput {
  return {
    url: String(payload.url ?? "").trim(),
    title: toNullableString(payload.title),
    siteName: toNullableString(payload.siteName),
    faviconUrl: toNullableString(payload.faviconUrl),
    coverImageUrl: toNullableString(payload.coverImageUrl),
    summary: toNullableString(payload.summary),
    note: toNullableString(payload.note),
    status: payload.status === "archived" ? "archived" : "active",
    metadataStatus: payload.metadataStatus === "partial" ? "partial" : inferMetadataStatus(payload),
    tagIds: Array.isArray(payload.tagIds)
      ? payload.tagIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [],
  };
}

async function hydrateLink(env: Env, row: Record<string, unknown>): Promise<LinkRecord> {
  return {
    id: Number(row.id),
    url: String(row.url),
    short_code: nullable(row.short_code),
    title: nullable(row.title),
    site_name: nullable(row.site_name),
    favicon_url: nullable(row.favicon_url),
    cover_image_url: nullable(row.cover_image_url),
    summary: nullable(row.summary),
    note: nullable(row.note),
    category_id: row.category_id == null ? null : Number(row.category_id),
    category_name: nullable(row.category_name),
    status: row.status === "archived" ? "archived" : "active",
    metadata_status: row.metadata_status === "partial" ? "partial" : "complete",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_visited_at: nullable(row.last_visited_at),
    visit_count: Number(row.visit_count ?? 0),
    tags: await listTagsForLink(env, Number(row.id)),
  };
}

async function listTagsForLink(env: Env, linkId: number): Promise<Array<{ id: number; name: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name FROM tags t INNER JOIN link_tags lt ON lt.tag_id = t.id WHERE lt.link_id = ? ORDER BY t.name ASC`,
  ).bind(linkId).all<{ id: number; name: string }>();
  return (results ?? []).map((row) => ({ id: Number(row.id), name: String(row.name) }));
}

async function replaceLinkTags(env: Env, linkId: number, tagIds: number[]): Promise<void> {
  await env.DB.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId).run();
  for (const tagId of tagIds) {
    await env.DB.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?)").bind(linkId, tagId).run();
  }
}

function generateShortCode(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function inferMetadataStatus(payload: Partial<LinkInput>): "complete" | "partial" {
  return payload.title && payload.summary ? "complete" : "partial";
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function mapUniqueNameError(error: unknown, fallbackMessage: string): HttpError {
  if (error instanceof Error && /unique/i.test(error.message)) {
    return new HttpError(409, fallbackMessage);
  }
  return new HttpError(500, "数据库写入失败。", error instanceof Error ? error.message : null);
}

import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const smokePassword = process.env.SMOKE_PASSWORD ?? "admin123";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Users/omen/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe",
});
const page = await browser.newPage();
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    const text = msg.text();
    if (!text.includes("Failed to fetch")) {
      errors.push(`console:${text}`);
    }
  }
});
page.on("pageerror", (err) => {
  errors.push(`pageerror:${err.message}`);
});

const unique = Date.now();
const tagName = `smoke-${unique}`;
const secondTag = `auto-${unique}`;
const noteValue = `联调备注-${unique}`;
const summaryValue = `收藏摘要-${unique}`;
const coverValue = "https://example.com/example.png";

async function addTagToken(rootSelector, value) {
  const input = page.locator(`${rootSelector} .tag-editor-input`);
  await input.fill(value);
  await input.press("Enter");
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="password"]', smokePassword);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${baseUrl}/`, { timeout: 15000 });
  await page.waitForLoadState("networkidle");

  await page.goto(`${baseUrl}/taxonomy`, { waitUntil: "networkidle" });
  await page.fill("#tag-name", tagName);
  await page.click('#tag-form button[type="submit"]');
  await page.waitForFunction((name) => document.body.innerText.includes(name), tagName);

  await page.fill("#tag-name", tagName);
  await page.click('#tag-form button[type="submit"]');
  await page.waitForFunction(() => {
    const el = document.querySelector("#tag-message");
    return el && el.textContent.includes("已存在");
  });

  await page.goto(`${baseUrl}/new`, { waitUntil: "networkidle" });
  await page.fill("#url", "http://127.0.0.1/");
  await page.fill("#title", "非法链接测试");
  await page.click('#link-form button[type="submit"]');
  await page.waitForFunction(() => {
    const el = document.querySelector("#save-message");
    return el && el.textContent.trim().length > 0;
  });

  await page.fill("#url", "https://example.com/");
  await page.fill("#title", "Example Domain");
  await page.fill("#summary", summaryValue);
  await page.fill("#cover", coverValue);
  await page.fill("#note", noteValue);
  await addTagToken("#tag-editor", tagName);
  await addTagToken("#tag-editor", `${secondTag}，`);
  await page.waitForSelector("#new-preview-card .collection-card", { timeout: 15000 });
  const previewText = await page.locator("#new-preview-card").textContent();
  assert.ok(previewText && previewText.includes("Example Domain"), "new page preview should show title");
  assert.ok(previewText && previewText.includes(summaryValue), "new page preview should show summary");
  assert.ok(previewText && previewText.includes(tagName), "new page preview should show tag chip");
  await page.click('#link-form button[type="submit"]');
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");

  const detailUrl = page.url();
  const detailTitle = await page.locator("#detail-title").textContent();
  assert.ok(detailTitle && detailTitle.trim().length > 0, "detail title should exist");
  const detailNote = await page.locator("#detail-note").inputValue();
  assert.equal(detailNote, noteValue, "detail note should persist");
  const detailSummary = await page.locator("#detail-summary").inputValue();
  assert.equal(detailSummary, summaryValue, "detail summary should persist");
  const detailCover = await page.locator("#detail-cover").inputValue();
  assert.equal(detailCover, coverValue, "detail cover should persist");
  await page.waitForSelector("#detail-visual.collection-visual-detail", { timeout: 15000 });
  const detailChips = await page.locator("#detail-tag-editor .tag-chip").allTextContents();
  assert.ok(detailChips.some((text) => text.includes(tagName)), "existing tag should render as chip");
  assert.ok(detailChips.some((text) => text.includes(secondTag)), "auto-created tag should render as chip");
  const detailTagHref = await page.locator("#detail-tag-links .detail-tag-link", { hasText: tagName }).getAttribute("href");
  assert.ok(detailTagHref && /\/taxonomy\?tagId=\d+$/.test(detailTagHref), "detail tag should link to taxonomy tag result");

  await page.selectOption("#detail-status", "archived");
  await page.click('#detail-form button[type="submit"]');
  await page.waitForFunction(() => {
    const el = document.querySelector("#detail-message");
    return el && el.textContent.includes("已保存");
  });

  await page.click("#generate-short-link");
  await page.waitForSelector("#short-link-output a", { timeout: 15000 });
  const shortLinkHref = await page.locator("#short-link-output a").getAttribute("href");
  assert.ok(shortLinkHref, "short link should be generated");

  const shortPage = await browser.newPage();
  await shortPage.goto(shortLinkHref, { waitUntil: "domcontentloaded" });
  await shortPage.waitForURL("https://example.com/", { timeout: 20000 });
  await shortPage.close();

  await page.reload({ waitUntil: "networkidle" });
  const visitCountText = await page.locator("#detail-meta .stat", { hasText: "访问" }).textContent();
  assert.ok(visitCountText && /[1-9]/.test(visitCountText), "visit count should be updated");
  const existingShortLinkText = await page.locator("#existing-short-link").textContent();
  assert.ok(existingShortLinkText && existingShortLinkText.includes("/s/"), "existing short link should display");

  await page.goto(`${baseUrl}/new`, { waitUntil: "networkidle" });
  await page.fill("#url", "https://example.com/");
  await page.fill("#title", "Example Domain");
  await page.fill("#summary", summaryValue);
  await page.fill("#cover", coverValue);
  await page.fill("#note", `${noteValue}-duplicate`);
  await addTagToken("#tag-editor", tagName);
  await page.click('#link-form button[type="submit"]');
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.fill("#search-input", noteValue);
  await page.waitForTimeout(500);
  const listText = await page.locator("#link-grid").textContent();
  assert.ok(listText && listText.includes("Example Domain"), "search should find saved link by note");
  assert.ok(listText && listText.includes(summaryValue), "collection card should show summary");
  await page.waitForSelector("#link-grid .collection-visual-card", { timeout: 15000 });

  const tagFilterButton = page.locator('#tag-filter button[data-tag-id]').filter({ hasText: tagName });
  if ((await tagFilterButton.count()) === 0) {
    await page.locator('#tag-filter [data-tag-more]').click();
  }
  await page.locator('#tag-filter button[data-tag-id]').filter({ hasText: tagName }).click();
  await page.waitForTimeout(500);
  const tagFilteredCount = await page.locator("#link-grid .link-card").count();
  assert.ok(tagFilteredCount >= 1, "tag filter should work");

  const sourceHref = await page.locator("#link-grid .card-source-link").first().getAttribute("href");
  const detailHref = await page.locator("#link-grid .card-title-link").first().getAttribute("href");
  const openButtonHref = await page.locator("#link-grid .card-open-button").first().getAttribute("href");
  const detailButtonHref = await page.locator("#link-grid .card-detail-button").first().getAttribute("href");
  assert.ok(sourceHref && sourceHref.startsWith("https://"), "source label should open external url");
  assert.ok(detailHref && /\/link\?id=\d+$/.test(detailHref), "title should open detail page");
  assert.equal(openButtonHref, sourceHref, "open button should point to external url");
  assert.equal(detailButtonHref, detailHref, "detail button should point to detail page");

  await page.selectOption("#status-filter", "archived");
  await page.waitForTimeout(500);
  const archivedText = await page.locator("#link-grid").textContent();
  assert.ok(archivedText && archivedText.includes("archived"), "status filter should work");

  await page.goto(new URL(detailTagHref, baseUrl).toString(), { waitUntil: "networkidle" });
  await page.waitForSelector("#taxonomy-link-grid .link-card", { timeout: 15000 });
  const preselectedText = await page.locator("#taxonomy-link-grid").textContent();
  assert.ok(preselectedText && preselectedText.includes("Example Domain"), "taxonomy tag link should preselect matching cards");
  await page.waitForSelector('#tag-list [data-taxonomy-tag-id][aria-pressed="true"]', { timeout: 15000 });

  await page.goto(`${baseUrl}/taxonomy`, { waitUntil: "networkidle" });
  await page.waitForSelector("#taxonomy-empty-state:not(.hidden)", { timeout: 15000 });
  await page.locator('#tag-list [data-taxonomy-tag-id]').filter({ hasText: tagName }).click();
  await page.waitForSelector("#taxonomy-link-grid .link-card", { timeout: 15000 });
  await page.waitForFunction(() => {
    const emptyState = document.querySelector("#taxonomy-empty-state");
    return emptyState?.classList.contains("hidden") && getComputedStyle(emptyState).display === "none";
  });
  const taxonomyHint = await page.locator("#taxonomy-results-hint").textContent();
  const taxonomyText = await page.locator("#taxonomy-link-grid").textContent();
  assert.ok(taxonomyHint && taxonomyHint.includes("共"), "taxonomy should show count hint");
  assert.ok(taxonomyText && taxonomyText.includes("Example Domain"), "taxonomy should render matching cards in-page");

  await page.locator('#tag-list [data-taxonomy-tag-id]').filter({ hasText: tagName }).click();
  await page.waitForFunction(() => document.querySelector("#taxonomy-link-grid")?.classList.contains("hidden"));

  console.log(JSON.stringify({
    ok: true,
    detailUrl,
    shortLinkHref,
    visitCountText,
    sourceHref,
    detailHref,
    errors,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error.message, errors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}


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

function extractVisitCount(text) {
  const match = String(text || "").match(/访问\s*(\d+)/);
  return match ? Number(match[1]) : NaN;
}

async function readDetailVisitCount() {
  const text = await page.locator("#detail-meta .stat", { hasText: "访问" }).textContent();
  const count = extractVisitCount(text);
  assert.ok(Number.isInteger(count), `detail visit count should be readable, got: ${text}`);
  return count;
}

async function readCurrentDetailId() {
  const id = Number(new URL(page.url()).searchParams.get("id"));
  assert.ok(Number.isInteger(id) && id > 0, `detail url should include numeric id, got: ${page.url()}`);
  return id;
}

async function clickLinkAndClosePopup(locator) {
  const popupPromise = page.waitForEvent("popup");
  await locator.click();
  const popup = await popupPromise;
  await popup.waitForURL("https://example.com/", { timeout: 20000 });
  await popup.close();
}

async function addTagToken(rootSelector, value) {
  const input = page.locator(`${rootSelector} .tag-editor-input`);
  await input.fill(value);
  await input.press("Enter");
}

async function withNextDialog(accept, action) {
  const dialogPromise = page.waitForEvent("dialog");
  const actionPromise = action();
  const dialog = await dialogPromise;
  if (accept) {
    await dialog.accept();
  } else {
    await dialog.dismiss();
  }
  await actionPromise;
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
  assert.equal(await page.locator("#new-preview-card .card-open-button").count(), 1, "new page preview should show open button");
  assert.equal(await page.locator("#new-preview-card .card-detail-button").count(), 1, "new page preview should show detail button");
  await page.waitForSelector("#new-preview-card .card-archive-button", { timeout: 15000 });
  const previewArchiveText = await page.locator("#new-preview-card .card-archive-button").textContent();
  assert.equal(previewArchiveText, "归档", "new page preview should show archive button");
  assert.equal(await page.locator("#new-preview-card .card-restore-button").count(), 0, "new page preview should not show restore button");
  assert.equal(await page.locator("#new-preview-card .card-permanent-delete-button").count(), 0, "new page preview should not show permanent delete button");
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

  const detailOpenLinkDataId = await page.locator("#open-original-link").getAttribute("data-open-link-id");
  const detailOpenLinkDataUrl = await page.locator("#open-original-link").getAttribute("data-open-url");
  assert.ok(detailOpenLinkDataId && /^\d+$/.test(detailOpenLinkDataId), "detail open-original-link should carry data-open-link-id");
  assert.equal(detailOpenLinkDataUrl, "https://example.com/", "detail open-original-link should carry target url");

  const detailVisitCountBeforeOpen = await readDetailVisitCount();
  await clickLinkAndClosePopup(page.locator("#open-original-link"));
  await page.reload({ waitUntil: "networkidle" });
  const detailVisitCountAfterOpen = await readDetailVisitCount();
  assert.equal(detailVisitCountAfterOpen, detailVisitCountBeforeOpen + 1, "detail open-original-link should increment visit count");

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
  const shortLinkVisitCount = extractVisitCount(visitCountText);
  assert.ok(Number.isInteger(shortLinkVisitCount) && shortLinkVisitCount >= 2, "short link visit should increment visit count");
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

  await page.locator("#link-grid .card-title-link").first().click();
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });
  const detailVisitCountBeforeSourceOpen = await readDetailVisitCount();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.fill("#search-input", noteValue);
  await page.waitForTimeout(500);
  await clickLinkAndClosePopup(page.locator("#link-grid .card-source-link").first());
  await page.locator("#link-grid .card-title-link").first().click();
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });
  const detailVisitCountAfterSourceOpen = await readDetailVisitCount();
  assert.equal(detailVisitCountAfterSourceOpen, detailVisitCountBeforeSourceOpen + 1, "card source link should increment visit count");

  const detailVisitCountBeforeCardOpen = detailVisitCountAfterSourceOpen;
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.fill("#search-input", noteValue);
  await page.waitForTimeout(500);
  await clickLinkAndClosePopup(page.locator("#link-grid .card-open-button").first());
  await page.locator("#link-grid .card-title-link").first().click();
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });
  const detailVisitCountAfterCardOpen = await readDetailVisitCount();
  assert.equal(detailVisitCountAfterCardOpen, detailVisitCountBeforeCardOpen + 1, "card open button should increment visit count");

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.fill("#search-input", noteValue);
  await page.waitForTimeout(500);
  await page.waitForSelector("#link-grid .card-archive-button", { timeout: 15000 });
  assert.equal(await page.locator("#link-grid .card-archive-button").count() > 0, true, "active cards should show archive buttons");
  assert.equal(await page.locator("#link-grid .card-delete-button").count(), 0, "active cards should not show delete buttons");
  const activeCountBeforeCancel = await page.locator("#link-grid .link-card").count();
  await withNextDialog(false, async () => page.locator("#link-grid .card-archive-button").first().click());
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#link-grid .link-card").count(), activeCountBeforeCancel, "cancelled archive should keep active card visible");

  await page.selectOption("#status-filter", "archived");
  await page.waitForTimeout(500);
  const archivedText = await page.locator("#link-grid").textContent();
  assert.ok(archivedText && archivedText.includes("archived"), "status filter should work");
  assert.equal(await page.locator("#link-grid .card-restore-button").count() > 0, true, "archived cards should show restore buttons");
  assert.equal(await page.locator("#link-grid .card-permanent-delete-button").count() > 0, true, "archived cards should show permanent delete buttons");

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

  await page.locator("#taxonomy-link-grid .card-title-link").first().click();
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });
  const taxonomyDetailUrl = page.url();
  const detailVisitCountBeforeTaxonomyOpen = await readDetailVisitCount();
  await page.goto(new URL(detailTagHref, baseUrl).toString(), { waitUntil: "networkidle" });
  await clickLinkAndClosePopup(page.locator("#taxonomy-link-grid .card-open-button").first());
  await page.goto(taxonomyDetailUrl, { waitUntil: "networkidle" });
  const detailVisitCountAfterTaxonomyOpen = await readDetailVisitCount();
  assert.equal(detailVisitCountAfterTaxonomyOpen, detailVisitCountBeforeTaxonomyOpen + 1, "taxonomy card open button should increment visit count");

  await page.goto(new URL(detailTagHref, baseUrl).toString(), { waitUntil: "networkidle" });
  await page.locator('#tag-list [data-taxonomy-tag-id]').filter({ hasText: tagName }).click();
  await page.waitForFunction(() => document.querySelector("#taxonomy-link-grid")?.classList.contains("hidden"));

  await page.goto(new URL(detailTagHref, baseUrl).toString(), { waitUntil: "networkidle" });
  await page.waitForSelector("#taxonomy-link-grid .card-archive-button", { timeout: 15000 });
  assert.equal(await page.locator("#taxonomy-link-grid .card-delete-button").count(), 0, "taxonomy active cards should not show delete buttons");
  await withNextDialog(true, async () => page.locator("#taxonomy-link-grid .card-archive-button").first().click());
  await page.waitForTimeout(500);
  const taxonomyAfterSoftDelete = await page.locator("#taxonomy-link-grid").textContent();
  assert.ok(!taxonomyAfterSoftDelete || !taxonomyAfterSoftDelete.includes("Example Domain"), "confirmed archive should remove card from active taxonomy result");

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.selectOption("#status-filter", "archived");
  await page.fill("#search-input", noteValue);
  await page.waitForTimeout(500);
  const archivedAfterSoftDelete = await page.locator("#link-grid").textContent();
  assert.ok(archivedAfterSoftDelete && archivedAfterSoftDelete.includes("Example Domain"), "archived link should remain visible in archived filter");
  await page.waitForSelector("#link-grid .card-restore-button", { timeout: 15000 });
  const restoredLinkId = await page.locator("#link-grid .card-restore-button").first().getAttribute("data-restore-link-id");
  assert.ok(restoredLinkId && /^\d+$/.test(restoredLinkId), "restore button should carry link id");
  await page.locator("#link-grid .card-restore-button").first().click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(`#link-grid [data-restore-link-id="${restoredLinkId}"]`).count(), 0, "restored link should leave archived filter");

  await page.selectOption("#status-filter", "active");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(`#link-grid [data-archive-link-id="${restoredLinkId}"]`).count(), 1, "restored link should return to active filter");
  await withNextDialog(true, async () => page.locator("#link-grid .card-archive-button").first().click());
  await page.waitForTimeout(500);

  await page.selectOption("#status-filter", "archived");
  await page.waitForTimeout(500);
  await page.locator("#link-grid .card-title-link").first().click();
  await page.waitForURL(/\/link\?id=\d+$/, { timeout: 15000 });
  const permanentlyDeletedLinkId = await readCurrentDetailId();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.selectOption("#status-filter", "archived");
  await page.fill("#search-input", noteValue);
  await page.waitForTimeout(500);
  const permanentlyDeletedButtonId = await page.locator("#link-grid .card-permanent-delete-button").first().getAttribute("data-permanent-delete-link-id");
  assert.equal(permanentlyDeletedButtonId, String(permanentlyDeletedLinkId), "permanent delete button should target the selected archived link");
  await withNextDialog(true, async () => page.locator("#link-grid .card-permanent-delete-button").first().click());
  await page.waitForTimeout(500);
  assert.equal(await page.locator(`#link-grid [data-permanent-delete-link-id="${permanentlyDeletedLinkId}"]`).count(), 0, "permanently deleted link should leave archived filter");
  const deletedLinkResponse = await page.evaluate(async (id) => {
    const response = await fetch(`/api/links/${id}`);
    return { status: response.status };
  }, permanentlyDeletedLinkId);
  assert.equal(deletedLinkResponse.status, 404, "permanently deleted link detail API should return 404");

  await page.goto(detailUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#archive-link-button", { timeout: 15000 });
  assert.equal(await page.locator("#archive-link-button").isDisabled(), true, "archived detail delete button should be disabled");
  assert.equal(await page.locator("#archive-link-button").textContent(), "已归档", "archived detail archive button should remain disabled");

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


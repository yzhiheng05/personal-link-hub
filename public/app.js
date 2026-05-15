const page = document.body.dataset.page;
const state = {
  tags: [],
  selectedTags: new Set(),
  draftTagNames: [],
  activeTaxonomyTagId: null,
  taxonomyLinks: [],
};

boot().catch((error) => {
  console.error(error);
  flash(findFirst(["#login-message", "#save-message", "#detail-message", "#list-message", "#tag-message", "#taxonomy-message"]), error.message, true);
});

async function boot() {
  if (page !== "login") bindLogout();
  if (page === "login") return initLoginPage();

  await ensureAuthenticated();

  if (page === "index") return initIndexPage();
  if (page === "new") return initNewPage();
  if (page === "link") return initLinkPage();
  if (page === "taxonomy") return initTaxonomyPage();
}

async function initLoginPage() {
  const auth = await apiFetch("/api/auth/me", { allowUnauthorized: true });
  if (auth.authenticated) {
    location.href = "/";
    return;
  }

  const form = find("#login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash(find("#login-message"));
    try {
      const payload = { password: new FormData(form).get("password") };
      const response = await apiFetch("/api/auth/login", { method: "POST", body: payload });
      if (response.ok) {
        location.href = new URLSearchParams(location.search).get("redirect") || "/";
      }
    } catch (error) {
      flash(find("#login-message"), error.message, true);
    }
  });
}

async function initIndexPage() {
  await loadTags();
  renderFilterTagOptions(find("#tag-filter"), state.tags, state.selectedTags);

  find("#search-input").addEventListener("input", debounce(loadLinks, 250));
  find("#status-filter").addEventListener("change", loadLinks);
  find("#tag-filter").addEventListener("click", (event) => handleFilterTagToggle(event, loadLinks));

  await loadLinks();
}

async function initNewPage() {
  await loadTags();
  state.draftTagNames = [];
  bindTagEditor({
    root: find("#tag-editor"),
    initialNames: [],
    onChange: handleDraftTagNamesChange,
  });

  find("#link-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash(find("#save-message"));
    try {
      finalizeTagEditor(find("#tag-editor"));
      await saveLink();
    } catch (error) {
      flash(find("#save-message"), error.message, true);
    }
  });
}

async function initLinkPage() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) throw new Error("缺少链接 id。请选择一条已保存链接。");

  await loadTags();
  const response = await apiFetch(`/api/links/${id}`);
  populateLinkDetail(response.item);
  state.draftTagNames = response.item.tags.map((tag) => tag.name);
  bindTagEditor({
    root: find("#detail-tag-editor"),
    initialNames: state.draftTagNames,
    onChange: handleDraftTagNamesChange,
  });

  find("#detail-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash(find("#detail-message"));
    try {
      finalizeTagEditor(find("#detail-tag-editor"));
      const payload = serializeLinkForm(find("#detail-form"));
      const saveResponse = await apiFetch(`/api/links/${id}`, { method: "PATCH", body: payload });
      populateLinkDetail(saveResponse.item);
      state.draftTagNames = saveResponse.item.tags.map((tag) => tag.name);
      bindTagEditor({
        root: find("#detail-tag-editor"),
        initialNames: state.draftTagNames,
        onChange: handleDraftTagNamesChange,
      });
      flash(find("#detail-message"), `已保存：${saveResponse.item.title || saveResponse.item.url}`);
    } catch (error) {
      flash(find("#detail-message"), error.message, true);
    }
  });
  find("#generate-short-link").addEventListener("click", async () => {
    clearFlash(find("#short-link-output"));
    try {
      const shortLinkResponse = await apiFetch(`/api/links/${id}/short-link`, { method: "POST" });
      renderShortLink(find("#short-link-output"), shortLinkResponse.shortUrl, "已生成短链：");
      renderShortLink(find("#existing-short-link"), shortLinkResponse.shortUrl, "当前短链：");
    } catch (error) {
      flash(find("#short-link-output"), error.message, true);
    }
  });
}

async function initTaxonomyPage() {
  await loadTags();
  renderTaxonomyList();
  renderTaxonomyResults();

  find("#tag-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash(find("#tag-message"));
    try {
      const input = find("#tag-name");
      const response = await apiFetch("/api/tags", { method: "POST", body: { name: input.value } });
      if (response.ok) {
        input.value = "";
        flash(find("#tag-message"), "标签已创建");
        await loadTags();
        renderTaxonomyList();
        renderTaxonomyResults();
      }
    } catch (error) {
      flash(find("#tag-message"), error.message, true);
    }
  });

  find("#tag-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-taxonomy-tag-id]");
    if (!button) return;

    const tagId = Number(button.dataset.taxonomyTagId);
    if (state.activeTaxonomyTagId === tagId) {
      state.activeTaxonomyTagId = null;
      state.taxonomyLinks = [];
      renderTaxonomyList();
      renderTaxonomyResults();
      return;
    }

    clearFlash(find("#taxonomy-message"));
    state.activeTaxonomyTagId = tagId;
    renderTaxonomyList();
    try {
      const response = await apiFetch(`/api/links?tagIds=${tagId}`);
      state.taxonomyLinks = response.items || [];
      renderTaxonomyResults();
    } catch (error) {
      state.taxonomyLinks = [];
      renderTaxonomyResults();
      flash(find("#taxonomy-message"), error.message, true);
    }
  });
}

async function saveLink() {
  const response = await apiFetch("/api/links", { method: "POST", body: serializeLinkForm(find("#link-form")) });
  flash(find("#save-message"), response.duplicateWarning ? `${response.duplicateWarning} 已保存。` : "链接已保存。", Boolean(response.duplicateWarning));
  location.href = `/link?id=${response.item.id}`;
}

async function loadLinks() {
  const params = new URLSearchParams();
  const q = find("#search-input").value.trim();
  const status = find("#status-filter").value;
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (state.selectedTags.size > 0) params.set("tagIds", Array.from(state.selectedTags).join(","));

  try {
    const response = await apiFetch(`/api/links?${params.toString()}`);
    const items = response.items || [];
    find("#list-hint").textContent = `共 ${items.length} 条`;
    clearFlash(find("#list-message"));
    renderLinkGrid(find("#link-grid"), items);
  } catch (error) {
    flash(find("#list-message"), error.message, true);
    renderLinkGrid(find("#link-grid"), []);
    find("#list-hint").textContent = "加载失败";
  }
}

async function loadTags() {
  const tagsResponse = await apiFetch("/api/tags");
  state.tags = tagsResponse.items || [];
}

function populateLinkDetail(item) {
  find("#detail-title").textContent = item.title || item.url;
  find("#detail-summary-text").textContent = item.summary || item.note || "暂无补充信息";
  find("#detail-meta").innerHTML = `
    <div class="stat"><span class="stat-label">创建于</span><span class="stat-value">${formatDate(item.created_at)}</span></div>
    <div class="stat"><span class="stat-label">最后访问</span><span class="stat-value">${item.last_visited_at ? formatDate(item.last_visited_at) : "尚无"}</span></div>
    <div class="stat"><span class="stat-label">访问次数</span><span class="stat-value">${item.visit_count}</span></div>
  `;
  find("#detail-url").value = item.url || "";
  find("#detail-title-input").value = item.title || "";
  find("#detail-site-name").value = item.site_name || "";
  find("#detail-favicon").value = item.favicon_url || "";
  find("#detail-cover").value = item.cover_image_url || "";
  find("#detail-summary").value = item.summary || "";
  find("#detail-note").value = item.note || "";
  find("#detail-status").value = item.status;
  find("#open-original-link").href = item.url;
  if (item.short_code) {
    const shortUrl = `${location.origin}/s/${item.short_code}`;
    renderShortLink(find("#short-link-output"), shortUrl, "已生成短链：");
    renderShortLink(find("#existing-short-link"), shortUrl, "当前短链：");
  } else {
    find("#existing-short-link").textContent = "当前还没有短链。";
    find("#short-link-output").textContent = "";
  }
}

function renderTaxonomyList() {
  const list = find("#tag-list");
  if (state.tags.length === 0) {
    list.innerHTML = '<p class="muted message-pill">还没有标签。</p>';
    return;
  }

  list.innerHTML = state.tags.map((item) => {
    const activeClass = state.activeTaxonomyTagId === item.id ? " active" : "";
    return `
      <button class="content-list-item taxonomy-row${activeClass}" type="button" data-taxonomy-tag-id="${item.id}">
        <span>${escapeHtml(item.name)}</span>
        <span class="muted">#${item.id}</span>
      </button>
    `;
  }).join("");
}

function renderTaxonomyResults() {
  const title = find("#taxonomy-results-title");
  const hint = find("#taxonomy-results-hint");
  const message = find("#taxonomy-message");
  const grid = find("#taxonomy-link-grid");

  if (!title || !hint || !grid) return;

  if (state.activeTaxonomyTagId == null) {
    title.textContent = "点击上方标签查看结果";
    hint.textContent = "";
    if (message) message.textContent = "";
    grid.innerHTML = "";
    grid.classList.add("hidden");
    return;
  }

  const activeTag = state.tags.find((tag) => tag.id === state.activeTaxonomyTagId);
  title.textContent = activeTag ? `标签：${activeTag.name}` : "标签结果";
  hint.textContent = `共 ${state.taxonomyLinks.length} 条`;
  grid.classList.remove("hidden");
  renderLinkGrid(grid, state.taxonomyLinks, { emptyMessage: "这个标签下还没有链接。" });
}

function renderFilterTagOptions(container, tags, selectedIds) {
  container.innerHTML = tags.length > 0
    ? tags.map((tag) => `<button class="tag-option ${selectedIds.has(tag.id) ? "selected" : ""}" type="button" data-tag-id="${tag.id}">${escapeHtml(tag.name)}</button>`).join("")
    : '<span class="muted message-pill">还没有标签，请先创建。</span>';
}

function renderLinkGrid(container, items, options = {}) {
  const emptyMessage = options.emptyMessage || "当前没有匹配的链接，换个关键词或先新增一条链接试试。";
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-card">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="link-card link-card-minimal">
      <div class="link-card-top">
        <a class="eyebrow eyebrow-pill card-source-link" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(formatSourceLabel(item.url, item.site_name))}</a>
        <span class="status-pill ${item.status}">${item.status}</span>
      </div>
      <a class="card-title-link" href="/link?id=${item.id}">
        <h3 class="card-title-block">${escapeHtml(item.title || item.url)}</h3>
      </a>
    </article>
  `).join("");
}

function renderShortLink(element, shortUrl, prefix) {
  element.innerHTML = `${escapeHtml(prefix)}<a class="text-link" href="${shortUrl}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl)}</a>`;
}

function serializeLinkForm(form) {
  const formData = new FormData(form);
  return {
    url: formData.get("url"),
    title: formData.get("title"),
    siteName: formData.get("siteName"),
    faviconUrl: formData.get("faviconUrl"),
    coverImageUrl: formData.get("coverImageUrl"),
    summary: formData.get("summary"),
    note: formData.get("note"),
    status: formData.get("status") || "active",
    tagNames: [...state.draftTagNames],
  };
}

function bindTagEditor({ root, initialNames, onChange }) {
  const normalized = normalizeTagNames(initialNames);
  root.dataset.tagNames = JSON.stringify(normalized);
  root.innerHTML = `
    <div class="tag-editor-shell">
      <div class="tag-chip-list"></div>
      <input class="field tag-editor-input" type="text" placeholder="输入标签后按回车、逗号或顿号" list="tag-suggestions" />
    </div>
    <p class="muted tag-editor-hint">可直接输入新标签，支持逗号、中文逗号、回车和失焦确认。</p>
    <datalist id="tag-suggestions">${state.tags.map((tag) => `<option value="${escapeAttribute(tag.name)}"></option>`).join("")}</datalist>
  `;

  const input = root.querySelector(".tag-editor-input");
  const chipList = root.querySelector(".tag-chip-list");

  const commitCurrentInput = () => {
    const currentNames = readTagEditorNames(root);
    const nextNames = mergeTagNames(currentNames, splitTagTokens(input.value));
    input.value = "";
    writeTagEditorNames(root, chipList, nextNames);
    onChange(nextNames);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      commitCurrentInput();
      return;
    }

    if (event.key === "Backspace" && !input.value && readTagEditorNames(root).length > 0) {
      const nextNames = readTagEditorNames(root).slice(0, -1);
      writeTagEditorNames(root, chipList, nextNames);
      onChange(nextNames);
    }
  });

  input.addEventListener("input", () => {
    if (!/[，,]/.test(input.value)) return;
    commitCurrentInput();
  });

  input.addEventListener("blur", () => {
    if (!input.value.trim()) return;
    commitCurrentInput();
  });

  chipList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag-name]");
    if (!button) return;
    const tagName = button.dataset.tagName;
    const nextNames = readTagEditorNames(root).filter((name) => name !== tagName);
    writeTagEditorNames(root, chipList, nextNames);
    onChange(nextNames);
  });

  writeTagEditorNames(root, chipList, normalized);
  onChange(normalized);
}

function finalizeTagEditor(root) {
  const input = root.querySelector(".tag-editor-input");
  if (!input || !input.value.trim()) return;
  const chipList = root.querySelector(".tag-chip-list");
  const nextNames = mergeTagNames(readTagEditorNames(root), splitTagTokens(input.value));
  input.value = "";
  writeTagEditorNames(root, chipList, nextNames);
  handleDraftTagNamesChange(nextNames);
}

function readTagEditorNames(root) {
  try {
    return normalizeTagNames(JSON.parse(root.dataset.tagNames || "[]"));
  } catch {
    return [];
  }
}

function writeTagEditorNames(root, chipList, tagNames) {
  const normalized = normalizeTagNames(tagNames);
  root.dataset.tagNames = JSON.stringify(normalized);
  chipList.innerHTML = normalized.length > 0
    ? normalized.map((name) => `
      <span class="tag-pill tag-chip">
        <span>${escapeHtml(name)}</span>
        <button type="button" class="tag-chip-remove" data-tag-name="${escapeAttribute(name)}" aria-label="移除 ${escapeAttribute(name)}">×</button>
      </span>
    `).join("")
    : '<span class="muted message-pill">还没有标签，输入后会自动创建。</span>';
}

function handleDraftTagNamesChange(tagNames) {
  state.draftTagNames = normalizeTagNames(tagNames);
}

function handleFilterTagToggle(event, callback) {
  const button = event.target.closest("[data-tag-id]");
  if (!button) return;
  const tagId = Number(button.dataset.tagId);
  if (state.selectedTags.has(tagId)) {
    state.selectedTags.delete(tagId);
    button.classList.remove("selected");
  } else {
    state.selectedTags.add(tagId);
    button.classList.add("selected");
  }
  if (callback) callback();
}

function normalizeTagNames(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const names = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function mergeTagNames(existingNames, nextNames) {
  return normalizeTagNames([...existingNames, ...nextNames]);
}

function splitTagTokens(raw) {
  return normalizeTagNames(String(raw || "").split(/[，,\n]+/));
}

function formatSourceLabel(url, siteName) {
  if (siteName && siteName.trim()) return siteName.trim();
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown site";
  }
}

async function ensureAuthenticated() {
  const response = await apiFetch("/api/auth/me", { allowUnauthorized: true });
  if (!response.authenticated) location.href = "/login";
}

function bindLogout() {
  const button = find("#logout-button");
  if (!button) return;
  button.addEventListener("click", async () => {
    await apiFetch("/api/auth/logout", { method: "POST", allowUnauthorized: true });
    location.href = "/login";
  });
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return { ok: true };

  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new Error("服务器返回了无法识别的响应。");
  }

  if (response.status === 401 && !options.allowUnauthorized) {
    location.href = "/login";
    throw new Error("需要重新登录。");
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return { ok: true, ...data };
}

function flash(element, message, isWarning = false) {
  if (!element) return;
  element.textContent = message;
  element.style.color = isWarning ? "#9b442b" : "#205d43";
}

function clearFlash(element) {
  if (!element) return;
  element.textContent = "";
  element.style.color = "";
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function find(selector) {
  return document.querySelector(selector);
}

function findFirst(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
}

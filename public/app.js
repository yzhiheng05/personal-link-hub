const page = document.body.dataset.page;
const state = { tags: [], selectedTags: new Set() };

boot().catch((error) => {
  console.error(error);
  flash(findFirst(["#login-message", "#save-message", "#detail-message", "#list-message", "#tag-message"]), error.message, true);
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
  renderTagOptions(find("#tag-filter"), state.tags, []);

  find("#search-input").addEventListener("input", debounce(loadLinks, 250));
  find("#status-filter").addEventListener("change", loadLinks);
  find("#tag-filter").addEventListener("click", (event) => handleTagToggle(event, loadLinks));

  await loadLinks();
}

async function initNewPage() {
  await loadTags();
  renderTagOptions(find("#tag-selector"), state.tags, []);
  find("#tag-selector").addEventListener("click", (event) => handleTagToggle(event));
  find("#link-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash(find("#save-message"));
    try {
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
  renderTagOptions(find("#detail-tags"), state.tags, response.item.tags.map((tag) => tag.id));
  state.selectedTags = new Set(response.item.tags.map((tag) => tag.id));

  find("#detail-tags").addEventListener("click", (event) => handleTagToggle(event));
  find("#detail-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash(find("#detail-message"));
    try {
      const payload = serializeLinkForm(find("#detail-form"));
      const saveResponse = await apiFetch(`/api/links/${id}`, { method: "PATCH", body: payload });
      populateLinkDetail(saveResponse.item);
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
      }
    } catch (error) {
      flash(find("#tag-message"), error.message, true);
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
    renderLinkGrid(items);
  } catch (error) {
    flash(find("#list-message"), error.message, true);
    renderLinkGrid([]);
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
  }
}

function renderTaxonomyList() {
  find("#tag-list").innerHTML = state.tags.length > 0
    ? state.tags.map((item) => `<div class="content-list-item"><span>${escapeHtml(item.name)}</span><span class="muted">#${item.id}</span></div>`).join("")
    : '<p class="muted message-pill">还没有标签。</p>';
}

function renderTagOptions(container, tags, selectedIds) {
  state.selectedTags = new Set(selectedIds);
  container.innerHTML = tags.length > 0
    ? tags.map((tag) => `<button class="tag-option ${selectedIds.includes(tag.id) ? "selected" : ""}" type="button" data-tag-id="${tag.id}">${escapeHtml(tag.name)}</button>`).join("")
    : '<span class="muted message-pill">还没有标签，请先创建。</span>';
}

function renderLinkGrid(items) {
  const grid = find("#link-grid");
  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-card">当前没有匹配的链接，换个关键词或先新增一条链接试试。</div>';
    return;
  }

  grid.innerHTML = items.map((item) => `
    <a class="link-card link-card-minimal" href="/link?id=${item.id}">
      <div class="link-card-top">
        <p class="eyebrow eyebrow-pill">${escapeHtml(formatSourceLabel(item.url, item.site_name))}</p>
        <span class="status-pill ${item.status}">${item.status}</span>
      </div>
      <h3 class="card-title-block">${escapeHtml(item.title || item.url)}</h3>
    </a>
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
    note: formData.get("note"),
    status: formData.get("status") || "active",
    tagIds: Array.from(state.selectedTags),
  };
}

function handleTagToggle(event, callback) {
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

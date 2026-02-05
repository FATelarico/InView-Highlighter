const MENU_HIGHLIGHT = "hl_highlight";
const MENU_EXPORT = "hl_export";
const MENU_CLEAR = "hl_clear";
const MENU_IMPORT = "hl_import";
const MENU_EXPORT_HTML = "hl_export_html";

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_EXPORT_HTML, title: "Export highlights (HTML)", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_HIGHLIGHT, title: "Highlight selection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_EXPORT, title: "Export highlights (JSON)", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_IMPORT, title: "Import highlights (JSON)", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_CLEAR, title: "Clear highlights", contexts: ["page"] });
});

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab?.id) return;

        if (command === "highlight") send(tab.id, { type: "HIGHLIGHT" });
        if (command === "export") exportFromTab(tab.id);
        if (command === "clear") send(tab.id, { type: "CLEAR" });
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === MENU_EXPORT_HTML) exportHtmlFromTab(tab.id);
    if (info.menuItemId === MENU_HIGHLIGHT) send(tab.id, { type: "HIGHLIGHT" });
    if (info.menuItemId === MENU_EXPORT) exportFromTab(tab.id);
    if (info.menuItemId === MENU_CLEAR) send(tab.id, { type: "CLEAR" });
    if (info.menuItemId === MENU_IMPORT) openImportPage(tab);
});

function send(tabId, msg) {
    chrome.tabs.sendMessage(tabId, msg, () => {
        if (chrome.runtime.lastError) {
            console.warn("sendMessage failed:", chrome.runtime.lastError.message);
        }
    });
}

function exportFromTab(tabId) {
    chrome.tabs.sendMessage(tabId, { type: "GET_EXPORT_PAYLOAD" }, (payload) => {
        if (!payload || chrome.runtime.lastError) return;

        const json = JSON.stringify(payload, null, 2);
        const safeHost = (payload.host || "page").replace(/[^a-z0-9._-]/gi, "_");
        const filename = `highlights-${safeHost}-${Date.now()}.json`;

        const url = "data:application/json;charset=utf-8," + encodeURIComponent(json);
        chrome.downloads.download({ url, filename, saveAs: true });
    });
}

function openImportPage(tab) {
    // Note: tab.url may be undefined on some restricted pages; content scripts won't run there anyway.
    const tabId = tab.id;
    const targetUrl = tab.url || "";
    const importUrl =
    chrome.runtime.getURL("import.html") +
    `?tabId=${encodeURIComponent(tabId)}&url=${encodeURIComponent(targetUrl)}`;

    chrome.tabs.create({ url: importUrl });
}

function exportHtmlFromTab(tabId) {
    chrome.tabs.sendMessage(tabId, { type: "GET_EXPORT_PAYLOAD" }, (payload) => {
        if (!payload || chrome.runtime.lastError) return;

        const safeHost = (payload.host || "page").replace(/[^a-z0-9._-]/gi, "_");
        const filename = `highlights-${safeHost}-${Date.now()}.html`;

        const html = buildExportHtml(payload);
        const url = "data:text/html;charset=utf-8," + encodeURIComponent(html);

        chrome.downloads.download({ url, filename, saveAs: true });
    });
}

function buildExportHtml(payload) {
    const esc = escapeHtml;
    const items = (payload.highlights || []).map((h, i) => {
        const snippet = (h.html && String(h.html).trim().length)
        ? h.html
        : esc(h.quote || "");

        return `
        <section class="hl">
        <div class="meta">
        <span>#${i + 1}</span>
        <span>${esc(h.createdAt || "")}</span>
        </div>
        <div class="snippet">${snippet}</div>
        </section>
        `;
    }).join("\n");

    return `<!doctype html>
    <html>
    <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(payload.title || "Highlights")}</title>
    <style>
    body { font-family: system-ui, sans-serif; margin: 24px; line-height: 1.45; }
    .wrap { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 20px; margin: 0 0 6px 0; }
    .src { margin: 0 0 18px 0; color: #444; font-size: 13px; }
    .hl { border: 1px solid #ddd; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
    .meta { display: flex; gap: 12px; color: #666; font-size: 12px; margin-bottom: 8px; }
    .snippet { font-size: 14px; }
    .snippet a { word-break: break-word; }
    </style>
    </head>
    <body>
    <div class="wrap">
    <h1>${esc(payload.title || "Highlights")}</h1>
    <div class="src">
    Source: <a href="${esc(payload.url || "")}">${esc(payload.url || "")}</a><br/>
    Exported: ${esc(payload.exportedAt || "")}
    </div>
    ${items || "<p>No highlights.</p>"}
    </div>
    </body>
    </html>`;
}

function escapeHtml(s) {
    return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

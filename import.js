const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tabId"));
const targetUrl = params.get("url") || "";

const targetEl = document.getElementById("target");
const fileEl = document.getElementById("file");
const importBtn = document.getElementById("importBtn");
const statusEl = document.getElementById("status");

targetEl.textContent = targetUrl || "(unknown)";

let fileText = null;

fileEl.addEventListener("change", async () => {
    fileText = null;
    statusEl.textContent = "Reading file...";
    importBtn.disabled = true;

    const file = fileEl.files?.[0];
    if (!file) {
        statusEl.textContent = "No file selected.";
        return;
    }

    try {
        fileText = await readAsText(file);
        importBtn.disabled = false;
        statusEl.textContent = "Ready to import.";
    } catch (e) {
        statusEl.textContent = `Failed to read file:\n${String(e)}`;
    }
});

importBtn.addEventListener("click", async () => {
    if (!fileText) return;

    statusEl.textContent = "Parsing JSON...";

    let payload;
    try {
        payload = JSON.parse(fileText);
    } catch (e) {
        statusEl.textContent = `Invalid JSON:\n${String(e)}`;
        return;
    }

    // Minimal validation: expect { url, highlights: [] }
    const highlights = payload?.highlights;
    const exportedUrl = payload?.url;

    if (!Array.isArray(highlights)) {
        statusEl.textContent = "JSON does not contain a 'highlights' array.";
        return;
    }

    if (!targetUrl) {
        statusEl.textContent = "Cannot determine target URL for this tab.";
        return;
    }

    // You can enforce a strict match; here we warn but still import to the current page.
    if (exportedUrl && exportedUrl !== targetUrl) {
        statusEl.textContent =
        "Warning: export 'url' does not match the current page.\n" +
        "Importing highlights into the current page key anyway.";
    } else {
        statusEl.textContent = "Importing...";
    }

    const key = "hl:" + targetUrl;

    try {
        await chrome.storage.local.set({ [key]: highlights });

        // Ask the content script to clear and reload from storage.
        await chrome.tabs.sendMessage(tabId, { type: "RELOAD_FROM_STORAGE" });

        statusEl.textContent = `Imported ${highlights.length} highlight(s).\nYou can close this tab.`;
        importBtn.disabled = true;
    } catch (e) {
        statusEl.textContent = `Import failed:\n${String(e)}`;
    }
});

function readAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsText(file);
    });
}

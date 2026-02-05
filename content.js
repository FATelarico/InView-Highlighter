const STORE_PREFIX = "hl:";
const STYLE_ID = "my_hl_style";
const HIGHLIGHT_NAME = "my_hl_css_api";

let cache = [];

init().catch(() => {});

async function init() {
    ensureStyle();
    cache = await loadForThisPage();
    reapplyAll(cache);
    chrome.runtime.onMessage.addListener(onMessage);
}

function onMessage(msg, _sender, sendResponse) {
    (async () => {
        if (msg?.type === "HIGHLIGHT") {
            await highlightSelection();
            sendResponse({ ok: true });
            return;
        }

        if (msg?.type === "CLEAR") {
            await clearHighlights();
            sendResponse({ ok: true });
            return;
        }

        if (msg?.type === "GET_EXPORT_PAYLOAD") {
            const payload = {
                exportedAt: new Date().toISOString(),
     url: location.href,
     host: location.host,
     title: document.title,
     highlights: cache
            };
            sendResponse(payload);
            return;
        }

        if (msg?.type === "RELOAD_FROM_STORAGE") {
            await reloadFromStorage();
            sendResponse({ ok: true });
            return;
        }

        sendResponse({ ok: false });
    })();

    return true; // keep the message channel open for async responses
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) { background: #ffeb3b; }
    mark[data-my-hl="1"] { background: #ffeb3b; padding: 0; }
    `;
    document.documentElement.appendChild(style);
}

function pageKey() {
    // If you prefer “same page regardless of hash”, switch to: new URL(location.href).origin + new URL(location.href).pathname
    return STORE_PREFIX + location.href;
}

async function loadForThisPage() {
    const key = pageKey();
    const obj = await chrome.storage.local.get(key);
    return Array.isArray(obj[key]) ? obj[key] : [];
}

async function saveForThisPage(highlights) {
    const key = pageKey();
    await chrome.storage.local.set({ [key]: highlights });
}

function getSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    return range;
}

async function highlightSelection() {
    const range = getSelectionRange();
    if (!range) return;

    const rec = buildRecordFromRange(range);
    cache.push(rec);
    await saveForThisPage(cache);

    // Render immediately
    const cloned = range.cloneRange();
    if (!applyCssHighlight(cloned)) {
        applyDomWrapHighlight(range, rec.id);
    }

    window.getSelection()?.removeAllRanges();
}

function unwrapMark(mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
}

function buildRecordFromRange(range) {
    const quote = range.toString();
    const html = serialiseRangeToHtml(range);

    return {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + String(Math.random()),
        createdAt: new Date().toISOString(),
        quote,
        html,
        start: serialiseEndpoint(range.startContainer, range.startOffset),
        end: serialiseEndpoint(range.endContainer, range.endOffset)
    };
}

function serialiseEndpoint(node, offset) {
    return { xpath: getXPath(node), offset };
}

function getXPath(node) {
    if (node === document) return "/";
    if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentNode;
        const siblings = Array.from(parent.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
        const index = siblings.indexOf(node) + 1;
        return getXPath(parent) + `/text()[${index}]`;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    if (node === document.documentElement) return "/html[1]";

    const tag = node.tagName.toLowerCase();
    let index = 1;
    let sib = node.previousElementSibling;
    while (sib) {
        if (sib.tagName.toLowerCase() === tag) index++;
        sib = sib.previousElementSibling;
    }
    return getXPath(node.parentElement) + `/${tag}[${index}]`;
}

function nodeFromXPath(xpath) {
    try {
        const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return res.singleNodeValue || null;
    } catch {
        return null;
    }
}

function reapplyAll(records) {
    for (const rec of records) {
        const r = reconstructRange(rec);
        if (!r) continue;
        if (!applyCssHighlight(r)) {
            // use a clone; DOM wrapping mutates nodes
            applyDomWrapHighlight(r, rec.id);
        }
    }
}

function reconstructRange(rec) {
    const startNode = nodeFromXPath(rec?.start?.xpath);
    const endNode = nodeFromXPath(rec?.end?.xpath);
    if (!startNode || !endNode) return null;

    try {
        const r = document.createRange();
        r.setStart(startNode, clampOffset(startNode, rec.start.offset));
        r.setEnd(endNode, clampOffset(endNode, rec.end.offset));
        return r;
    } catch {
        return null;
    }
}

function clampOffset(node, offset) {
    const max = node.nodeType === Node.TEXT_NODE ? node.nodeValue.length : node.childNodes.length;
    if (typeof offset !== "number") return 0;
    return Math.max(0, Math.min(offset, max));
}

// Option A: CSS Custom Highlight API
function applyCssHighlight(range) {
    if (!("highlights" in CSS) || typeof Highlight === "undefined") return false;
    try {
        const existing = CSS.highlights.get(HIGHLIGHT_NAME);
        const hl = existing || new Highlight();
        hl.add(range);
        CSS.highlights.set(HIGHLIGHT_NAME, hl);
        return true;
    } catch {
        return false;
    }
}

// Option B: DOM-wrapping fallback
function applyDomWrapHighlight(range, id) {
    const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (n) => {
                if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = n.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                const tag = p.tagName?.toLowerCase();
                if (tag === "script" || tag === "style" || tag === "textarea") return NodeFilter.FILTER_REJECT;
                if (p.closest('mark[data-my-hl="1"]')) return NodeFilter.FILTER_REJECT;

                const r = document.createRange();
                r.selectNodeContents(n);
                const intersects =
                range.compareBoundaryPoints(Range.END_TO_START, r) < 0 &&
                range.compareBoundaryPoints(Range.START_TO_END, r) > 0;
                return intersects ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        }
    );

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    for (const tn of textNodes) {
        const start = (tn === range.startContainer) ? range.startOffset : 0;
        const end = (tn === range.endContainer) ? range.endOffset : tn.nodeValue.length;
        if (start >= end) continue;

        const selectedText = tn.splitText(start);
        selectedText.splitText(end - start);

        const mark = document.createElement("mark");
        mark.setAttribute("data-my-hl", "1");
        mark.setAttribute("data-hl-id", id);

        selectedText.parentNode.insertBefore(mark, selectedText);
        mark.appendChild(selectedText);
    }
}

function clearRenderedHighlights() {
    // Clear CSS Highlight API
    if ("highlights" in CSS) {
        try { CSS.highlights.delete(HIGHLIGHT_NAME); } catch {}
    }

    // Remove DOM-wrapped marks
    document.querySelectorAll('mark[data-my-hl="1"]').forEach((m) => unwrapMark(m));
}

async function clearHighlights() {
    clearRenderedHighlights();
    cache = [];
    await saveForThisPage(cache);
}

// Used after importing JSON into storage
async function reloadFromStorage() {
    clearRenderedHighlights();
    cache = await loadForThisPage();
    reapplyAll(cache);
}

function serialiseRangeToHtml(range) {
    const frag = range.cloneContents(); // preserves inline markup inside selection
    const container = document.createElement("div");
    container.appendChild(frag);

    // Make links absolute and safe in the exported file
    container.querySelectorAll("a[href]").forEach(a => {
        const href = a.getAttribute("href");
        if (!href) return;
        try { a.setAttribute("href", new URL(href, location.href).href); } catch {}
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
    });

    sanitiseExport(container);
    return container.innerHTML;
}

function sanitiseExport(root) {
    // Remove obviously risky elements
    root.querySelectorAll("script, iframe, object, embed").forEach(el => el.remove());

    // Strip inline event handlers and javascript: URLs
    root.querySelectorAll("*").forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = String(attr.value || "");
            if (name.startsWith("on")) el.removeAttribute(attr.name);
            if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
                el.removeAttribute(attr.name);
            }
        }
    });
}

import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v2.0.0 loaded: PromptForge");

const API = "/geniusewzq/promptforge";

/* 标签英文名 -> 中文名缓存（跨节点共用） */
const ZH = new Map();
const LVL = new Map();
const pendingLookup = new Set();

function css(el, style) {
    Object.assign(el.style, style);
    return el;
}

/* ---------------- Nodes 2.0 主题：全部走 ComfyUI 的设计变量，深浅色自动跟随 ---------------- */
const PF_STYLE_ID = "gswq-pf-theme";
function ensurePfTheme() {
    if (typeof document === "undefined" || document.getElementById(PF_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = PF_STYLE_ID;
    st.textContent = `
.pf-panel {
    padding: 4px 6px 6px;
    gap: 5px;
    --pf-fg: var(--node-foreground, #d2d2d2);
    --pf-muted: var(--muted-foreground, #8a8a8a);
    --pf-bd: var(--node-border, #4e4e4e);
    --pf-accent: var(--primary, #7f9fbf);
    --pf-radius: var(--radius-md, 4px);
    --pf-input-bg: var(--comfy-input-bg, #222);
    --pf-input-fg: var(--input-text, #e2e2e2);
    --pf-btn-bg: var(--secondary-background, #2b2b2b);
    --pf-btn-bg-h: var(--secondary-background-hover, #3a3a3a);
    --pf-panel-bg: #353535;
    --pf-font-size: 11px;
    --pf-ed-font-size: 11px;
    color: var(--pf-fg);
    font-size: var(--pf-font-size);
}
.pf-panel.pf-vue {
    --pf-panel-bg: transparent;
    --pf-font-size: 12px;
    --pf-ed-font-size: 12px;
    padding: 2px 8px 8px 4px;
    gap: 4px;
}
.pf-panel.pf-canvas { --pf-panel-bg: #353535; }
.pf-btn {
    font-family: inherit;
    border: 1px solid var(--pf-bd);
    border-color: color-mix(in srgb, var(--pf-bd) 80%, transparent);
    background: var(--pf-btn-bg);
    color: var(--pf-fg);
    border-radius: var(--pf-radius);
    transition: background .12s ease, border-color .12s ease;
}
.pf-btn:hover { background: var(--pf-btn-bg-h); }
.pf-btn:active { transform: translateY(1px); }
.pf-btn.pf-primary {
    background: color-mix(in srgb, var(--pf-accent) 20%, var(--pf-btn-bg));
    border-color: color-mix(in srgb, var(--pf-accent) 45%, var(--pf-bd));
}
.pf-btn.pf-primary:hover { background: color-mix(in srgb, var(--pf-accent) 30%, var(--pf-btn-bg)); }
.pf-ed {
    background: var(--pf-input-bg);
    color: var(--pf-input-fg);
    border: 1px solid var(--pf-bd);
    border-color: color-mix(in srgb, var(--pf-bd) 70%, transparent);
    border-radius: var(--pf-radius);
    font-family: var(--font-sans, Inter, system-ui, sans-serif);
    transition: border-color .12s ease, box-shadow .12s ease;
}
.pf-ed:focus {
    border-color: var(--pf-accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--pf-accent) 45%, transparent);
}
.pf-chip {
    background: color-mix(in srgb, var(--pf-accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--pf-accent) 32%, transparent);
    color: var(--pf-fg);
}
.pf-chip.pf-hard {
    background: color-mix(in srgb, #ff7ab6 16%, transparent);
    border-color: color-mix(in srgb, #ff7ab6 38%, transparent);
}
.pf-chip .pf-en, .pf-chip .pf-x { color: var(--pf-muted); }
.pf-chip .pf-x:hover { color: var(--pf-fg); }
.pf-split { background: transparent; border: 0; }
.pf-grip { background: var(--pf-bd); }
.pf-split:hover .pf-grip { background: var(--pf-accent); }
.pf-status { color: var(--pf-muted); }
`;
    document.head.appendChild(st);
}

function getWidget(node, name) {
    return node.widgets && node.widgets.find((w) => w.name === name);
}

const SKILLS = ["人像摄影", "景别", "镜头逻辑", "人物关系", "光影", "构图", "色彩",
    "质感", "动作", "镜头", "服装", "场景", "情绪", "材质", "表情", "天气", "时间", "背景", "视角"];
function extrasOf(node) {
    const v = (node.properties || {}).pf_extras;
    /* 侧重默认不选：没存过就是空，点哪个算哪个 */
    return Array.isArray(v) ? v.filter((x) => SKILLS.includes(x)) : [];
}

function setting(node, name, fallback) {
    const w = getWidget(node, name);
    return w ? w.value : fallback;
}

async function post(path, body) {
    const r = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    return await r.json();
}

async function getJson(path) {
    const r = await fetch(API + path);
    return await r.json();
}

const DEFAULT_BASE = "https://api.deepseek.com/v1";
const DEFAULT_BASE_LOCAL = "http://127.0.0.1:8080/v1";

const svcOf = (node) => String(setting(node, "服务", "") || "本地 llama.cpp");

function apiOf(node) {
    const all = (node && node.properties && node.properties.pf_api) || {};
    const cur = all[svcOf(node)] || {};
    return { base: String(cur.base || ""), model: String(cur.model || "") };
}

function apiSet(node, svc, value) {
    node.properties = node.properties || {};
    const all = node.properties.pf_api || {};
    all[svc] = value;
    node.properties.pf_api = all;
}

function pingGet(node, svc) {
    const all = (node && node.properties && node.properties.pf_ping) || {};
    return all[svc] || null;
}

function pingSet(node, svc, value) {
    node.properties = node.properties || {};
    const all = node.properties.pf_ping || {};
    all[svc] = value;
    node.properties.pf_ping = all;
}

/* 规范卡片缓存（/meta 里的 skill_cards）：把下拉里的模型名换成具体写法 */
let pfCards = null;
async function loadSkillCards() {
    if (pfCards) return pfCards;
    try {
        const d = await getJson("/meta");
        if (d && d.ok) pfCards = d.skill_cards || [];
    } catch (e) { /* 后端还没起来就让 outTag 走名字兜底 */ }
    return pfCards || [];
}

function skillCardOf(node) {
    const v = String(setting(node, "目标模型", "") || "");
    const cards = pfCards || [];
    for (const c of cards) {
        if (c.name === v || c.title === v || c.target === v) return c;
    }
    return null;
}

/* tag 写入形式：illustrious / pony 体系用下划线，其它模型用空格 */
function outTag(node, tag) {
    const card = skillCardOf(node);
    if (card) return /underscore/i.test(card.tag_format || "") ? tag : tag.replace(/_/g, " ");
    const skill = String(setting(node, "目标模型", "") || "");
    return /illustrious|pony/i.test(skill) ? tag : tag.replace(/_/g, " ");
}

function getText(node) {
    const w = getWidget(node, "提示词");
    return (w && w.value) || "";
}

function setText(node, value) {
    const w = getWidget(node, "提示词");
    if (!w) return;
    w.value = value;
    if (w.inputEl) w.inputEl.value = value;
    node.setDirtyCanvas(true, true);
}

function lookup(tags) {
    const need = [];
    tags.forEach((t) => {
        if (t && !ZH.has(t) && !pendingLookup.has(t)) {
            pendingLookup.add(t);
            need.push(t);
        }
    });
    if (!need.length) return Promise.resolve(false);
    return post("/lookup", { tags: need.slice(0, 300) })
        .then((d) => {
            if (!d || !d.ok) return false;
            Object.keys(d.map || {}).forEach((k) => ZH.set(k, d.map[k] || ""));
            Object.keys(d.lvl || {}).forEach((k) => LVL.set(k, Number(d.lvl[k] || 0)));
            return true;
        })
        .catch(() => false);
}

/* ---------------- 面板 ---------------- */

function buildUI(node, hooks = {}) {
    ensurePfTheme();
    const root = css(document.createElement("div"), {
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
        fontSize: "var(--pf-font-size, 11px)",
        color: "var(--pf-fg, #d2d2d2)",
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--pf-panel-bg, #353535)",
    });
    root.className = "pf-panel pf-canvas";
    /* Nodes 2.0：卡片自带底色与圆角，面板让位；经典画布：保留原来的面板底色 */
    const applyPfMode = () => {
        const vue = !!(root.isConnected && root.closest(".lg-node"));
        root.classList.toggle("pf-vue", vue);
        root.classList.toggle("pf-canvas", !vue);
        return vue;
    };
    root.__pfApplyMode = applyPfMode;
    applyPfMode();

    const mkBtn = (label, opts) => {
        const o = opts || {};
        const b = document.createElement("button");
        b.textContent = label;
        b.className = "pf-btn" + (o.primary ? " pf-primary" : "");
        css(b, {
            flex: o.flex || "0 0 auto",
            height: "22px",
            padding: "0 8px",
            borderRadius: "var(--pf-radius, 3px)",
            fontSize: "11px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            lineHeight: "1",
        });
        b.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        return b;
    };

    const mkCheck = (label, checked) => {
        const lab = css(document.createElement("label"), {
            display: "flex", alignItems: "center", gap: "3px",
            fontSize: "10px", color: "var(--pf-fg, #bfbfbf)", cursor: "pointer", whiteSpace: "nowrap",
        });
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !!checked;
        css(box, { margin: "0", accentColor: "var(--pf-accent, #7f9fbf)", cursor: "pointer" });
        const txt = document.createTextNode(label);
        lab.appendChild(box);
        lab.appendChild(txt);
        lab.addEventListener("pointerdown", (e) => e.stopPropagation());
        return { lab, box, txt };
    };

    /* --- 工具行：API / 收藏 / 收藏夹 / 翻译 / 优化 / 扩写 挤成一行 --- */
    const toolRow = css(document.createElement("div"), {
        display: "flex", alignItems: "center", gap: "4px",
        flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden", flex: "0 0 auto",
    });
    toolRow.className = "pf-tools";
    const mkToolBtn = (label, title, primary) => {
        const b = mkBtn(label, { primary });
        b.title = title || "";
        css(b, { fontSize: "10px", height: "20px", padding: "0 5px", flex: "0 0 auto" });
        return b;
    };
    const btnApi = mkToolBtn("⚙ API", "接口设置与连通性测试");
    const btnFav = mkToolBtn("★ 收藏", "把下面的输出提示词存进收藏夹");
    const btnFavList = mkToolBtn("收藏夹 0 ▾", "打开收藏夹");
    const btnTr = mkToolBtn("翻译", "把输出提示词翻译成英文标签");
    const btnOpt = mkToolBtn("✦ 优化提示词", "按你的要求 + 目标模型的规则重写", true);
    const btnExp = mkToolBtn("✦ 深度扩写", "按你的要求 + 目标模型的规则扩写细节");
    const btnRand = mkToolBtn("🎲 随机", "随机拼一串：每个小类只出一个");
    toolRow.append(btnApi, btnFav, btnFavList, btnTr, btnOpt, btnExp);

    /* --- 提示词要求：用户意图，和下面的输出提示词分开两块 --- */
    const reqLab = css(document.createElement("div"), {
        display: "flex", alignItems: "baseline", gap: "5px", flex: "0 0 auto",
        fontSize: "10px", lineHeight: "13px",
    });
    const reqLabTxt = document.createElement("span");
    reqLabTxt.textContent = "提示词要求";
    reqLabTxt.style.color = "var(--node-foreground, #cfd6d6)";
    const reqLabHint = document.createElement("span");
    reqLabHint.textContent = "写你要什么，越具体越准；留空则随机创作";
    reqLabHint.style.color = "var(--muted-foreground, #8a8a8a)";
    reqLab.append(reqLabTxt, reqLabHint);
    const req = document.createElement("textarea");
    req.className = "pf-req";
    req.placeholder = "例：保持图 1 人物一致，角色展示图，半身，看向镜头，冷色灯光";
    req.value = String((node.properties || {}).pf_req || "");
    css(req, {
        height: "100%", minHeight: "0", width: "100%", boxSizing: "border-box",
        resize: "none", overflowY: "auto", padding: "4px 6px", borderRadius: "3px",
        border: "1px solid var(--node-border, #4e4e4e)", background: "var(--comfy-input-bg, #222)",
        color: "var(--input-text, #e2e2e2)", fontFamily: "inherit", fontSize: "11px",
        lineHeight: "1.5", outline: "none",
    });
    /* 外面套一层：textarea 不能有子元素，手柄只能挂在包裹层右下角 */
    const reqWrap = css(document.createElement("div"), {
        position: "relative", flex: "0 0 auto", width: "100%", height: "54px", boxSizing: "border-box",
    });
    reqWrap.className = "pf-req-wrap";
    reqWrap.appendChild(req);
    req.addEventListener("pointerdown", (e) => e.stopPropagation());
    req.addEventListener("input", () => {
        node.properties = node.properties || {};
        node.properties.pf_req = req.value;
        node.setDirtyCanvas(true, false);
    });
    /* 要求框的高度由它下方的拖拽条控制，存 pf_req_h */
    const reqH = () => {
        const v = Number((node.properties || {}).pf_req_h || 54);
        return Math.max(32, Math.min(420, v));
    };
    reqWrap.style.height = reqH() + "px";
    const reqEntry = () => String(req.value || "").trim();
    /* 标签库的点选 / 随机都只写进「提示词要求」，不再动下面的输出提示词 */
    const appendTagToReq = (tag) => {
        const cur = String(req.value || "");
        const pos = (typeof req.selectionStart === "number" && req.selectionStart >= 0) ? req.selectionStart : cur.length;
        const before = cur.slice(0, pos);
        const after = cur.slice(pos);
        const sepBefore = !before || /[,，\s]$/.test(before) ? "" : ", ";
        const sepAfter = !after || /^[,，\s]/.test(after) ? "" : " ";
        req.value = before + sepBefore + tag + sepAfter + after;
        node.properties = node.properties || {};
        node.properties.pf_req = req.value;
        try {
            const caret = (before + sepBefore + tag).length;
            req.focus();
            req.setSelectionRange(caret, caret);
        } catch (e) { /* 光标定位失败不影响写入 */ }
        if (afterSync) afterSync();
        node.setDirtyCanvas(true, false);
    };
    const outLab = css(document.createElement("div"), {
        fontSize: "10px", lineHeight: "13px", flex: "0 0 auto",
        color: "var(--muted-foreground, #8a8a8a)",
    });
    outLab.textContent = "输出提示词 · 可直接编辑 / 收藏 / 出图用";

    /* --- 编辑器 --- */
    const ed = css(document.createElement("div"), {
        flex: "0 0 auto",
        height: "100%",
        minHeight: "0",
        boxSizing: "border-box",
        overflowY: "auto",
        padding: "5px 7px",
        fontSize: "var(--pf-ed-font-size, 11px)",
        lineHeight: "1.65",
        outline: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        cursor: "text",
    });
    ed.className = "pf-ed";
    ed.contentEditable = "true";
    ed.spellcheck = false;
    ed.addEventListener("pointerdown", (e) => e.stopPropagation());

    /* 输出区也套一层：手柄挂在框外，免得被 contentEditable 吃进正文 */
    const edWrap = css(document.createElement("div"), {
        position: "relative", flex: "0 1 auto", width: "100%", height: "96px",
        minHeight: "44px", boxSizing: "border-box",
    });
    edWrap.className = "pf-ed-wrap";
    ed.style.height = "100%";
    edWrap.appendChild(ed);

    /* --- 文本框右下角拖拽手柄：改输入框大小的同时带着节点一起变，避免其它功能被挤出 --- */
    const attachCorner = (el, opts) => {
        const o = opts || {};
        const grip = css(document.createElement("div"), {
            position: "absolute", right: "3px", bottom: "3px",
            width: "12px", height: "12px", cursor: "nwse-resize", zIndex: "6",
            background: "linear-gradient(135deg, transparent 0 44%, var(--pf-muted, #8a8a8a) 44% 52%, transparent 52% 68%, var(--pf-muted, #8a8a8a) 68% 76%, transparent 76%)",
            opacity: "0.8", borderRadius: "2px",
        });
        grip.className = "pf-corner";
        grip.title = o.title || "拖动改变输入框大小";
        grip.addEventListener("pointerdown", (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.stopPropagation(); e.preventDefault();
            const pointerId = e.pointerId;
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = Math.round(node.size[0]);
            const startH = Math.round(node.size[1]);
            const startBoxH = el.offsetHeight;
            el.style.flex = "0 0 auto";
            el.style.height = startBoxH + "px";
            const minH = o.minH || 30;
            let ended = false;
            const move = (ev) => {
                if (ended) return;
                const dy = ev.clientY - startY;
                const dx = ev.clientX - startX;
                const boxH = Math.max(minH, Math.round(startBoxH + dy));
                el.style.height = boxH + "px";
                if (o.onResize) o.onResize(boxH);
                /* 高度差同步到节点：下面的内容整体下移、自身高度不变；宽度差同步到节点宽度 */
                const nodeH = Math.max(200, startH + (boxH - startBoxH));
                /* 横向 4px 以内当作手抖，避免只想改高度时把节点拖宽 */
                const nodeW = Math.abs(dx) > 4 ? Math.max(260, Math.round(startW + dx)) : startW;
                if (Math.abs(node.size[1] - nodeH) > 0.5 || Math.abs(node.size[0] - nodeW) > 0.5) {
                    try { node.setSize([nodeW, nodeH]); } catch (err) { /* ignore */ }
                }
            };
            const finish = () => {
                if (ended) return;
                ended = true;
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("pointerup", finish);
                grip.removeEventListener("pointercancel", finish);
                grip.removeEventListener("lostpointercapture", finish);
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", finish);
                window.removeEventListener("pointercancel", finish);
                window.removeEventListener("blur", finish);
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
                try {
                    if (pointerId != null && grip.hasPointerCapture && grip.hasPointerCapture(pointerId)) {
                        grip.releasePointerCapture(pointerId);
                    }
                } catch (err) { /* 释放失败也不影响后续拖拽 */ }
                node.properties = node.properties || {};
                if (o.store) node.properties[o.store] = Math.round(el.offsetHeight);
                node.setDirtyCanvas(true, true);
            };
            try {
                if (pointerId != null && grip.setPointerCapture) grip.setPointerCapture(pointerId);
            } catch (err) { /* 有些环境不支持捕获，退回 window 监听 */ }
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", finish);
            grip.addEventListener("pointercancel", finish);
            grip.addEventListener("lostpointercapture", finish);
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", finish);
            window.addEventListener("pointercancel", finish);
            window.addEventListener("blur", finish);
            document.body.style.userSelect = "none";
            document.body.style.cursor = "nwse-resize";
        });
        el.appendChild(grip);
        return grip;
    };
    attachCorner(reqWrap, { minH: 34, store: "pf_req_h", title: "拖动改变「提示词要求」大小（左右拖会带动节点宽度）" });
    attachCorner(edWrap, { minH: 44, store: "pf_ed_h", title: "拖动改变「输出提示词」大小（左右拖会带动节点宽度）" });

    /* --- 侧重（可多选，选中项会作为重点写进 system prompt） --- */
    /* 侧重：一行放不下就换行（不再横向滚动把后半截抹掉）；
       万一节点被拖得很矮，这一行也是唯一可以让步的块，用纵向滚动兜底 */
    const skRow = css(document.createElement("div"), {
        display: "flex", flexWrap: "wrap", gap: "3px 4px", overflow: "visible",
        alignItems: "center", alignContent: "flex-start", minHeight: "20px", flex: "0 0 auto",
    });
    skRow.className = "pf-skrow";
    const skLabel = css(document.createElement("span"), {
        fontSize: "10px", color: "var(--muted-foreground, #8a8a8a)", flex: "0 0 auto",
    });
    skLabel.textContent = "侧重";
    skRow.appendChild(skLabel);
    const skBtns = new Map();
    const paintSkills = () => {
        const on = new Set(extrasOf(node));
        skBtns.forEach((b, name) => {
            const active = on.has(name);
            b.style.background = active ? "var(--accent, #2f4048)" : "var(--secondary-background, #2b2b2b)";
            b.style.borderColor = active ? "var(--primary, #5f8f8f)" : "var(--node-border, #464646)";
            b.style.color = active ? "var(--node-foreground, #cfe6e6)" : "var(--muted-foreground, #a9a9a9)";
        });
    };
    SKILLS.forEach((name) => {
        const b = css(document.createElement("button"), {
            fontSize: "10px", lineHeight: "15px", padding: "0 5px", flex: "0 0 auto",
            background: "var(--secondary-background, #2b2b2b)", border: "1px solid var(--node-border, #464646)", borderRadius: "3px",
            color: "var(--muted-foreground, #a9a9a9)", cursor: "pointer", whiteSpace: "nowrap",
        });
        b.textContent = name;
        b.onclick = () => {
            const on = new Set(extrasOf(node));
            if (on.has(name)) on.delete(name); else on.add(name);
            node.properties.pf_extras = SKILLS.filter((x) => on.has(x));
            paintSkills();
        };
        skBtns.set(name, b);
        skRow.appendChild(b);
    });
    paintSkills();

    const status = css(document.createElement("div"), {
        minHeight: "13px", fontSize: "10px", color: "var(--pf-muted, #6f6f6f)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    });
    status.className = "pf-status";

    const top = css(document.createElement("div"), {
        display: "flex", flexDirection: "column", gap: "5px",
        flex: "1 1 auto", minHeight: "0", overflow: "hidden",
    });
    top.append(reqLab, reqWrap, toolRow, skRow, outLab, edWrap, status);
    root.appendChild(top);

    /* ---------------- 编辑器逻辑 ---------------- */

    let refresh = () => {};

    const makeChip = (tag, lvl) => {
        const zh = ZH.get(tag) || "";
        const hard = Number(lvl == null ? (LVL.get(tag) || 0) : lvl) >= 2;
        const c = document.createElement("span");
        c.contentEditable = "false";
        c.dataset.tag = tag;
        c.dataset.lvl = hard ? "2" : "0";
        c.className = "pf-chip" + (hard ? " pf-hard" : "");
        css(c, {
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "1px 5px", margin: "2px 2px",
            borderRadius: "calc(var(--pf-radius, 4px) * 0.8)",
            fontSize: "10px", lineHeight: "15px",
            verticalAlign: "baseline", cursor: "default", userSelect: "none",
        });
        const name = document.createElement("span");
        name.textContent = zh || tag;
        name.title = tag;
        const en = document.createElement("span");
        en.textContent = tag;
        en.className = "pf-en";
        css(en, { fontSize: "9px" });
        const x = document.createElement("span");
        x.textContent = "✕";
        x.title = "删除这个标签";
        x.className = "pf-x";
        css(x, { cursor: "pointer", fontSize: "9px", padding: "0 1px" });
        x.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            c.remove();
            sync();
        });
        c.append(name, en, x);
        if (!zh) name.style.color = "var(--pf-muted, #9fb9c6)";
        return c;
    };

    const parts = () => {
        const list = [];
        ed.childNodes.forEach((n) => {
            if (n.nodeType === 3) {
                const t = n.textContent.replace(/^[\s,，、]+|[\s,，、]+$/g, "");
                if (t) list.push(t);
            } else if (n.nodeType === 1 && n.dataset && n.dataset.tag) {
                list.push(n.dataset.tag);
            }
        });
        return list;
    };

    const serialize = () => parts().join(", ");

    let afterSync = null;
    const sync = () => {
        const v = serialize();
        setText(node, v);
        refresh();
        if (afterSync) afterSync();
    };

    const render = (text) => {
        ed.innerHTML = "";
        const toks = String(text || "")
            .split(/[,，\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
        toks.forEach((t, i) => {
            const asTag = t.replace(/\s+/g, "_");
            if (/^[A-Za-z0-9_'()\-]+$/.test(asTag) && ZH.has(asTag)) {
                ed.appendChild(makeChip(asTag));
            } else {
                ed.appendChild(document.createTextNode(t));
            }
            if (i < toks.length - 1) ed.appendChild(document.createTextNode("，"));
        });
        if (!ed.childNodes.length) {
            ed.appendChild(document.createTextNode(""));
        }
    };

    /* 库里没有中文的，现场机翻一次（服务端缓存进 zh_extra） */
    const zhTried = new Set();
    const fillZh = (tags) => {
        const miss = (tags || [])
            .filter((t) => t && !ZH.has(t) && !zhTried.has(t))
            .slice(0, 12);
        if (!miss.length) return Promise.resolve(false);
        miss.forEach((t) => zhTried.add(t));
        return post("/zh_fill", { tags: miss })
            .then((d) => {
                const map = (d && d.ok && d.map) || {};
                let n = 0;
                Object.keys(map).forEach((k) => {
                    if (map[k]) { ZH.set(k, map[k]); n += 1; }
                });
                return n > 0;
            })
            .catch(() => false);
    };

    /* 把未知的英文词补查中文后重渲染 */
    const enrichThenRender = (text) => {
        const toks = String(text || "").split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
        const candidates = toks
            .map((t) => t.replace(/\s+/g, "_"))
            .filter((t) => /^[A-Za-z0-9_'()\-]+$/.test(t));
        lookup(candidates).then((changed) => {
            if (changed) return render(getText(node) || serialize());
            return fillZh(candidates).then((got) => {
                render(getText(node) || serialize());
                return got;
            });
        });
    };

    const placeCaret = (target, off) => {
        try {
            const r = document.createRange();
            r.setStart(target, off || 0);
            r.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
        } catch (e) { /* ignore */ }
    };

    const caretToken = () => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const r = sel.getRangeAt(0);
        if (!r.collapsed) return null;
        const n = r.startContainer;
        if (n.nodeType !== 3) return null;
        const before = n.textContent.slice(0, r.startOffset);
        const cut = Math.max(
            before.lastIndexOf(","), before.lastIndexOf("，"),
            before.lastIndexOf("、"), before.lastIndexOf("\n"), before.lastIndexOf(" ")
        );
        const tok = before.slice(cut + 1);
        if (!tok.trim()) return null;
        return { node: n, end: r.startOffset, text: tok.trim() };
    };

    const ensureSep = (chipEl) => {
        const prev = chipEl.previousSibling;
        if (prev && prev.nodeType === 3) {
            const d = prev.textContent;
            if (d && !/[,，、\s]$/.test(d)) prev.textContent = d + "，";
        }
    };

    const insertChip = (tag, tk, sub) => {
        const chipEl = makeChip(tag);
        if (tk && sub && tk.text.endsWith(sub)) {
            const r = document.createRange();
            r.setStart(tk.node, tk.end - sub.length);
            r.setEnd(tk.node, tk.end);
            r.deleteContents();
            r.insertNode(chipEl);
        } else {
            const sel = window.getSelection();
            if (sel && sel.rangeCount) {
                const r = sel.getRangeAt(0);
                r.deleteContents();
                r.insertNode(chipEl);
            } else {
                ed.appendChild(chipEl);
            }
        }
        ensureSep(chipEl);
        const sp = document.createTextNode(" ");
        chipEl.after(sp);
        placeCaret(sp, 1);
        sync();
    };

    const appendChip = (tag, lvl) => {
        let last = ed.lastChild;
        if (last && last.nodeType === 3) {
            const d = last.textContent;
            if (d && !/[,，、\s]$/.test(d)) last.textContent = d + "，";
        }
        ed.appendChild(makeChip(tag));
        const sp = document.createTextNode(" ");
        ed.appendChild(sp);
        placeCaret(sp, 1);
        ed.focus();
        sync();
    };

    /* ---- 联想下拉（挂在 body 上，避免被节点裁掉） ---- */
    let sugBox = null;
    let sugItems = [];
    let sugSub = "";
    let sugTarget = null;

    const hideSug = () => {
        if (sugBox) {
            sugBox.remove();
            sugBox = null;
        }
        sugItems = [];
        sugSub = "";
        sugTarget = null;
    };

    const showSug = (rows, sub, tk) => {
        hideSug();
        if (!rows || !rows.length) return;
        sugItems = rows;
        sugSub = sub || "";
        sugTarget = tk;
        const sel = window.getSelection();
        let rect = null;
        if (sel && sel.rangeCount) {
            const rr = sel.getRangeAt(0).cloneRange();
            rr.collapse(true);
            const rects = rr.getClientRects();
            rect = rects[rects.length - 1] || rr.getBoundingClientRect();
        }
        const box = css(document.createElement("div"), {
            position: "fixed",
            zIndex: "10000",
            minWidth: "150px",
            maxWidth: "300px",
            background: "var(--comfy-input-bg, #232323)",
            border: "1px solid var(--node-border, #5a5a5a)",
            borderRadius: "4px",
            boxShadow: "0 6px 18px rgba(0,0,0,.55)",
            padding: "3px",
            display: "flex",
            flexDirection: "column",
            gap: "1px",
        });
        rows.forEach((r, i) => {
            const tag = r[0];
            const zh = r[1] || "";
            const item = css(document.createElement("div"), {
                display: "flex", alignItems: "center", gap: "6px",
                padding: "2px 6px", borderRadius: "3px", cursor: "pointer",
                fontSize: "11px", color: "var(--node-foreground, #dcdcdc)", whiteSpace: "nowrap",
            });
            const a = document.createElement("span");
            a.textContent = zh || tag;
            const b = document.createElement("span");
            b.textContent = tag;
            css(b, { fontSize: "9px", color: "var(--muted-foreground, #8b9aa4)", marginLeft: "auto" });
            item.append(a, b);
            item.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                insertChip(tag, sugTarget, sugSub);
                hideSug();
            });
            item.addEventListener("pointerenter", () => { item.style.background = "var(--accent, #333)"; });
            item.addEventListener("pointerleave", () => { item.style.background = "transparent"; });
            box.appendChild(item);
        });
        document.body.appendChild(box);
        sugBox = box;
        const W = window.innerWidth;
        const H = window.innerHeight;
        let x = rect ? rect.left : 100;
        let y = rect ? rect.bottom + 2 : 120;
        const bw = box.offsetWidth;
        const bh = box.offsetHeight;
        if (x + bw > W - 8) x = Math.max(8, W - bw - 8);
        if (y + bh > H - 8) y = Math.max(8, (rect ? rect.top : 120) - bh - 2);
        box.style.left = x + "px";
        box.style.top = y + "px";
    };

    let sugTimer = null;
    const askSuggest = () => {
        return hideSug();   /* 联想功能已移除，这里直接收起 */
        const tk = caretToken();
        if (!tk) return hideSug();
        const isCjk = /[\u4e00-\u9fff]/.test(tk.text);
        clearTimeout(sugTimer);
        sugTimer = setTimeout(async () => {
            try {
                const levels = state.nsfw ? [0, 1, 2] : [0, 1];
                if (isCjk) {
                    const d = await post("/suggest", { token: tk.text, levels, limit: 8 });
                    if (!d.ok) return;
                    showSug(d.rows, d.sub, tk);
                } else {
                    const d = await post("/search_tags", { q: tk.text, grp: "", limit: 8, hot: false, levels });
                    if (!d.ok) return;
                    showSug(d.rows, tk.text, tk);
                }
            } catch (e) { /* ignore */ }
        }, 160);
    };

    /* 打完一个词（空格 / 逗号 / 顿号）就自动转成标签块 */
    let converting = false;
    const autoConvert = () => {
        if (converting) return;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const r = sel.getRangeAt(0);
        if (!r.collapsed || r.startContainer.nodeType !== 3) return;
        const n = r.startContainer;
        const before = n.textContent.slice(0, r.startOffset);
        const m = before.match(/([A-Za-z0-9_'()\-]+)[\s,，、]$/);
        if (!m) return;
        const tag = m[1];
        if (!ZH.has(tag)) {
            converting = true;
            lookup([tag]).then((ok) => {
                converting = false;
                if (ok) autoConvert();
            });
            return;
        }
        converting = true;
        const start = r.startOffset - tag.length - 1;
        const range = document.createRange();
        range.setStart(n, start);
        range.setEnd(n, r.startOffset);
        range.deleteContents();
        const chipEl = makeChip(tag);
        range.insertNode(chipEl);
        ensureSep(chipEl);
        const sp = document.createTextNode(" ");
        chipEl.after(sp);
        placeCaret(sp, 1);
        converting = false;
        sync();
    };

    ed.addEventListener("input", () => {
        setText(node, serialize());
        askSuggest();
        setTimeout(autoConvert, 30);
    });

    ed.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            hideSug();
            return;
        }
        if (e.key === "Enter" && sugBox && sugItems.length) {
            e.preventDefault();
            insertChip(sugItems[0][0], sugTarget, sugSub);
            hideSug();
            return;
        }
        if (e.key === "Backspace" && !e.ctrlKey && !e.altKey) {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed && sel.rangeCount) {
                const r = sel.getRangeAt(0);
                const off = r.startOffset;
                const n = r.startContainer;
                if (n.nodeType === 3 && off === 0) {
                    const prev = n.previousSibling;
                    if (prev && prev.dataset && prev.dataset.tag) {
                        e.preventDefault();
                        prev.remove();
                        sync();
                        return;
                    }
                }
            }
        }
        if (e.key === "Enter" && !sugBox) {
            e.preventDefault();
            document.execCommand("insertText", false, "\n");
            sync();
        }
    });

    ed.addEventListener("blur", () => setTimeout(hideSug, 120));

    /* ---- 按钮：随机 / 收藏 ---- */

    btnRand.addEventListener("click", async () => {
        try {
            say("随机中…");
            const d = await post("/random", { nsfw: state.nsfw, count: 10 });
            if (!d.ok) throw new Error(d.error);
            const rows = d.rows || [];
            if (!rows.length) throw new Error("词库没数据");
            rows.forEach((r) => { if (r[1]) ZH.set(r[0], r[1]); if (r[4] != null) LVL.set(r[0], Number(r[4] || 0)); });
            /* 随机结果只写进「提示词要求」 */
            req.value = rows.map((r) => r[0]).join(", ");
            node.properties = node.properties || {};
            node.properties.pf_req = req.value;
            if (afterSync) afterSync();
            node.setDirtyCanvas(true, false);
            say("随机生成 · " + rows.length + " 个标签（已写入提示词要求）" + (state.nsfw ? " · NSFW 倾向" : ""), "#c9a227");
        } catch (e) {
            say("随机失败：" + String(e.message || e), "#ff6b6b");
        }
    });

    const favMenu = css(document.createElement("div"), {
        position: "fixed", zIndex: "10000", display: "none",
        minWidth: "220px", maxWidth: "360px", maxHeight: "260px", overflowY: "auto",
        background: "var(--comfy-input-bg, #232323)", border: "1px solid var(--node-border, #5a5a5a)", borderRadius: "4px",
        boxShadow: "0 6px 18px rgba(0,0,0,.55)", padding: "3px",
        flexDirection: "column", gap: "1px",
    });
    document.body.appendChild(favMenu);

    const refreshFavCount = async () => {
        try {
            const d = await getJson("/fav_list");
            if (d.ok) btnFavList.textContent = "收藏夹 " + (d.items || []).length + " ▾";
        } catch (e) { /* ignore */ }
    };

    btnFav.addEventListener("click", async () => {
        const text = serialize();
        if (!text) return say("框里没东西可收藏", "#c9a227");
        try {
            const d = await post("/fav_add", { text });
            if (!d.ok) throw new Error(d.error);
            btnFavList.textContent = "收藏夹 " + (d.items || []).length + " ▾";
            say("已收藏", "#7fbf7f");
        } catch (e) {
            say("收藏失败：" + String(e.message || e), "#ff6b6b");
        }
    });

    btnFavList.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (favMenu.style.display === "flex") {
            favMenu.style.display = "none";
            return;
        }
        try {
            const d = await getJson("/fav_list");
            const items = (d && d.items) || [];
            btnFavList.textContent = "收藏夹 " + items.length + " ▾";
            favMenu.innerHTML = "";
            if (!items.length) {
                const t = document.createElement("div");
                t.textContent = "还没有收藏";
                css(t, { fontSize: "11px", color: "var(--muted-foreground, #8a8a8a)", padding: "4px 6px" });
                favMenu.appendChild(t);
            }
            items.forEach((it, i) => {
                /* 老版本收藏可能存的是纯字符串，两种都认 */
                const txt = typeof it === "string" ? it : ((it && it.text) || "");
                const row = css(document.createElement("div"), {
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "3px 6px", borderRadius: "3px", cursor: "pointer", fontSize: "11px",
                });
                const a = document.createElement("span");
                a.textContent = txt.slice(0, 40) || "(空)";
                css(a, { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--node-foreground, #dcdcdc)" });
                const x = document.createElement("span");
                x.textContent = "✕";
                css(x, { color: "var(--muted-foreground, #8a8a8a)", cursor: "pointer", padding: "0 2px" });
                x.addEventListener("pointerdown", async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const del = await post("/fav_del", { index: i });
                    /* 删完立刻把数量改对，再重新拉一遍列表 */
                    if (del && Array.isArray(del.items)) {
                        btnFavList.textContent = "收藏夹 " + del.items.length + " ▾";
                    }
                    favMenu.style.display = "none";
                    btnFavList.click();
                });
                row.append(a, x);
                row.addEventListener("pointerdown", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    render(txt);
                    sync();
                    favMenu.style.display = "none";
                });
                row.addEventListener("pointerenter", () => { row.style.background = "var(--accent, #333)"; });
                row.addEventListener("pointerleave", () => { row.style.background = "transparent"; });
                favMenu.appendChild(row);
            });
            /* 先显示再量尺寸：await 之后 e.currentTarget 已经是 null，不能再用它 */
            favMenu.style.display = "flex";
            const rc = btnFavList.getBoundingClientRect();
            const mw = favMenu.offsetWidth;
            const mh = favMenu.offsetHeight;
            favMenu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - mw - 10)) + "px";
            favMenu.style.top = Math.max(6, Math.min(rc.bottom + 2, window.innerHeight - mh - 10)) + "px";
        } catch (err) {
            say("读取收藏失败", "#ff6b6b");
        }
    });

    document.addEventListener("pointerdown", (e) => {
        if (favMenu.style.display === "flex" && !favMenu.contains(e.target)) favMenu.style.display = "none";
    });

    /* ---------------- 标签面板（仅 Pro） ---------------- */
    const state = { grp: "", nsfw: false, page: 0, q: "", total: 0 };

    let tagPanel = null;
    if (tagPanel === null) {
        const CATS = ["全部", "人物", "服装", "动作", "表情", "场景", "镜头", "光线", "颜色", "物品", "动物", "特效", "文字", "风格", "画质", "元数据", "作品", "角色", "画师", "其他"];
        tagPanel = css(document.createElement("div"), {
            borderTop: "1px solid var(--node-border, #3f3f3f)", paddingTop: "5px",
            display: "flex", flexDirection: "column", gap: "4px",
        });
        tagPanel.addEventListener("pointerdown", (e) => e.stopPropagation());

        const baseInput = {
            height: "20px", borderRadius: "3px", border: "1px solid var(--node-border, #4e4e4e)",
            background: "var(--comfy-input-bg, #222)", color: "var(--input-text, #e2e2e2)", fontSize: "10px", padding: "0 6px", outline: "none",
        };
        const search = document.createElement("input");
        search.placeholder = "搜索：中文名 或 英文 tag";
        css(search, Object.assign({ flex: "1", minWidth: "0" }, baseInput));

        const nsfw = mkCheck("NSFW", false);
        nsfw.box.accentColor = "#c9a227";
        nsfw.lab.style.color = "#c9a227";

        const bar2 = css(document.createElement("div"), {
            display: "flex", gap: "4px", alignItems: "center", flex: "0 0 auto",
        });
        bar2.append(search, btnRand, nsfw.lab);

        if (!document.getElementById("pf-catstyle")) {
            const st = document.createElement("style");
            st.id = "pf-catstyle";
            st.textContent = ".pf-catrow::-webkit-scrollbar{display:none;height:0}.pf-catrow{scrollbar-width:none}";
            document.head.appendChild(st);
        }
        const catRow = css(document.createElement("div"), {
            display: "flex", gap: "3px", overflowX: "auto", paddingBottom: "1px",
            flex: "0 0 auto", alignItems: "center", minHeight: "22px",
        });
        catRow.className = "pf-catrow";
        const res = css(document.createElement("div"), {
            display: "flex", flexWrap: "wrap", gap: "4px",
            flex: "1 1 auto", minHeight: "56px", overflowY: "auto", alignContent: "flex-start",
        });
        const foot = css(document.createElement("div"), {
            display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px",
            flex: "0 0 auto",
        });
        /* 标签数量原来压在左下角和作者名重叠，按需求整块去掉，只留翻页 */
        const pager = css(document.createElement("div"), {
            display: "flex", gap: "2px", alignItems: "center", flexWrap: "wrap",
            justifyContent: "flex-end", flex: "1",
        });
        foot.append(pager);

        tagPanel.append(bar2, catRow, res, foot);

        const chips = new Map();
        const refreshSel = () => {
            const picked = new Set(String(req.value || "").split(/[,，\n、;；\s]+/).map((s) => s.trim()).filter(Boolean));
            chips.forEach((c, tag) => {
                const on = picked.has(tag);
                const hard = Number(c.dataset.lvl || 0) >= 2;
                c.style.color = hard ? "#ff7ab6" : (on ? "var(--node-foreground, #a8dadc)" : (c.dataset.zh === "1" ? "var(--node-foreground, #c9c9c9)" : "var(--muted-foreground, #9aa7b0)"));
                c.style.borderColor = on ? "var(--primary, #a8dadc)" : (hard ? "#7a3352" : "var(--node-border, #464646)");
                c.style.background = on ? "color-mix(in srgb, var(--primary, #a8dadc) 22%, transparent)" : (hard ? "#3a2130" : "var(--secondary-background, #2b2b2b)");
                c.style.fontWeight = on ? "600" : "400";
            });
        };
        afterSync = refreshSel;

        const paint = (tag, zh, cnt, lvl) => {
            const chip = document.createElement("span");
            const name = document.createElement("span");
            name.textContent = zh || tag;
            const en = document.createElement("span");
            en.textContent = tag;
            css(en, { fontSize: "9px", marginLeft: "3px", color: "var(--muted-foreground, #8b9aa4)" });
            chip.append(name, en);
            chip.title = tag + " · 热度 " + cnt;
            css(chip, {
                padding: "1px 5px", borderRadius: "3px", background: "var(--secondary-background, #2b2b2b)",
                border: "1px solid var(--node-border, #464646)", fontSize: "10px",
                color: zh ? "var(--node-foreground, #c9c9c9)" : "var(--muted-foreground, #9aa7b0)",
                cursor: "pointer", whiteSpace: "nowrap",
            });
            if (lvl >= 2) {
                chip.style.color = "#ff7ab6";
                chip.style.background = "#3a2130";
                chip.style.borderColor = "#7a3352";
                en.style.color = "#c4658f";
                chip.title += " · NSFW";
            }
            chip.dataset.lvl = String(lvl || 0);
            chip.dataset.zh = zh ? "1" : "0";
            chip.addEventListener("pointerdown", (e) => e.stopPropagation());
            chip.addEventListener("click", () => appendTagToReq(tag));
            chips.set(tag, chip);
            res.appendChild(chip);
        };

        let timer = null;
        let total = 0;
        const PER = 40;

        const renderPager = () => {
            pager.innerHTML = "";
            const pages = Math.max(1, Math.ceil(total / PER));
            if (pages <= 1) return;
            const mk = (label, page, active) => {
                const b = document.createElement("button");
                b.textContent = label;
                css(b, {
                    minWidth: "18px", height: "18px", padding: "0 4px", fontSize: "10px",
                    borderRadius: "3px", cursor: "pointer",
                    border: "1px solid " + (active ? "var(--node-border, #5e5e5e)" : "var(--node-border, #464646)"),
                    background: active ? "var(--accent, #3d3d3d)" : "var(--secondary-background, #2b2b2b)",
                    color: active ? "var(--node-foreground, #e8e8e8)" : "var(--node-foreground, #bfbfbf)",
                });
                b.addEventListener("pointerdown", (e) => e.stopPropagation());
                b.addEventListener("click", () => {
                    if (page !== state.page) { state.page = page; doSearch(); }
                });
                return b;
            };
            const idx = [];
            for (let i = 0; i < pages; i += 1) {
                if (i < 2 || i > pages - 3 || Math.abs(i - state.page) <= 1) idx.push(i);
            }
            pager.appendChild(mk("‹", Math.max(0, state.page - 1), false));
            let prev = -2;
            idx.forEach((i) => {
                if (i - prev > 1) {
                    const dots = document.createElement("span");
                    dots.textContent = "…";
                    css(dots, { fontSize: "10px", color: "var(--muted-foreground, #7b7b7b)", padding: "0 1px" });
                    pager.appendChild(dots);
                }
                pager.appendChild(mk(String(i + 1), i, i === state.page));
                prev = i;
            });
            pager.appendChild(mk("›", Math.min(pages - 1, state.page + 1), false));
        };

        const zhTriedP = new Set();
        const fillPage = (rows) => {
            const miss = rows.filter((r) => !r[1]).map((r) => r[0])
                .filter((t) => !zhTriedP.has(t)).slice(0, 24);
            if (!miss.length) return;
            miss.forEach((t) => zhTriedP.add(t));
            post("/zh_fill", { tags: miss }).then((z) => {
                const map = (z && z.ok && z.map) || {};
                let n = 0;
                Object.keys(map).forEach((k) => { if (map[k]) { ZH.set(k, map[k]); n += 1; } });
                if (n) doSearch();
            }).catch(() => {});
        };

        const doSearch = async () => {
            try {
                const d = await post("/search_tags", {
                    q: state.q, grp: state.grp, limit: PER, hot: true,
                    offset: state.page * PER,
                    levels: [0, 1],
                });
                if (!d.ok) { res.textContent = d.error || "搜索失败"; return; }
                let rows = d.rows || [];
                /* 勾了 NSFW 也照常显示普通标签：普通结果 + 追加一页 NSFW */
                if (state.nsfw) {
                    try {
                        const dn = await post("/search_tags", {
                            q: state.q, grp: state.grp, limit: 12, hot: true, offset: 0, levels: [2],
                        });
                        const extra = (dn && dn.ok && dn.rows) ? dn.rows : [];
                        const known = new Set(rows.map((r) => r[0]));
                        rows = rows.concat(extra.filter((r) => !known.has(r[0])));
                    } catch (e) { /* NSFW 追加失败不影响普通结果 */ }
                }
                total = Number(d.total || 0) || rows.length;
                const pages = Math.max(1, Math.ceil(total / PER));
                if (!rows.length && state.page > 0) {
                    state.page = Math.min(state.page, pages - 1);
                    return doSearch();
                }
                res.innerHTML = "";
                chips.clear();
                rows.forEach((r) => paint(r[0], r[1], r[2], r[4] || 0));
                refreshSel();
                if (!rows.length) {
                    const tip = document.createElement("span");
                    tip.textContent = "没有匹配";
                    css(tip, { fontSize: "10px", color: "var(--muted-foreground, #7b7b7b)" });
                    res.appendChild(tip);
                }
                renderPager();
                fillPage(rows);
            } catch (e) {
                res.textContent = String(e);
            }
        };

        const catBtns = [];
        CATS.forEach((c) => {
            const b = document.createElement("button");
            b.textContent = c;
            css(b, {
                padding: "1px 6px", fontSize: "10px", borderRadius: "3px",
                border: "1px solid var(--node-border, #464646)", background: "var(--secondary-background, #2b2b2b)", color: "var(--node-foreground, #bfbfbf)",
                cursor: "pointer", whiteSpace: "nowrap",
            });
            b.addEventListener("pointerdown", (e) => e.stopPropagation());
            b.addEventListener("click", () => {
                state.grp = c === "全部" ? "" : c;
                state.page = 0;
                catBtns.forEach((x) => {
                    x.style.background = "var(--secondary-background, #2b2b2b)";
                    x.style.color = "var(--node-foreground, #bfbfbf)";
                    x.style.borderColor = "var(--node-border, #464646)";
                });
                b.style.background = "var(--accent, #3d3d3d)";
                b.style.color = "var(--node-foreground, #e8e8e8)";
                b.style.borderColor = "var(--node-border, #5e5e5e)";
                doSearch();
            });
            catBtns.push(b);
            catRow.appendChild(b);
        });

        search.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                state.q = search.value.trim();
                state.page = 0;
                doSearch();
            }, 250);
        });
        nsfw.box.addEventListener("change", () => {
            state.nsfw = nsfw.box.checked;
            nsfw.lab.style.color = state.nsfw ? "#ff7ab6" : "#c9a227";
            nsfw.lab.style.fontWeight = state.nsfw ? "700" : "400";
            nsfw.lab.style.color = state.nsfw ? "#ff7ab6" : "#c9a227";
            state.page = 0;
            doSearch();
        });
        catBtns[0].click();
    }

    /* ---------------- 动作 ---------------- */

    const busy = (on) => {
        [btnTr, btnOpt, btnExp, btnRand].forEach((b) => {
            b.disabled = on;
            b.style.opacity = on ? ".45" : "1";
        });
    };
    const say = (msg, color) => {
        status.textContent = msg;
        status.style.color = color || "var(--muted-foreground, #6f6f6f)";
    };

    btnTr.addEventListener("click", async () => {
        const text = serialize().trim();
        if (!text) return say("先写点东西再翻译", "#c9a227");
        busy(true);
        say("翻译中…");
        try {
            const d = await post("/translate", {
                text, to: "自动",
                service: setting(node, "服务", "本地 llama.cpp"), api: apiOf(node),
            });
            if (!d.ok) throw new Error(d.error);
            await lookup((d.text || "").split(/[,，\n]/).map((s) => s.trim().replace(/\s+/g, "_")));
            render(d.text || "");
            sync();
            const u = d.usage || {};
            say(`翻译完成 · ${u.engine || u.service || "免费接口"} · ${((u.ms || 0) / 1000).toFixed(1)}s`, "#7fbf7f");
        } catch (e) {
            say("翻译失败：" + String(e.message || e), "#ff6b6b");
        } finally {
            busy(false);
        }
    });

    const runLLM = async (mode) => {
        const reqText = reqEntry();
        const text = serialize().trim();
        busy(true);
        const SEP = "\n\u0001\n";
        const cands = [];
        const t0 = performance.now();
        let buf = "", chars = 0;
        const tick = setInterval(() => {
            const sec = (performance.now() - t0) / 1000;
            const cps = sec > 0.6 ? (chars / sec) : 0;
            say(`生成中… ${chars} 字 · ${sec.toFixed(0)}s · ${cps.toFixed(1)} 字/秒`, "#c9a227");
        }, 400);
        say(reqText ? "按你的要求生成中…（27B 首字约 3 秒）" : "没有填写要求 → 随机创作中…", "#c9a227");
        let failed = "";
        try {
            const res = await fetch(API + "/optimize_stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text,
                    requirement: reqText,
                    skill: setting(node, "目标模型", ""),
                    lang: setting(node, "语言", "自动"),
                    service: setting(node, "服务", "本地 llama.cpp"),
                    api: apiOf(node),
                    mode,
                    extras: extrasOf(node),
                }),
            });
            if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
            const reader = res.body.getReader();
            const dec = new TextDecoder("utf-8");
            while (true) {
                const r = await reader.read();
                if (r.done) break;
                buf += dec.decode(r.value, { stream: true });
                chars = buf.length;
                let i;
                while ((i = buf.indexOf(SEP)) >= 0) {
                    const one = buf.slice(0, i).trim();
                    if (one) cands.push(one);
                    buf = buf.slice(i + SEP.length);
                }
                if (buf.startsWith("\u0002")) { failed = buf.slice(1); break; }
                ed.textContent = buf;
            }
            clearInterval(tick);
            if (failed) throw new Error(failed);
            const last = buf.trim();
            if (last) cands.push(last);
            if (!cands.length) throw new Error("模型没返回内容");
        } catch (e) {
            clearInterval(tick);
            const msg = String(e.message || e);
            if (/404|not found|unexpected token|Failed to fetch/i.test(msg)) {
                /* 还没重启 ComfyUI（后端没有优化流接口）→ 退回一次性请求，至少能出结果 */
                say("流式接口还没加载（重启 ComfyUI 后就能看到进度），先按整段等…", "#c9a227");
                try {
                    const d = await post("/optimize", {
                        text,
                        requirement: reqText,
                        skill: setting(node, "目标模型", ""),
                        lang: setting(node, "语言", "自动"),
                        service: setting(node, "服务", "本地 llama.cpp"),
                            api: apiOf(node),
                        mode,
                        extras: extrasOf(node),
                    });
                    if (!d.ok) throw new Error(d.error);
                    (d.candidates || []).forEach((c) => cands.push(c));
                    if (!cands.length) throw new Error("模型没返回内容");
                } catch (e2) {
                    say("优化失败：" + String(e2.message || e2), "#ff6b6b");
                    render(text);
                    sync();
                    busy(false);
                    return;
                }
            } else {
                say("优化失败：" + msg, "#ff6b6b");
                render(text);
                sync();
                busy(false);
                return;
            }
        }
        {
            const out = cands[0] || text;
            render(out);
            sync();
            const sec2 = (performance.now() - t0) / 1000;
            say(`优化完成 · ${sec2.toFixed(1)}s · ${chars} 字`, "#7fbf7f");
        }
        busy(false);
    };
    btnOpt.addEventListener("click", () => runLLM("优化"));
    btnExp.addEventListener("click", () => runLLM("扩写"));

    /* 首次填充 */
    const initial = getText(node);
    if (initial) enrichThenRender(initial);
    else render("");
    refreshFavCount();

    /* --- 标签面板分隔条 / API 弹窗 --- */
    const panelH = () => {
        const v = Number((node.properties || {}).pf_panel_h || 200);
        return Math.max(110, v);
    };
    const tagsOpen = () => !!(node.properties && node.properties.pf_tags_open === true);
    const tagBar = mkBtn("\u25b8 标签库", { width: "100%", height: "18px", fontSize: "10px", padding: "0" });
    tagBar.title = "展开 / 收起标签面板";
    const applyLayout = () => {
        if (!tagPanel) return;
        const open = tagsOpen();
        tagBar.textContent = open ? "\u25be 标签库" : "\u25b8 标签库";
        tagBar.style.borderColor = open ? "#5f8f6f" : "var(--node-border, #4e4e4e)";
        tagPanel.style.display = open ? "flex" : "none";
        if (open) {
            tagPanel.style.flex = "0 0 auto";
            tagPanel.style.height = panelH() + "px";
            tagPanel.style.overflow = "hidden";
        }
    };
    if (tagPanel) {
        tagBar.addEventListener("pointerdown", (e) => e.stopPropagation());
        tagBar.onclick = () => {
            node.properties = node.properties || {};
            node.properties.pf_tags_open = !tagsOpen();
            applyLayout();
            if (hooks.onTagsToggle) hooks.onTagsToggle();
            node.setDirtyCanvas(true, false);
        };
        /* 标签库放在「提示词要求」正上方（目标模型等控件之后），默认收起，展开高度固定 */
        top.insertBefore(tagPanel, reqLab);
        top.insertBefore(tagBar, tagPanel);
        applyLayout();
    }

    const syncApiBtn = () => {
        const svc = svcOf(node);
        const st = pingGet(node, svc);
        if (st && st.ok) {
            btnApi.textContent = "\u2699 API \u2713";
            btnApi.title = svc + " 已测通 · " + (st.model || "自动") + " · " + st.ms + "ms";
            btnApi.style.borderColor = "#5f8f6f";
        } else {
            btnApi.textContent = "\u2699 API";
            btnApi.title = svc + (st ? " · 上次测试失败" : " · 还没测过") + "；密钥只存本机，不进工作流";
            btnApi.style.borderColor = "var(--node-border, #4e4e4e)";
        }
    };

    const openApiModal = () => {
        const mask = css(document.createElement("div"), {
            position: "fixed", inset: "0", background: "rgba(0,0,0,.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: "10000",
        });
        const box = css(document.createElement("div"), {
            width: "430px", maxWidth: "92vw", background: "var(--secondary-background, #2b2b2b)",
            border: "1px solid var(--node-border, #4e4e4e)", borderRadius: "4px", padding: "14px",
            display: "flex", flexDirection: "column", gap: "9px",
            fontFamily: "Inter, system-ui, sans-serif", fontSize: "11px",
            color: "var(--node-foreground, #d2d2d2)", boxShadow: "0 14px 34px rgba(0,0,0,.6)",
        });
        mask.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            if (e.target === mask) close();
        });
        const h = css(document.createElement("div"), { fontSize: "12px", color: "var(--input-text, #e2e2e2)", fontWeight: "600" });
        h.textContent = "API 设置";
        const tip = css(document.createElement("div"), { fontSize: "10px", color: "var(--muted-foreground, #8a8a8a)", lineHeight: "1.6" });
        tip.textContent = "地址留空就用该服务的默认；密钥只存本机 config.json，不进工作流。";
        const mkRow = (label, ph, type) => {
            const wrap = css(document.createElement("div"), { display: "flex", flexDirection: "column", gap: "3px" });
            const lab = css(document.createElement("div"), { fontSize: "10px", color: "var(--muted-foreground, #9a9a9a)" });
            lab.textContent = label;
            const inp = document.createElement("input");
            inp.placeholder = ph;
            if (type) inp.type = type;
            css(inp, {
                height: "24px", borderRadius: "3px", border: "1px solid var(--node-border, #4e4e4e)",
                background: "var(--comfy-input-bg, #222)", color: "var(--input-text, #e2e2e2)", fontSize: "11px",
                padding: "0 7px", outline: "none",
            });
            wrap.append(lab, inp);
            box.appendChild(wrap);
            return inp;
        };
        const inBase = mkRow("API 地址（留空用默认）", DEFAULT_BASE);
        const mWrap = css(document.createElement("div"), { display: "flex", flexDirection: "column", gap: "3px" });
        const mLab = css(document.createElement("div"), { fontSize: "10px", color: "var(--muted-foreground, #9a9a9a)" });
        mLab.textContent = "模型（自动拉取）";
        const mRow = css(document.createElement("div"), { display: "flex", gap: "6px" });
        const selModel = document.createElement("select");
        css(selModel, {
            flex: "1 1 auto", height: "24px", borderRadius: "3px", border: "1px solid var(--node-border, #4e4e4e)",
            background: "var(--comfy-input-bg, #222)", color: "var(--input-text, #e2e2e2)", fontSize: "11px", padding: "0 5px", outline: "none",
        });
        const btnReload = mkBtn("刷新", {});
        mRow.append(selModel, btnReload);
        mWrap.append(mLab, mRow);
        box.appendChild(mWrap);
        const inKey = mkRow("API 密钥（只存本机，不进工作流）", "sk-… 留空表示不改", "password");
        const testLine = css(document.createElement("div"), {
            fontSize: "10px", lineHeight: "1.5", minHeight: "14px", color: "var(--muted-foreground, #8a8a8a)",
            wordBreak: "break-all",
        });
        const row = css(document.createElement("div"), {
            display: "flex", gap: "6px", justifyContent: "flex-end", marginTop: "2px",
        });
        const btnCancel = mkBtn("取消", {});
        const btnTest = mkBtn("测试", {});
        const btnSave = mkBtn("保存", { primary: true });
        row.append(btnCancel, btnTest, btnSave);
        box.append(h, tip, testLine, row);
        mask.appendChild(box);
        document.body.appendChild(mask);

        function close() {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
        }
        const svc = svcOf(node);
        const a = apiOf(node);
        inBase.placeholder = svc === "DeepSeek" ? DEFAULT_BASE : DEFAULT_BASE_LOCAL;
        inBase.value = a.base || inBase.placeholder;

        const showPing = () => {
            const st = pingGet(node, svc);
            if (!st) {
                testLine.style.color = "var(--muted-foreground, #8a8a8a)";
                testLine.textContent = svc + "：还没测试过";
                return;
            }
            testLine.style.color = st.ok ? "#7fc98a" : "#ff8a8a";
            testLine.textContent = st.ok
                ? `已通过 · ${st.model || "自动"} · ${st.ms}ms`
                : (st.error || "上次测试失败");
        };
        showPing();

        const loadModels = async () => {
            const keep = selModel.value || a.model;
            const put = (v, t) => {
                const o = document.createElement("option");
                o.value = v;
                o.textContent = t;
                selModel.appendChild(o);
            };
            selModel.innerHTML = "";
            put("", "自动（用服务端默认）");
            const r = await post("/models", {
                service: svc, base: inBase.value.trim(), key: inKey.value.trim(),
            }).catch(() => null);
            const list = (r && r.models) || [];
            if (list.length) list.forEach((m) => put(m, m));
            else if (svc === "DeepSeek") ["deepseek-chat", "deepseek-reasoner"].forEach((m) => put(m, m));
            selModel.value = keep && [...selModel.options].some((o) => o.value === keep) ? keep : "";
        };
        btnReload.onclick = async () => {
            btnReload.disabled = true;
            await loadModels();
            btnReload.disabled = false;
        };
        loadModels();
        btnCancel.onclick = close;
        btnTest.onclick = async () => {
            btnTest.disabled = true;
            testLine.style.color = "#c9a227";
            testLine.textContent = `正在连 ${svc}…`;
            try {
                const r = await post("/ping", {
                    service: svc,
                    api: {
                        base: inBase.value.trim(),
                        key: inKey.value.trim(),
                        model: selModel.value,
                    },
                });
                if (r && r.ok) {
                    pingSet(node, svc, { ok: true, ms: r.ms, model: r.model || "", t: Date.now() });
                    testLine.style.color = "#7fc98a";
                    testLine.textContent = `通了 · ${r.model || "?"} · ${r.ms}ms`;
                } else {
                    const msg = (r && r.error) || "测试失败";
                    pingSet(node, svc, { ok: false, error: msg, t: Date.now() });
                    testLine.style.color = "#ff8a8a";
                    testLine.textContent = msg;
                }
            } catch (e) {
                const msg = String(e && e.message ? e.message : e);
                pingSet(node, svc, { ok: false, error: msg, t: Date.now() });
                testLine.style.color = "#ff8a8a";
                testLine.textContent = msg;
            }
            btnTest.disabled = false;
        };
        btnSave.onclick = async () => {
            const key = inKey.value.trim();
            if (key) {
                const r = await post("/set_key", { service: svc, key })
                    .catch((e) => ({ ok: false, error: String(e) }));
                if (!r || r.ok === false) {
                    testLine.style.color = "#ff8a8a";
                    testLine.textContent = (r && r.error) || "密钥保存失败";
                    return;
                }
            }
            const typed = inBase.value.trim();
            apiSet(node, svc, {
                base: typed === inBase.placeholder ? "" : typed,
                model: selModel.value,
            });
            close();
            syncApiBtn();
            node.setDirtyCanvas(true, false);
        };
    };
    btnApi.onclick = openApiModal;
    syncApiBtn();
    const svcW = getWidget(node, "服务");
    if (svcW) {
        const origSvc = svcW.callback;
        svcW.callback = function () {
            if (origSvc) origSvc.apply(this, arguments);
            syncApiBtn();
        };
    }

    const migrateKey = () => {
        const p = node.properties && node.properties.pf_api;
        if (p && typeof p.base === "string") {
            apiSet(node, svcOf(node), { base: p.base, model: p.model || "" });
            if (p.key) {
                post("/set_key", { service: svcOf(node), key: p.key }).catch(() => {});
            }
            node.properties.pf_api = node.properties.pf_api; /* 已按服务重排 */
            delete node.properties.pf_api[svcOf(node)].key;
            return;
        }
        if (!p || !p.key) return;
        post("/set_key", { service: setting(node, "服务") || "本地 llama.cpp", key: p.key })
            .then(() => {
                delete p.key;
                node.setDirtyCanvas(true, false);
            })
            .catch(() => {});
    };
    migrateKey();

    return {
        root,
        applyLayout,
        /* 工作流加载时 properties 是后填进来的，外面要靠这个把文字补回要求框 */
        setReq: (v) => { req.value = String(v == null ? "" : v); },
        status,
        say,
        sync,
        render,
        setRefresh: (fn) => { refresh = fn; },
        getPanelH: () => panelH(),
        /* 展开标签库需要额外占掉的高度：面板 + 顶部按钮 + 上下两个 5px 间隙 */
        getTagExtra: () => {
            if (tagPanel && tagPanel.style.display !== "none" && tagPanel.offsetHeight > 20) {
                return Math.round(tagPanel.offsetHeight + tagBar.offsetHeight + 10);
            }
            return Math.round(panelH() + 28);
        },
        fromWidget: () => enrichThenRender(getText(node)),
        appendChip,
    };
}

/* 旧工作流里的「规范」可能是文件名或标题，统一换成下拉里的模型名 */
async function normalizeTarget(node) {
    try {
        const tw = getWidget(node, "目标模型");
        if (!tw) return;
        const cards = await loadSkillCards();
        const map = {};
        cards.forEach((c) => {
            const t = c.target || c.name;
            if (c.name) map[c.name] = t;
            if (c.title) map[c.title] = t;
        });
        const v = map[tw.value];
        if (v && v !== tw.value) {
            tw.value = v;
            if (tw.callback) tw.callback.call(tw, v);
            node.setDirtyCanvas(true, true);
        }
    } catch (e) {
        console.warn("[geniusewzq] 目标模型归一化失败", e);
    }
}

app.registerExtension({
    name: "Geniusewzq.PromptForge",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "PromptForge") return;
        if (nodeType.prototype.__pfPatched) return;
        nodeType.prototype.__pfPatched = true;

        const prevConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            /* 旧工作流存了 [目标模型, 规范, 强度, 语言, 服务, 负面, 提示词]，
               合并成一个下拉后删掉中间那个值，后面的控件才不会整体错位 */
            try {
                const wv = info && info.widgets_values;
                if (Array.isArray(wv)) {
                    if (wv.length === 7) wv.splice(1, 1); /* 去掉旧的「规范」 */
                    if (wv.length === 6) wv.splice(4, 1); /* 去掉已删除的「负面」 */
                    if (wv.length === 5) wv.splice(1, 1); /* 去掉已删除的「强度」 */
                }
            } catch (e) { /* ignore */ }
            const out = prevConfigure ? prevConfigure.apply(this, arguments) : undefined;
            /* ComfyUI 加载工作流时，properties 是在 onConfigure 里才写进节点的，
               而面板在 onNodeCreated 就已经建好（那时 pf_req 还是空的），
               不补这一步就会出现「重启后提示词要求里的文字消失」。 */
            try {
                const p = this.properties || {};
                if (this._pf) {
                    if (this._pf.setReq && typeof p.pf_req === "string") this._pf.setReq(p.pf_req);
                    if (this._pf.fromWidget) this._pf.fromWidget();
                }
            } catch (e) { /* ignore */ }
            return out;
        };

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated ? onCreated.apply(this, arguments) : undefined;
            const node = this;
            if (node._pf) return r;   /* 同一节点只建一次面板，重复回调直接跳过 */

            /* 清掉可能残留的同名 DOM widget（旧版本工作流带过来的） */
            (node.widgets || []).slice().forEach((wd) => {
                if (wd.name !== "pf_panel") return;
                const i = node.widgets.indexOf(wd);
                if (i >= 0) node.widgets.splice(i, 1);
                if (wd.element && wd.element.parentNode) wd.element.parentNode.removeChild(wd.element);
            });

            /* 原生输入框只当数据容器：彻底不画（否则刷新后会露出一块黑框） */
            const hideNative = () => {
                const wd = getWidget(node, "提示词");
                if (!wd) return;
                wd.computeSize = () => [0, -4];
                wd.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
                wd.type = "hidden";
                wd.hidden = true;
            };
            hideNative();

            const hooks = {};
            const ui = buildUI(node, hooks);
            const w = node.addDOMWidget("pf_panel", "PF_PANEL", ui.root, {
                serialize: false,
                hideOnZoom: false,
            });
            node._pf = ui;

            /* 系统切换（深浅色 / Nodes 2.0 ↔ 经典画布）时重算皮肤 */
            try {
                const mo = new MutationObserver(() => { if (ui.root.__pfApplyMode) ui.root.__pfApplyMode(); });
                mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
                mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
                ui.themeMo = mo;
            } catch (e) { /* ignore */ }

            // Nodes 2.0（Vue 节点）：DOM widget 被放进节点卡片内部，卡片只有 min-height。
            // 它一旦参与文档流，内容高度就会把卡片顶高，前端再把卡片高度记成 contentSize
            // 下限 → 面板只占节点上半截、节点也压不下去。
            // 所以让面板脱离文档流：绝对定位铺满"槽位顶部 → 卡片底部"，只跟随节点显式尺寸。
            let pfCardOffset = 0;
            let pfCardEl = null;
            /* 回到"未定位"状态：仍然是 absolute（不参与卡片内容高度，避免 contentSize 下限被顶高），
               但清掉四边，让它停在文档流的静态位置上，好重新量出槽位坐标 */
            const resetPfPlacement = (st) => {
                st.position = "absolute";
                st.top = "";
                st.left = "";
                st.right = "";
                st.bottom = "";
                st.width = "100%";
                st.height = "auto";
                st.minHeight = "0px";
            };
            const syncPfHeight = () => {
                if (!ui.root.isConnected) return;
                if (ui.root.__pfApplyMode) ui.root.__pfApplyMode();
                const card = ui.root.closest(".lg-node");
                const st = ui.root.style;
                if (!card) {
                    pfCardEl = null;
                    if (st.position === "absolute") {
                        Object.assign(st, { position: "relative", top: "", left: "", right: "", bottom: "" });
                        st.width = "100%";
                        st.height = "100%";
                        st.minHeight = "";
                    }
                    return;
                }
                /* 卡片换了（Nodes 2.0 ↔ 经典画布、节点重挂载）：旧坐标失效，先回到静态位置重测 */
                if (card !== pfCardEl) {
                    pfCardEl = card;
                    resetPfPlacement(st);
                }
                /* 旧工作流里标签库可能是展开着存的：装不下就把节点补高一次（只做一次，幂等） */
                if (!ui.root.__pfTagFix && tagsOpen()) {
                    const topEl = ui.root.firstElementChild;
                    if (topEl && topEl.clientHeight > 40) {
                        const over = Math.round(topEl.scrollHeight - topEl.clientHeight);
                        if (over > 12) {
                            ui.root.__pfTagFix = true;
                            try {
                                node.setSize([node.size[0], Math.round(node.size[1] + over)]);
                            } catch (e) { /* ignore */ }
                        } else if (over <= 0) {
                            ui.root.__pfTagFix = true;
                        }
                    }
                }
                if (st.top) return;   /* 已经铺满过 */
                const cardW = card.offsetWidth;
                const cr = card.getBoundingClientRect();
                const rr = ui.root.getBoundingClientRect();
                if (!(cardW > 0) || !(cr.width > 0) || !(rr.width > 20)) return;
                const scale = cr.width / cardW;
                const top = (rr.top - cr.top) / scale;
                if (!(top > 0)) return;
                pfCardOffset = Math.round(top);
                st.position = "absolute";
                st.boxSizing = "border-box";
                st.top = pfCardOffset + "px";
                st.left = Math.max(0, Math.round((rr.left - cr.left) / scale)) + "px";
                st.right = Math.max(0, Math.round((cr.right - rr.right) / scale)) + "px";
                st.width = "auto";
                st.height = "auto";
                st.minHeight = "0px";
                st.bottom = "0px";
                /* 输出框第一次铺满时按剩余空间定高；之后高度完全交给右下角手柄 */
                if (!ui.root.__pfEdFit) {
                    const topEl = ui.root.firstElementChild;
                    const edw = ui.root.querySelector(".pf-ed-wrap");
                    if (topEl && edw && ui.root.clientHeight > 60) {
                        ui.root.__pfEdFit = true;
                        const others = Array.from(topEl.children).filter((c) => c !== edw)
                            .reduce((a, c) => a + c.offsetHeight, 0);
                        const gaps = Math.max(0, topEl.children.length - 1) * 4;
                        const extra = Array.from(ui.root.children).filter((c) => c !== topEl)
                            .reduce((a, c) => a + (c.style.display === "none" ? 0 : c.offsetHeight), 0);
                        const saved = Math.round(Number((node.properties || {}).pf_ed_h || 0));
                        edw.style.height = (saved > 40 ? saved : Math.max(70, Math.round(ui.root.clientHeight - others - gaps - extra - 14))) + "px";
                    }
                }
                /* 首次铺满时如果节点太矮装不下内容，补一次高度；之后高度完全交给用户拖 */
                if (!ui.root.__pfFitOnce) {
                    const ch = ui.root.clientHeight;
                    if (ch > 40 && ch < 270) {
                        ui.root.__pfFitOnce = true;
                        try {
                            node.setSize([node.size[0], Math.round(node.size[1] + (270 - ch))]);
                        } catch (e) { /* ignore */ }
                    }
                }
            };
            const syncPfSoon = () => {
                syncPfHeight();
                requestAnimationFrame(syncPfHeight);
                [0, 80, 300, 800, 1400, 2500].forEach((d) => setTimeout(syncPfHeight, d));
            };
            /* 设置里切换 Nodes 2.0 后卡片会重建；轻量轮询保证重新铺满 + 换皮跟上 */
            const pfModeTimer = setInterval(() => { if (ui.root.isConnected) syncPfHeight(); }, 900);
            normalizeTarget(node);

            /* 面板高度存在 pf_h 里；占位量由 widget 的 last_y 得出（权威、稳定），
               不再去量 DOM —— 量 DOM 会和 ComfyUI 的自动 fit 互相喂成死循环 */
            const tagsOpen = () => !!(node.properties && node.properties.pf_tags_open === true);
            const H = () => {
                if (!tagsOpen()) {
                    const c = Number((node.properties || {}).pf_h_closed || 300);
                    return Math.max(220, Math.min(1800, c));
                }
                const v = Number((node.properties || {}).pf_h || 440);
                return Math.max(240, Math.min(1800, v));
            };
            /* 收起态拖滑杆 → 直接改整个输入区高度（节点跟着长） */
            hooks.getH = () => H();
            hooks.setH = (v) => {
                node.properties = node.properties || {};
                node.properties.pf_h_closed = Math.max(220, Math.min(1800, Math.round(v)));
                setNodeHeight(reserve() + H());
                apply();
            };
            const reserve = () => {
                /* Nodes 2.0：面板绝对定位的顶边就是真实占位（其它控件 + 卡片内边距）。
                   Vue 版控件走网格排布，last_y 量不准，直接用测量到的顶偏移 */
                if (ui.root.style.position === "absolute" && pfCardOffset > 0) return pfCardOffset + 8;
                const ly = Number(w.last_y != null ? w.last_y : w.y);
                if (ly > 40) return Math.round(ly) + 20;
                let r = 30 + 20;
                node.widgets.forEach((wd) => {
                    if (wd === w) return;
                    let hh = 0;
                    try {
                        const cs = wd.computeSize ? wd.computeSize(node.size[0]) : null;
                        hh = cs && cs[1] > 0 ? cs[1] : 0;
                    } catch (e) {
                        hh = 0;
                    }
                    r += hh + 4;
                });
                return r + 18;
            };
            w.computeSize = (width) => [width || node.size[0], H()];
            /* Nodes 2.0 下面板是绝对定位铺满卡片的，widget 不能再拿 H() 去撑/卡节点高度，
               否则拖拽高度会被"内容高度"顶回去。绝对定位没生效（旧版/回退）时仍按 H() 走。 */
            const inVueLayout = () => !!(ui.root && ui.root.style.position === "absolute");
            w.computeLayoutSize = () => (inVueLayout()
                ? { minHeight: 40, maxHeight: 40, minWidth: 0 }
                : { minHeight: H(), maxHeight: H(), minWidth: 0 });

            const apply = () => {
                if (ui.applyLayout) ui.applyLayout();
                node.setDirtyCanvas(true, false);
            };
            ui.setRefresh(apply);

            /* 拖拽条：让滑杆跟着鼠标走 —— 鼠标往下 = 输入框变高。
               高度用"按下那一刻的高度 + 总位移"算，不做增量累加：Vue 版 setSize 不是同步生效的，
               增量累加会读回旧高度，导致拖拽跟不上鼠标、松手后还在滑。 */
            let dragBaseH = 0;
            hooks.beginDrag = () => {
                node.properties = node.properties || {};
                dragBaseH = Math.max(200, Math.round(node.size[1]));
            };
            hooks.dragTo = (dy) => {
                node.properties = node.properties || {};
                /* 万一前面几次测量没赶上（节点刚加进来、缩放中），拖拽时再补一次脱离文档流 */
                syncPfHeight();
                const base = dragBaseH > 0 ? dragBaseH : Math.max(200, Math.round(node.size[1]));
                const target = Math.max(200, Math.min(2000, Math.round(base + dy)));
                const box = Math.max(140, Math.min(1800, target - reserve()));
                if (tagsOpen()) node.properties.pf_h = box;
                else node.properties.pf_h_closed = box;
                syncing = true;
                try {
                    node.setSize([node.size[0], target]);
                } finally {
                    syncing = false;
                }
                apply();
                node.setDirtyCanvas(true, true);
            };
            /* 兼容旧的增量接口：第一次调用当作起点 */
            hooks.dragBy = (dy) => {
                if (dragBaseH <= 0) hooks.beginDrag();
                if (dy !== 0) dragBaseH += dy;
                hooks.dragTo(0);
            };
            hooks.afterDrag = () => {
                dragBaseH = 0;
                syncFromSize();
            };

            /* 我们自己改高度时不要再反过来记 pf_h（那是自动 fit，不是用户拖的） */
            let syncing = false;
            const setNodeHeight = (h) => {
                syncing = true;
                node.setSize([node.size[0], Math.max(240, Math.round(h))]);
                syncing = false;
            };
            /* 用户拖右下角 → 把多出来的高度记进 pf_h（面板跟着长） */
            const syncFromSize = () => {
                if (syncing) return;
                if (!tagsOpen()) {
                    const c = Math.round(node.size[1] - reserve());
                    if (c < 220 || Math.abs(c - H()) < 4) return;
                    node.properties = node.properties || {};
                    node.properties.pf_h_closed = Math.min(1800, c);
                    return;
                }
                const h = Math.round(node.size[1] - reserve());
                if (h < 240) return;
                if (Math.abs(h - H()) < 4) return;
                node.properties = node.properties || {};
                node.properties.pf_h = Math.min(1800, h);
                apply();
            };
            node.properties = node.properties || {};
            if (node.properties.pf_h == null) node.properties.pf_h = 440;
            if (!node.size || node.size[1] < reserve() + H() - 8) {
                node.setSize([420, reserve() + H()]);
            }
            /* 首帧后 widget 的 y 才准，对齐几次（幂等，只在偏差大时动） */
            const settle = () => {
                const ly = Number(w.y != null ? w.y : w.last_y);
                if (!(ly > 40)) return;
                if (inVueLayout()) return;
                const want = Math.round(ly) + 20 + H();
                if (Math.abs(node.size[1] - want) > 8) setNodeHeight(want);
                apply();
            };
            [500, 1200, 2500].forEach((d) => setTimeout(settle, d));
            hooks.onTagsToggle = () => {
                if (inVueLayout()) {
                    /* 标签面板夹在「提示词要求」上面，展开时把节点按面板实际高度整体撑高、
                       收起时再减回去，要求框/输出框保持原尺寸，不会被挤出可视区 */
                    node.properties = node.properties || {};
                    ui.root.__pfTagFix = true;   /* 本次挂载已按面板高度手动调整，别再让自愈逻辑重复补高 */
                    const cur = Math.round(node.size[1]);
                    if (tagsOpen()) {
                        const extra = Math.round(ui.getTagExtra ? ui.getTagExtra() : 228);
                        node.properties.pf_tag_extra = extra;
                        setNodeHeight(cur + extra);
                    } else {
                        const extra = Number(node.properties.pf_tag_extra || 0) || Math.round(ui.getTagExtra ? ui.getTagExtra() : 228);
                        delete node.properties.pf_tag_extra;
                        setNodeHeight(Math.max(200, cur - extra));
                    }
                    apply();
                    return;
                }
                const ly = Number(w.y != null ? w.y : w.last_y);
                const base = ly > 40 ? Math.round(ly) + 20 : reserve();
                setNodeHeight(base + H());
                apply();
            };

            syncPfSoon();
            const prevResize = node.onResize;
            node.onResize = function (size) {
                if (prevResize) prevResize.apply(this, arguments);
                syncPfHeight();
                syncFromSize();
                apply();
            };

            const prevRemoved = node.onRemoved;
            node.onRemoved = function () {
                if (ui.themeMo) { try { ui.themeMo.disconnect(); } catch (e) { /* ignore */ } ui.themeMo = null; }
                if (typeof pfModeTimer !== "undefined" && pfModeTimer) clearInterval(pfModeTimer);
                return prevRemoved ? prevRemoved.apply(this, arguments) : undefined;
            };

            const prevConf = node.onConfigure;
            node.onConfigure = function (info) {
                const out = prevConf ? prevConf.apply(this, arguments) : undefined;
                hideNative();
                setTimeout(() => { hideNative(); ui.fromWidget(); }, 60);
                return out;
            };

            return r;
        };
    },
});

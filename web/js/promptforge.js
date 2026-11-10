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

function getWidget(node, name) {
    return node.widgets && node.widgets.find((w) => w.name === name);
}

const SKILLS = ["人像摄影", "景别", "镜头逻辑", "人物关系", "光影", "构图", "色彩",
    "质感", "动作", "镜头", "服装", "场景", "情绪"];
const SKILLS_DEFAULT = ["人像摄影", "景别", "镜头逻辑", "人物关系"];

function extrasOf(node) {
    const v = (node.properties || {}).pf_extras;
    return Array.isArray(v) ? v.filter((x) => SKILLS.includes(x)) : SKILLS_DEFAULT.slice();
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

/* tag 写入形式：illustrious / pony 体系用下划线，其它模型用空格 */
function outTag(node, tag) {
    const skill = String(setting(node, "规范", "") || "");
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
    const root = css(document.createElement("div"), {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        padding: "4px 6px 6px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "11px",
        color: "#d2d2d2",
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#353535",
    });

    const mkBtn = (label, opts) => {
        const o = opts || {};
        const b = document.createElement("button");
        b.textContent = label;
        css(b, {
            flex: o.flex || "0 0 auto",
            height: "22px",
            padding: "0 8px",
            borderRadius: "3px",
            border: "1px solid #4e4e4e",
            background: o.primary ? "#3a3a3a" : "#2b2b2b",
            color: "#e2e2e2",
            fontSize: "11px",
            cursor: "pointer",
            whiteSpace: "nowrap",
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
            fontSize: "10px", color: "#bfbfbf", cursor: "pointer", whiteSpace: "nowrap",
        });
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !!checked;
        css(box, { margin: "0", accentColor: "#7f9fbf", cursor: "pointer" });
        const txt = document.createTextNode(label);
        lab.appendChild(box);
        lab.appendChild(txt);
        lab.addEventListener("pointerdown", (e) => e.stopPropagation());
        return { lab, box, txt };
    };

    /* --- 工具栏 --- */
    const bar = css(document.createElement("div"), {
        display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap",
    });
    const asg = mkCheck("联想", true);
    const kp = mkCheck("保持人物一致", false);
    kp.lab.title = "开头加一段一致性提示，正文不再写任何人物外貌词（交给参考图）";
    const btnFix = mkBtn("整理");
    btnFix.title = "把框里已经是标签的词，转成可点删的块";
    const btnRand = mkBtn("🎲 随机");
    btnRand.title = "随机拼一串：每个小类只出一个";
    const favWrap = css(document.createElement("div"), {
        display: "flex", alignItems: "center", gap: "4px", marginLeft: "auto", position: "relative",
    });
    const btnFav = mkBtn("★ 收藏");
    const btnFavList = mkBtn("收藏夹 0 ▾");
    favWrap.append(btnFav, btnFavList);
    const btnApi = mkBtn("⚙ API", {});
    bar.append(asg.lab, kp.lab, btnFix, favWrap, btnApi);

    /* --- 编辑器 --- */
    const ed = css(document.createElement("div"), {
        flex: "1 1 auto",
        minHeight: "70px",
        overflowY: "auto",
        background: "#222",
        border: "1px solid #4e4e4e",
        borderRadius: "3px",
        padding: "5px 7px",
        fontSize: "11px",
        lineHeight: "1.65",
        color: "#e2e2e2",
        outline: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        cursor: "text",
    });
    ed.contentEditable = "true";
    ed.spellcheck = false;
    ed.addEventListener("pointerdown", (e) => e.stopPropagation());
    ed.addEventListener("focus", () => { ed.style.borderColor = "#6a7f92"; });
    ed.addEventListener("blur", () => { ed.style.borderColor = "#4e4e4e"; });

    /* --- 提示词输入区与下方内容之间的拖拽条（与标签库开关无关） --- */
    const splitter = css(document.createElement("div"), {
        height: "7px", margin: "0", cursor: "row-resize",
        background: "linear-gradient(#3a3a3a,#2b2b2b)",
        borderTop: "1px solid #4e4e4e", borderBottom: "1px solid #2a2a2a",
        borderRadius: "2px", flex: "0 0 auto", position: "relative",
    });
    splitter.title = "上下拖动：调整提示词撰写区高度";
    splitter.appendChild(css(document.createElement("div"), {
        position: "absolute", left: "50%", top: "2px", transform: "translateX(-50%)",
        width: "26px", height: "2px", background: "#6a6a6a", borderRadius: "1px",
    }));
    splitter.addEventListener("pointerdown", (e) => {
        e.stopPropagation(); e.preventDefault();
        let last = e.clientY;
        const move = (ev) => {
            const dy = ev.clientY - last;
            last = ev.clientY;
            if (hooks.dragBy) hooks.dragBy(dy);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (hooks.afterDrag) hooks.afterDrag();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    });

    /* --- 动作行 --- */
    const act = css(document.createElement("div"), { display: "flex", gap: "5px" });
    const btnTr = mkBtn("翻译", { flex: "1" });
    const btnOpt = mkBtn("✦ 优化提示词", { flex: "2", primary: true });
    const btnExp = mkBtn("✦ 深度扩写", { flex: "2" });
    btnOpt.title = "按所选模型的规则重写，让提示词更符合这个模型";
    btnExp.title = "在原意基础上往上加细节，画面更丰富";
    act.append(btnTr, btnOpt, btnExp);

    /* --- 侧重（可多选，选中项会作为重点写进 system prompt） --- */
    const skRow = css(document.createElement("div"), {
        display: "flex", gap: "4px", overflowX: "auto", overflowY: "hidden",
        alignItems: "center", minHeight: "20px",
    });
    skRow.className = "pf-skrow";
    const skLabel = css(document.createElement("span"), {
        fontSize: "10px", color: "#8a8a8a", flex: "0 0 auto",
    });
    skLabel.textContent = "侧重";
    skRow.appendChild(skLabel);
    const skBtns = new Map();
    const paintSkills = () => {
        const on = new Set(extrasOf(node));
        skBtns.forEach((b, name) => {
            const active = on.has(name);
            b.style.background = active ? "#2f4048" : "#2b2b2b";
            b.style.borderColor = active ? "#5f8f8f" : "#464646";
            b.style.color = active ? "#cfe6e6" : "#a9a9a9";
        });
    };
    SKILLS.forEach((name) => {
        const b = css(document.createElement("button"), {
            fontSize: "10px", lineHeight: "15px", padding: "0 6px", flex: "0 0 auto",
            background: "#2b2b2b", border: "1px solid #464646", borderRadius: "3px",
            color: "#a9a9a9", cursor: "pointer", whiteSpace: "nowrap",
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
        minHeight: "13px", fontSize: "10px", color: "#6f6f6f",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    });

    const top = css(document.createElement("div"), {
        display: "flex", flexDirection: "column", gap: "5px",
        flex: "1 1 auto", minHeight: "0", overflow: "hidden",
    });
    top.append(bar, ed, splitter, act, skRow, status);
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
        css(c, {
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "1px 5px", margin: "2px 2px", borderRadius: "3px",
            background: hard ? "#3a2130" : "#2f3a42",
            border: "1px solid " + (hard ? "#7a3352" : "#4e606b"),
            fontSize: "10px", lineHeight: "15px",
            color: hard ? "#ff7ab6" : "#d6e4ec",
            verticalAlign: "baseline", cursor: "default", userSelect: "none",
        });
        const name = document.createElement("span");
        name.textContent = zh || tag;
        name.title = tag;
        const en = document.createElement("span");
        en.textContent = tag;
        css(en, { fontSize: "9px", color: hard ? "#c4658f" : "#8fa3b0" });
        const x = document.createElement("span");
        x.textContent = "✕";
        x.title = "删除这个标签";
        css(x, { cursor: "pointer", color: "#7f929e", fontSize: "9px", padding: "0 1px" });
        x.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            c.remove();
            sync();
        });
        c.append(name, en, x);
        if (!zh) name.style.color = "#9fb9c6";
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

    const APPR_RE = /(^|_)(hair|eyes|eyebrows|eyelashes|face|skin|body|breasts?|lips|nose|mouth|teeth|beard|freckles|abs|muscles|thighs|legs|feet|hands|ears|tail|wings|horns)(_|$)|^(blonde|blue|red|black|white|brown|pink|purple|green|grey|gray|silver|aqua|orange|multicolor|multicolored|two-tone)_(hair|eyes)$/i;
    const isAppear = (tag) => APPR_RE.test(String(tag || "").trim().toLowerCase().replace(/\s+/g, "_"));
    const stripTag = (text) => String(text || "")
        .split(/[,，\n]/)
        .map((t) => t.trim())
        .filter((t) => t && !isAppear(t))
        .join("，");
    /* keepHead：保留第一句（模型自己写的一致性说明句），只清理后面的正文 */
    const stripAppear = (text, keepHead) => {
        const raw = String(text || "");
        if (!keepHead) return stripTag(raw);
        const m = raw.match(/^[\s\S]*?[。.!！?？]/);
        if (!m) return stripTag(raw);
        const head = m[0].trim();
        const body = stripTag(raw.slice(m[0].length));
        return body ? head + "，" + body : head;
    };
    /* 开了「保持人物一致」→ 把框里已有的外貌块删掉 */
    const dropAppear = () => {
        let hit = false;
        [...ed.querySelectorAll("[data-tag]")].forEach((c) => {
            if (isAppear(c.dataset.tag)) {
                c.remove();
                hit = true;
            }
        });
        if (hit) sync();
    };

    kp.box.checked = !!(node.properties && node.properties.pf_keep_char === true);
    kp.box.addEventListener("change", () => {
        node.properties = node.properties || {};
        node.properties.pf_keep_char = kp.box.checked;
        if (!kp.box.checked) {
            say("");
            return;
        }
        dropAppear();
        say("优化 / 扩写时会要求模型保持人物外貌不变、不写外貌词", "#c9a227");
    });

    const appendChip = (tag, lvl) => {
        if (kp.box.checked && isAppear(tag)) {
            say("已开『保持人物一致』，外貌类 tag 不加入", "#c9a227");
            return;
        }
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
            background: "#232323",
            border: "1px solid #5a5a5a",
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
                fontSize: "11px", color: "#dcdcdc", whiteSpace: "nowrap",
            });
            const a = document.createElement("span");
            a.textContent = zh || tag;
            const b = document.createElement("span");
            b.textContent = tag;
            css(b, { fontSize: "9px", color: "#8b9aa4", marginLeft: "auto" });
            item.append(a, b);
            item.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                insertChip(tag, sugTarget, sugSub);
                hideSug();
            });
            item.addEventListener("pointerenter", () => { item.style.background = "#333"; });
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
        if (!asg.box.checked) return hideSug();
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

    /* ---- 按钮：整理 / 随机 / 收藏 ---- */
    btnFix.addEventListener("click", () => {
        const toks = String(getText(node) || "").split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
        const cands = toks.map((t) => t.replace(/\s+/g, "_")).filter((t) => /^[A-Za-z0-9_'()\-]+$/.test(t));
        lookup(cands).then(() => { render(getText(node)); sync(); });
    });

    btnRand.addEventListener("click", async () => {
        try {
            say("随机中…");
            const d = await post("/random", { nsfw: state.nsfw, count: 10 });
            if (!d.ok) throw new Error(d.error);
            const rows = d.rows || [];
            if (!rows.length) throw new Error("词库没数据");
            rows.forEach((r) => { if (r[1]) ZH.set(r[0], r[1]); if (r[4] != null) LVL.set(r[0], Number(r[4] || 0)); });
            ed.innerHTML = "";
            rows.forEach((r) => {
                ed.appendChild(makeChip(r[0]));
                ed.appendChild(document.createTextNode(" "));
            });
            sync();
            say("随机生成 · " + rows.length + " 个标签 · " + (state.nsfw ? "NSFW 倾向" : "普通"), "#c9a227");
        } catch (e) {
            say("随机失败：" + String(e.message || e), "#ff6b6b");
        }
    });

    const favMenu = css(document.createElement("div"), {
        position: "fixed", zIndex: "10000", display: "none",
        minWidth: "220px", maxWidth: "360px", maxHeight: "260px", overflowY: "auto",
        background: "#232323", border: "1px solid #5a5a5a", borderRadius: "4px",
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
            favMenu.innerHTML = "";
            if (!items.length) {
                const t = document.createElement("div");
                t.textContent = "还没有收藏";
                css(t, { fontSize: "11px", color: "#8a8a8a", padding: "4px 6px" });
                favMenu.appendChild(t);
            }
            items.forEach((it, i) => {
                const row = css(document.createElement("div"), {
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "3px 6px", borderRadius: "3px", cursor: "pointer", fontSize: "11px",
                });
                const a = document.createElement("span");
                a.textContent = (it.text || "").slice(0, 40) || "(空)";
                css(a, { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#dcdcdc" });
                const x = document.createElement("span");
                x.textContent = "✕";
                css(x, { color: "#8a8a8a", cursor: "pointer", padding: "0 2px" });
                x.addEventListener("pointerdown", async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    await post("/fav_del", { index: i });
                    btnFavList.click();
                });
                row.append(a, x);
                row.addEventListener("pointerdown", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    render(it.text || "");
                    sync();
                    favMenu.style.display = "none";
                });
                row.addEventListener("pointerenter", () => { row.style.background = "#333"; });
                row.addEventListener("pointerleave", () => { row.style.background = "transparent"; });
                favMenu.appendChild(row);
            });
            const rc = e.currentTarget.getBoundingClientRect();
            favMenu.style.display = "flex";
            favMenu.style.left = Math.min(rc.left, window.innerWidth - favMenu.offsetWidth - 10) + "px";
            favMenu.style.top = Math.min(rc.bottom + 2, window.innerHeight - favMenu.offsetHeight - 10) + "px";
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
            borderTop: "1px solid #3f3f3f", paddingTop: "5px",
            display: "flex", flexDirection: "column", gap: "4px",
        });
        tagPanel.addEventListener("pointerdown", (e) => e.stopPropagation());

        const baseInput = {
            height: "20px", borderRadius: "3px", border: "1px solid #4e4e4e",
            background: "#222", color: "#e2e2e2", fontSize: "10px", padding: "0 6px", outline: "none",
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
            st.textContent = ".pf-catrow::-webkit-scrollbar{display:none;height:0}.pf-catrow{scrollbar-width:none}"
                + ".pf-skrow::-webkit-scrollbar{display:none;height:0}.pf-skrow{scrollbar-width:none}";
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
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px",
            flex: "0 0 auto",
        });
        const pageInfo = css(document.createElement("span"), {
            fontSize: "10px", color: "#8a8a8a", whiteSpace: "nowrap",
        });
        const pager = css(document.createElement("div"), {
            display: "flex", gap: "2px", alignItems: "center", flexWrap: "wrap",
            justifyContent: "flex-end", flex: "1",
        });
        foot.append(pageInfo, pager);

        tagPanel.append(bar2, catRow, res, foot);

        const chips = new Map();
        const refreshSel = () => {
            const picked = new Set(parts());
            chips.forEach((c, tag) => {
                const on = picked.has(tag);
                const hard = Number(c.dataset.lvl || 0) >= 2;
                c.style.color = hard ? "#ff7ab6" : (on ? "#a8dadc" : (c.dataset.zh === "1" ? "#c9c9c9" : "#9aa7b0"));
                c.style.borderColor = on ? "#a8dadc" : (hard ? "#7a3352" : "#464646");
                c.style.background = on ? "#233840" : (hard ? "#3a2130" : "#2b2b2b");
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
            css(en, { fontSize: "9px", marginLeft: "3px", color: "#8b9aa4" });
            chip.append(name, en);
            chip.title = tag + " · 热度 " + cnt;
            css(chip, {
                padding: "1px 5px", borderRadius: "3px", background: "#2b2b2b",
                border: "1px solid #464646", fontSize: "10px",
                color: zh ? "#c9c9c9" : "#9aa7b0",
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
            chip.addEventListener("click", () => appendChip(tag, lvl || 0));
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
                    border: "1px solid " + (active ? "#5e5e5e" : "#464646"),
                    background: active ? "#3d3d3d" : "#2b2b2b",
                    color: active ? "#e8e8e8" : "#bfbfbf",
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
                    css(dots, { fontSize: "10px", color: "#7b7b7b", padding: "0 1px" });
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
                    levels: state.nsfw ? [0, 1, 2] : [0, 1],
                });
                if (!d.ok) { res.textContent = d.error || "搜索失败"; return; }
                const rows = d.rows || [];
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
                    css(tip, { fontSize: "10px", color: "#7b7b7b" });
                    res.appendChild(tip);
                }
                const nsw = rows.filter((r) => (r[4] || 0) >= 2).length;
                const ntot = Number(d.nsfw_total || 0);
                pageInfo.textContent = "共 " + total + " 个"
                    + (state.nsfw
                        ? " · 成人 " + ntot + " 个（本页 " + nsw + "）"
                        : "");
                pageInfo.style.color = state.nsfw ? "#ff7ab6" : "#8a8a8a";
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
                border: "1px solid #464646", background: "#2b2b2b", color: "#bfbfbf",
                cursor: "pointer", whiteSpace: "nowrap",
            });
            b.addEventListener("pointerdown", (e) => e.stopPropagation());
            b.addEventListener("click", () => {
                state.grp = c === "全部" ? "" : c;
                state.page = 0;
                catBtns.forEach((x) => {
                    x.style.background = "#2b2b2b";
                    x.style.color = "#bfbfbf";
                    x.style.borderColor = "#464646";
                });
                b.style.background = "#3d3d3d";
                b.style.color = "#e8e8e8";
                b.style.borderColor = "#5e5e5e";
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
        [btnTr, btnOpt, btnRand, btnFix].forEach((b) => {
            b.disabled = on;
            b.style.opacity = on ? ".45" : "1";
        });
    };
    const say = (msg, color) => {
        status.textContent = msg;
        status.style.color = color || "#6f6f6f";
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
        const text = serialize().trim();
        if (!text) return say(mode === "扩写" ? "先写点东西再扩写" : "先写点东西再优化", "#c9a227");
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
        say("优化中… 正在等第一个字（27B 首字约 3 秒）", "#c9a227");
        let failed = "";
        try {
            const res = await fetch(API + "/optimize_stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text,
                    skill: setting(node, "规范", ""),
                    strength: setting(node, "强度", "标准"),
                    lang: setting(node, "语言", "自动"),
                    service: setting(node, "服务", "本地 llama.cpp"),
                    api: apiOf(node),
                    mode,
                    keep_char: kp.box.checked,
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
                        skill: setting(node, "规范", ""),
                        strength: setting(node, "强度", "标准"),
                        lang: setting(node, "语言", "自动"),
                        service: setting(node, "服务", "本地 llama.cpp"),
                            api: apiOf(node),
                        mode,
                        keep_char: kp.box.checked,
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
            render(kp.box.checked ? stripAppear(out, true) : out);
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
        tagBar.style.borderColor = open ? "#5f8f6f" : "#4e4e4e";
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
        root.append(tagBar, tagPanel);
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
            btnApi.style.borderColor = "#4e4e4e";
        }
    };

    const openApiModal = () => {
        const mask = css(document.createElement("div"), {
            position: "fixed", inset: "0", background: "rgba(0,0,0,.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: "10000",
        });
        const box = css(document.createElement("div"), {
            width: "430px", maxWidth: "92vw", background: "#2b2b2b",
            border: "1px solid #4e4e4e", borderRadius: "4px", padding: "14px",
            display: "flex", flexDirection: "column", gap: "9px",
            fontFamily: "Inter, system-ui, sans-serif", fontSize: "11px",
            color: "#d2d2d2", boxShadow: "0 14px 34px rgba(0,0,0,.6)",
        });
        mask.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            if (e.target === mask) close();
        });
        const h = css(document.createElement("div"), { fontSize: "12px", color: "#e2e2e2", fontWeight: "600" });
        h.textContent = "API 设置";
        const tip = css(document.createElement("div"), { fontSize: "10px", color: "#8a8a8a", lineHeight: "1.6" });
        tip.textContent = "地址留空就用该服务的默认；密钥只存本机 config.json，不进工作流。";
        const mkRow = (label, ph, type) => {
            const wrap = css(document.createElement("div"), { display: "flex", flexDirection: "column", gap: "3px" });
            const lab = css(document.createElement("div"), { fontSize: "10px", color: "#9a9a9a" });
            lab.textContent = label;
            const inp = document.createElement("input");
            inp.placeholder = ph;
            if (type) inp.type = type;
            css(inp, {
                height: "24px", borderRadius: "3px", border: "1px solid #4e4e4e",
                background: "#222", color: "#e2e2e2", fontSize: "11px",
                padding: "0 7px", outline: "none",
            });
            wrap.append(lab, inp);
            box.appendChild(wrap);
            return inp;
        };
        const inBase = mkRow("API 地址（留空用默认）", DEFAULT_BASE);
        const mWrap = css(document.createElement("div"), { display: "flex", flexDirection: "column", gap: "3px" });
        const mLab = css(document.createElement("div"), { fontSize: "10px", color: "#9a9a9a" });
        mLab.textContent = "模型（自动拉取）";
        const mRow = css(document.createElement("div"), { display: "flex", gap: "6px" });
        const selModel = document.createElement("select");
        css(selModel, {
            flex: "1 1 auto", height: "24px", borderRadius: "3px", border: "1px solid #4e4e4e",
            background: "#222", color: "#e2e2e2", fontSize: "11px", padding: "0 5px", outline: "none",
        });
        const btnReload = mkBtn("刷新", {});
        mRow.append(selModel, btnReload);
        mWrap.append(mLab, mRow);
        box.appendChild(mWrap);
        const inKey = mkRow("API 密钥（只存本机，不进工作流）", "sk-… 留空表示不改", "password");
        const testLine = css(document.createElement("div"), {
            fontSize: "10px", lineHeight: "1.5", minHeight: "14px", color: "#8a8a8a",
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
                testLine.style.color = "#8a8a8a";
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
        status,
        say,
        sync,
        render,
        setRefresh: (fn) => { refresh = fn; },
        fromWidget: () => enrichThenRender(getText(node)),
        appendChip,
    };
}

async function linkSkill(node) {
    try {
        const d = await getJson("/meta");
        if (!d.ok) return;
        const map = {};
        (d.skill_cards || []).forEach((c) => {
            if (c.target) map[c.target] = c.name;
        });
        const tw = getWidget(node, "目标模型");
        const sw = getWidget(node, "规范");
        if (!tw || !sw) return;
        const apply = () => {
            const name = map[tw.value];
            if (name && sw.value !== name) {
                sw.value = name;
                if (sw.callback) sw.callback(name);
                node.setDirtyCanvas(true, true);
            }
        };
        const orig = tw.callback;
        tw.callback = function (v) {
            if (orig) orig.apply(this, arguments);
            apply();
        };
        apply();
    } catch (e) {
        console.warn("[geniusewzq] skill 联动失败", e);
    }
}

app.registerExtension({
    name: "Geniusewzq.PromptForge",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "PromptForge") return;
        if (nodeType.prototype.__pfPatched) return;
        nodeType.prototype.__pfPatched = true;

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
            linkSkill(node);

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
            w.computeLayoutSize = () => ({ minHeight: H(), maxHeight: H(), minWidth: 0 });

            const apply = () => {
                if (ui.applyLayout) ui.applyLayout();
                node.setDirtyCanvas(true, false);
            };
            ui.setRefresh(apply);

            /* 拖拽条：让滑杆跟着鼠标走 —— 鼠标往下 = 输入框变高 */
            hooks.dragBy = (dy) => {
                const target = Math.max(240, Math.min(1800, Math.round(node.size[1] + dy)));
                const box = Math.max(220, Math.min(1800, target - reserve()));
                if (tagsOpen()) node.properties.pf_h = box;
                else node.properties.pf_h_closed = box;
                syncing = true;
                node.setSize([node.size[0], target]);
                syncing = false;
                apply();
                node.setDirtyCanvas(true, true);
            };
            hooks.afterDrag = () => syncFromSize();

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
                const want = Math.round(ly) + 20 + H();
                if (Math.abs(node.size[1] - want) > 8) setNodeHeight(want);
                apply();
            };
            [500, 1200, 2500].forEach((d) => setTimeout(settle, d));
            hooks.onTagsToggle = () => {
                const ly = Number(w.y != null ? w.y : w.last_y);
                const base = ly > 40 ? Math.round(ly) + 20 : reserve();
                setNodeHeight(base + H());
                apply();
            };

            const prevResize = node.onResize;
            node.onResize = function (size) {
                if (prevResize) prevResize.apply(this, arguments);
                syncFromSize();
                apply();
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

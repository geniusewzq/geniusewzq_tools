// 比例切换器 Pro —— 前端联动逻辑
// 设计定稿见桌面《融合节点模拟.html》（决策 1~10）
// 本文件负责：灰显联动 / Latent来源 锁定与连入自动开启 / 「真实宽·真实高」行内标签 / 百万像素模式回填
import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v1.4.0 loaded: AspectRatioSwitcherPro");

// ---------- 样式注入（一次） ----------
(function injectStyle() {
    if (document.getElementById("gswq-pro-style")) return;
    const style = document.createElement("style");
    style.id = "gswq-pro-style";
    style.textContent = `
        /* 置灰：只作用于行的内容层，行内「真实宽/真实高」标签永不置灰（DOM 渲染模式） */
        .gswq-dim { opacity: .38 !important; pointer-events: none !important; }
        /* 置灰行的底板同步变暗（与整行灰的行观感一致） */
        .gswq-hasdim { background-color: rgba(58,58,66,.38) !important; }
        /* 行内标签：文字白色 + 数值绿色（严格对齐模拟页 out-tag，DOM 模式） */
        .gswq-tag {
            position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
            display: flex; align-items: center; gap: 5px;
            font: 12px/1.2 'Segoe UI', sans-serif; color: #ececec;
            white-space: nowrap; pointer-events: none; z-index: 3;
            background: rgba(30,30,34,.72); border-radius: 8px; padding: 2px 7px;
        }
        .gswq-tag b { color: #8ee06a; font-weight: 600; font-variant-numeric: tabular-nums; }
    `;
    document.head.appendChild(style);
})();

// ---------- 画布工具：圆角矩形（兼容旧前端无 roundRect） ----------
function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// 画布版「真实宽/真实高」胶囊标签（白字 + 绿数字，深色胶囊，严格对齐模拟页）
function drawRealTag(ctx, node, y, h, label, value, rightEdge) {
    ctx.save();
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const padX = 7, gap = 5;
    const wLabel = ctx.measureText(label).width;
    const valText = value == null ? "──" : String(value);
    const wVal = ctx.measureText(valText).width;
    const tw = padX * 2 + wLabel + gap + wVal;
    const th = 19;
    const tx = node.size[0] - rightEdge - tw;
    const ty = y + (h - th) / 2;
    ctx.fillStyle = "rgba(30,30,34,.72)";
    roundRectPath(ctx, tx, ty, tw, th, 8);
    ctx.fill();
    ctx.fillStyle = "#ececec";
    ctx.fillText(label, tx + padX, y + h / 2 + 0.5);
    ctx.fillStyle = "#8ee06a";
    ctx.fillText(valText, tx + padX + wLabel + gap, y + h / 2 + 0.5);
    ctx.restore();
}

// 画布版：补绘被 disabled 隐藏的控件原值（暗灰但可见，对齐模拟页"灰行仍显示原值"）
function drawDimmedValue(ctx, node, y, h, text, rightEdge) {
    ctx.save();
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(236,236,236,.45)";
    ctx.fillText(text, node.size[0] - rightEdge, y + h / 2 + 0.5);
    ctx.restore();
}

// ---------- 计算口径（与后端 aspect_ratio_switcher_pro.py 完全一致） ----------
const RATIOS = {
    "1:1 方形": [1, 1],
    "2:3 竖版照片": [2, 3],
    "3:2 横版照片": [3, 2],
    "3:4 竖版标准": [3, 4],
    "4:3 标准": [4, 3],
    "9:16 竖屏": [9, 16],
    "16:9 宽屏": [16, 9],
    "21:9 超宽": [21, 9],
};
const MAX_SIDE = 16384;
const roundTo = (v, m) => Math.max(m, Math.min(MAX_SIDE, Math.round(v / m) * m));

// 控件说明（模拟页说明卡 ①②③ → 悬停提示）
const TOOLTIPS = {
    "Latent来源": "未连输入时锁定为「节点自建空白Latent」；连入 Latent 后自动开启透传，仍可手动切换",
    "尺寸模式": "关＝百万像素比例；开＝手动自定义（自定义宽高生效）",
    "宽高比": "目标画幅比例，共 8 种",
    "百万像素": "① 画面总像素量（0.1~16 MP），决定清晰度总量",
    "倍数": "② 宽高取整步长，必须 ≥8；越大对齐越粗、比例偏差可能变大，推荐 32",
    "自定义宽度": "③ 手动模式下生效，自动就近取整到「倍数」；右侧实时显示真实输出宽",
    "自定义高度": "③ 手动模式下生效，自动就近取整到「倍数」；右侧实时显示真实输出高",
    "输出方向": "开＝对调宽高（透传时会真实转置画面）",
};

app.registerExtension({
    name: "Geniusewzq.AspectRatioSwitcherPro",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AspectRatioSwitcherPro") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const created = onNodeCreated?.apply(this, arguments);
            const node = this;

            const byName = {};
            (node.widgets || []).forEach((w) => (byName[w.name] = w));
            node._gswqW = byName;
            if (!byName["Latent来源"]) return created; // 后端未加载时静默保护

            Object.entries(TOOLTIPS).forEach(([name, tip]) => {
                if (byName[name]) byName[name].tooltip = tip;
            });

            // ---- 行内标签注入（自定义宽度/高度 行右侧：「真实宽 2720」白字+绿数字） ----
            const injectTag = (widget, label) => {
                try {
                    if (!widget?.element) return false;
                    const el = widget.element;
                    if (!el.querySelector(".gswq-tag")) {
                        if (getComputedStyle(el).position === "static") el.style.position = "relative";
                        const tag = document.createElement("div");
                        tag.className = "gswq-tag";
                        tag.innerHTML = `<span>${label}</span><b>──</b>`;
                        el.appendChild(tag);
                        // 收窄原生输入框，给标签让位（模拟页布局）
                        const input = el.querySelector("input");
                        if (input) input.style.maxWidth = "48%";
                        widget._gswqTag = tag;
                    } else {
                        widget._gswqTag = el.querySelector(".gswq-tag");
                    }
                    return true;
                } catch (e) {
                    return false;
                }
            };
            const okW = injectTag(byName["自定义宽度"], "真实宽");
            const okH = injectTag(byName["自定义高度"], "真实高");
            node._gswqInlineTags = okW && okH;
            if (!node._gswqInlineTags) {
                console.info("[geniusewzq] Pro：当前为画布渲染控件，行内标签改由画布绘制");
            }

            // ---- 画布渲染：包装每个控件的 draw，精确记录行坐标（供前景层补绘） ----
            (node.widgets || []).forEach((w) => {
                if (w._gswqWrapped || typeof w.draw !== "function") return;
                w._gswqWrapped = true;
                const origDraw = w.draw;
                w.draw = function (ctx, n, width, y, height) {
                    w._gswqY = y;
                    w._gswqH = height;
                    return origDraw.apply(this, arguments);
                };
            });

            // ---- 置灰联动：只灰「内容层」，标签永不灰（决策：置灰只作用于输入） ----
            const lock = (widget, off) => {
                if (!widget) return;
                widget.disabled = !!off;
                const el = widget.element;
                if (!el) return;
                el.classList.toggle("gswq-hasdim", !!off);
                Array.from(el.children).forEach((child) => {
                    if (child.classList && !child.classList.contains("gswq-tag")) {
                        child.classList.toggle("gswq-dim", !!off);
                    }
                });
            };

            node._gswqApplyLocks = () => {
                const pass = byName["Latent来源"].value === true;
                const manual = byName["尺寸模式"].value === true;
                lock(byName["尺寸模式"], pass);
                lock(byName["宽高比"], pass || manual);
                lock(byName["百万像素"], pass || manual);
                lock(byName["倍数"], pass);
                lock(byName["自定义宽度"], pass || !manual);
                lock(byName["自定义高度"], pass || !manual);
            };

            // ---- 计算 + 标签更新 + 百万像素模式回填（与模拟页同口径） ----
            const calc = (manual) => {
                const mult = Math.max(8, Number(byName["倍数"].value) || 32);
                if (manual) {
                    return [
                        roundTo(Number(byName["自定义宽度"].value) || 1024, mult),
                        roundTo(Number(byName["自定义高度"].value) || 1024, mult),
                    ];
                }
                const [rw, rh] = RATIOS[byName["宽高比"].value] || [16, 9];
                const mp = Math.min(16, Math.max(0.1, Number(byName["百万像素"].value) || 4));
                const scale = Math.sqrt((mp * 1048576) / (rw * rh));
                return [roundTo(rw * scale, mult), roundTo(rh * scale, mult)];
            };

            let backfilling = false;
            node._gswqUpdate = () => {
                if (backfilling) return;
                const pass = byName["Latent来源"].value === true;
                const manual = byName["尺寸模式"].value === true;
                let w = null, h = null;
                if (!pass) {
                    [w, h] = calc(manual);
                    if (byName["输出方向"].value === true) { const t = w; w = h; h = t; }
                    if (!manual) {
                        // 百万像素模式：把算好的真实尺寸回填进自定义宽高（模拟页行为）
                        backfilling = true;
                        try {
                            byName["自定义宽度"].value = w;
                            byName["自定义高度"].value = h;
                        } finally { backfilling = false; }
                    }
                }
                const setTag = (widget, val) => {
                    const tag = widget?._gswqTag;
                    if (!tag) return;
                    tag.querySelector("b").textContent = val == null ? "──" : String(val);
                    tag.title = pass ? "透传模式：行内尺寸以最近一次运行为准" : "";
                };
                setTag(byName["自定义宽度"], w);
                setTag(byName["自定义高度"], h);
                // 供画布前景层绘制使用（透传时为 null → 显示 ──）
                node._gswqRealW = w;
                node._gswqRealH = h;
            };

            // ---- 控件联动回调 ----
            const hook = (name, extra) => {
                const widget = byName[name];
                if (!widget) return;
                const old = widget.callback;
                widget.callback = (v) => {
                    if (extra) extra(v);
                    node._gswqApplyLocks();
                    node._gswqUpdate();
                    return old ? old(v) : undefined;
                };
            };
            // 切到手动模式的瞬间：自定义宽高自动继承刚才百万像素模式算出的尺寸（模拟页行为）
            hook("尺寸模式", (v) => {
                if (v === true) {
                    const [w, h] = calc(false);
                    backfilling = true;
                    try {
                        byName["自定义宽度"].value = w;
                        byName["自定义高度"].value = h;
                    } finally { backfilling = false; }
                }
            });
            ["Latent来源", "宽高比", "百万像素", "倍数", "输出方向"].forEach((n) => hook(n));
            ["自定义宽度", "自定义高度"].forEach((n) => {
                const widget = byName[n];
                if (!widget) return;
                const old = widget.callback;
                widget.callback = (v) => {
                    node._gswqUpdate();
                    return old ? old(v) : undefined;
                };
            });

            node._gswqApplyLocks();
            node._gswqUpdate();
            return created;
        };

        // ---- 画布前景层：补绘被 disabled 隐藏的值 + 行内「真实宽/真实高」胶囊 ----
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            const byName = this._gswqW;
            if (this.flags?.collapsed || !byName || this._gswqInlineTags) return;

            const fmt = {
                "宽高比": (w) => String(w.value),
                "百万像素": (w) => Number(w.value).toFixed(1),
                "倍数": (w) => String(w.value),
                "尺寸模式": (w) => (w.value === true ? "手动自定义" : "百万像素比例"),
                "Latent来源": (w) => (w.value === true ? "使用输入Latent" : "节点自建空白Latent"),
            };
            Object.entries(fmt).forEach(([name, fn]) => {
                const w = byName[name];
                if (!w || w.disabled !== true || w._gswqY == null) return;
                // 开关型控件的文字在圆点左侧（预留 42px），其余类型贴右边缘
                const edge = w.type === "toggle" ? 42 : 14;
                drawDimmedValue(ctx, this, w._gswqY, w._gswqH, fn(w), edge);
            });

            // 行内「真实宽/真实高」：永不置灰。手动可编辑时右移给原生数值让位
            const manual = byName["尺寸模式"].value === true;
            const pass = byName["Latent来源"].value === true;
            const cw = byName["自定义宽度"], ch = byName["自定义高度"];
            if (cw?._gswqY != null) {
                drawRealTag(ctx, this, cw._gswqY, cw._gswqH, "真实宽", this._gswqRealW, !pass && manual ? 76 : 14);
            }
            if (ch?._gswqY != null) {
                drawRealTag(ctx, this, ch._gswqY, ch._gswqH, "真实高", this._gswqRealH, !pass && manual ? 76 : 14);
            }
        };

        // ---- 决策 9：Latent 输入连入→自动开启透传；断开→锁定回自建 ----
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (side, slot, connect, linkInfo, ioSlot) {
            onConnectionsChange?.apply(this, arguments);
            const input = this.inputs?.[slot];
            if (side !== 1 || !input || input.type !== "LATENT") return;
            const byName = this._gswqW;
            if (!byName || !byName["Latent来源"]) return;
            const hasLink = connect === true || input.link != null;
            byName["Latent来源"].value = !!hasLink;
            byName["Latent来源"].disabled = !hasLink;
            const el = byName["Latent来源"].element;
            if (el) el.classList.toggle("gswq-hasdim", !hasLink);
            this._gswqApplyLocks?.();
            this._gswqUpdate?.();
        };

        // ---- 边界情况：加载旧工作流时校正（保存时透传开着、但输入线已不存在 → 强制回自建） ----
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            const byName = this._gswqW;
            if (!byName || !byName["Latent来源"]) return;
            const hasLink = this.inputs?.[0]?.link != null;
            if (!hasLink) byName["Latent来源"].value = false;
            byName["Latent来源"].disabled = !hasLink;
            const el = byName["Latent来源"].element;
            if (el) el.classList.toggle("gswq-hasdim", !hasLink);
            this._gswqApplyLocks?.();
            this._gswqUpdate?.();
        };
    },
});

// 比例切换器 Pro —— 前端联动逻辑
// 设计定稿见桌面《融合节点模拟.html》（决策 1~10）
// 显示层采用「独立浮层」方案：读取控件行屏幕坐标，把「真实宽/真实高」胶囊与
// 灰行补值渲染在 document 级浮层中，不受前端 Vue 重渲染影响；
// 若控件无 DOM（旧画布渲染前端），自动回退为画布前景绘制。
import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v1.4.0 loaded: AspectRatioSwitcherPro");

// ---------- 浮层样式（一次注入） ----------
(function injectStyle() {
    if (document.getElementById("gswq-pro-style")) return;
    const style = document.createElement("style");
    style.id = "gswq-pro-style";
    style.textContent = `
        /* 「真实宽/真实高」胶囊：白字 + 绿数字，严格对齐模拟页 out-tag，永不置灰 */
        .gswq-ovtag {
            position: fixed; display: flex; align-items: center; gap: 5px;
            font-family: 'Segoe UI', sans-serif; color: #ececec;
            white-space: nowrap; pointer-events: none; z-index: 9990;
            background: rgba(30,30,34,.72); border-radius: 8px;
        }
        .gswq-ovtag b { color: #8ee06a; font-weight: 600; font-variant-numeric: tabular-nums; }
        /* 灰行补值：暗灰但可见 */
        .gswq-ovdim {
            position: fixed; font-family: 'Segoe UI', sans-serif;
            color: rgba(236,236,236,.45); white-space: nowrap;
            pointer-events: none; z-index: 9989;
        }
    `;
    document.head.appendChild(style);
})();

// ---------- 画布工具（旧画布渲染前端的回退路径） ----------
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

function drawRealTagCanvas(ctx, node, y, h, label, value, rightEdge) {
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

function drawDimmedValueCanvas(ctx, node, y, h, text, rightEdge) {
    ctx.save();
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(236,236,236,.45)";
    ctx.fillText(text, node.size[0] - rightEdge, y + h / 2 + 0.5);
    ctx.restore();
}

// ---------- 浮层管理 ----------
function ensureOverlay(node) {
    if (node._gswqOv && node._gswqOv.isConnected) return node._gswqOv;
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;";
    document.body.appendChild(ov);
    node._gswqOv = ov;
    return ov;
}

function ensureChild(ov, owner, key, cls) {
    let el = owner["_gswqOv_" + key];
    if (!el || !el.isConnected) {
        el = document.createElement("div");
        el.className = cls;
        ov.appendChild(el);
        owner["_gswqOv_" + key] = el;
    }
    return el;
}

// 把元素右对齐放进控件行内（rightOffset = 距行右边缘的距离），字号随缩放同步
function placeInRow(el, rect, rightOffset, baseFont, withPad) {
    const scale = Math.max(0.5, Math.min(2, rect.height / 26));
    el.style.fontSize = baseFont * scale + "px";
    if (withPad) el.style.padding = 2 * scale + "px " + 7 * scale + "px";
    el.style.visibility = "visible";
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = rect.right - rightOffset * scale - w + "px";
    el.style.top = rect.top + rect.height / 2 - h / 2 + "px";
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

            // 决策 9 初始态：未连线 → 锁定为自建
            byName["Latent来源"].disabled = true;
            byName["Latent来源"].value = false;

            // 画布坐标记录（回退路径用）
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

            // ---- 置灰联动（原生 disabled：禁交互 + 原生灰显；值由浮层/画布补绘） ----
            node._gswqApplyLocks = () => {
                const pass = byName["Latent来源"].value === true;
                const manual = byName["尺寸模式"].value === true;
                byName["尺寸模式"].disabled = pass;
                byName["宽高比"].disabled = pass || manual;
                byName["百万像素"].disabled = pass || manual;
                byName["倍数"].disabled = pass;
                byName["自定义宽度"].disabled = pass || !manual;
                byName["自定义高度"].disabled = pass || !manual;
            };

            // ---- 计算（与后端同口径） ----
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
                node._gswqRealW = w;
                node._gswqRealH = h;
                node._gswqSyncOverlay?.();
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

            // ---- 浮层同步：每帧把胶囊/补值放到正确的屏幕位置 ----
            node._gswqSyncOverlay = () => {
                const collapsed = !!node.flags?.collapsed;
                const ov = ensureOverlay(node);
                const pass = byName["Latent来源"].value === true;
                const manual = byName["尺寸模式"].value === true;
                let anyVisible = false;

                // ①「真实宽/真实高」胶囊（永不置灰）
                [["自定义宽度", "真实宽", node._gswqRealW],
                 ["自定义高度", "真实高", node._gswqRealH]].forEach(([name, label, val]) => {
                    const w = byName[name];
                    if (!w) return;
                    const el = ensureChild(ov, w, "tag", "gswq-ovtag");
                    el.innerHTML = `<span>${label}</span><b>${val == null ? "──" : val}</b>`;
                    const rect = w.element?.isConnected ? w.element.getBoundingClientRect() : null;
                    if (collapsed || !rect || rect.width < 10) {
                        el.style.visibility = "hidden";
                        return;
                    }
                    // 手动可编辑时左移给原生数值让位（模拟页行为）
                    placeInRow(el, rect, (!pass && manual) ? 84 : 10, 12, true);
                    anyVisible = true;
                });

                // ② 灰行补值：宽高比/百万像素/倍数（原生禁用后值被隐藏）
                [["宽高比", (w) => String(w.value)],
                 ["百万像素", (w) => Number(w.value).toFixed(1)],
                 ["倍数", (w) => String(w.value)]].forEach(([name, fn]) => {
                    const w = byName[name];
                    if (!w) return;
                    const el = ensureChild(ov, w, "dim", "gswq-ovdim");
                    const rect = w.element?.isConnected ? w.element.getBoundingClientRect() : null;
                    if (collapsed || w.disabled !== true || !rect || rect.width < 10) {
                        el.style.visibility = "hidden";
                        return;
                    }
                    el.textContent = fn(w);
                    placeInRow(el, rect, 58, 12, false);
                    anyVisible = true;
                });

                ov.style.display = anyVisible ? "" : "none";

                // ③ 自愈（决策 9）：未连线却透传开着 → 强制回自建
                const hasLink = node.inputs?.[0]?.link != null;
                if (!hasLink && byName["Latent来源"].value === true) {
                    byName["Latent来源"].value = false;
                    byName["Latent来源"].disabled = true;
                    node._gswqApplyLocks();
                    node._gswqUpdate();
                }
            };

            node._gswqApplyLocks();
            node._gswqUpdate();
            return created;
        };

        // ---- 画布前景层：DOM 浮层的回退路径 + 浮层每帧同步 ----
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            const byName = this._gswqW;
            if (!byName || this.flags?.collapsed) return;

            const domMode = !!byName["自定义宽度"]?.element?.isConnected;
            if (domMode) {
                this._gswqSyncOverlay?.();
                return;
            }

            // 画布渲染前端：直接在前景绘制
            const pass = byName["Latent来源"].value === true;
            const manual = byName["尺寸模式"].value === true;
            [["宽高比", (w) => String(w.value)],
             ["百万像素", (w) => Number(w.value).toFixed(1)],
             ["倍数", (w) => String(w.value)]].forEach(([name, fn]) => {
                const w = byName[name];
                if (!w || w.disabled !== true || w._gswqY == null) return;
                drawDimmedValueCanvas(ctx, this, w._gswqY, w._gswqH, fn(w), 56);
            });
            const cw = byName["自定义宽度"], ch = byName["自定义高度"];
            if (cw?._gswqY != null) {
                drawRealTagCanvas(ctx, this, cw._gswqY, cw._gswqH, "真实宽", this._gswqRealW, !pass && manual ? 84 : 12);
            }
            if (ch?._gswqY != null) {
                drawRealTagCanvas(ctx, this, ch._gswqY, ch._gswqH, "真实高", this._gswqRealH, !pass && manual ? 84 : 12);
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
            this._gswqApplyLocks?.();
            this._gswqUpdate?.();
        };

        // ---- 加载校正（决策 9）：连线状态 = 开关状态，双向强制一致 ----
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            const byName = this._gswqW;
            if (!byName || !byName["Latent来源"]) return;
            const hasLink = this.inputs?.[0]?.link != null;
            byName["Latent来源"].value = !!hasLink;
            byName["Latent来源"].disabled = !hasLink;
            this._gswqApplyLocks?.();
            this._gswqUpdate?.();
        };

        // ---- 节点删除时清理浮层 ----
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            onRemoved?.apply(this, arguments);
            this._gswqOv?.remove();
            this._gswqOv = null;
        };
    },
});

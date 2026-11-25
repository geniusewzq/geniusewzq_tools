import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v1.4.0 loaded: FastGroupsBypasser");

// Nodes 2.0（Vue 节点）不再把节点画到 canvas 上，onDrawForeground 里的按钮和
// onMouseDown 的命中判定都失效，卡片会是空的。这里额外提供一份 DOM 面板：
// 新版前端把 DOM widget 放进卡片里，旧画布前端用浮层承载，两种模式都能点。

const BTN_H = 34;
const ROW_GAP = 7;
const PANEL_PAD = 5;

const groupsOf = () => (app.graph && app.graph._groups) || [];

const getNodesInGroup = (group) => {
    if (group._nodes && group._nodes.length > 0) return group._nodes;
    const nodes = (app.graph && app.graph._nodes) || [];
    return nodes.filter((node) => (
        node.pos[0] >= group.pos[0] &&
        node.pos[1] >= group.pos[1] &&
        node.pos[0] + node.size[0] <= group.pos[0] + group.size[0] &&
        node.pos[1] + node.size[1] <= group.pos[1] + group.size[1]
    ));
};

const groupBypassed = (group) => {
    const ns = getNodesInGroup(group);
    return ns.length > 0 && ns[0].mode === 4;
};

const toggleGroup = (group) => {
    const ns = getNodesInGroup(group);
    if (!ns.length) return;
    const mode = ns[0].mode === 4 ? 0 : 4;
    ns.forEach((n) => (n.mode = mode));
    if (app.graph) app.graph.setDirtyCanvas(true, true);
};

const groupsSignature = () => groupsOf().map((g) => {
    const ns = getNodesInGroup(g);
    return (g.title || "") + ":" + ns.length + ":" + (ns.length && ns[0].mode === 4 ? 1 : 0);
}).join("|");

const panelHeight = (count) => (count
    ? count * (BTN_H + ROW_GAP) - ROW_GAP + PANEL_PAD * 2 + 2
    : 46);

const buildPanel = (node) => {
    if (node._gswqFgPanel) return;

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex;flex-direction:column;gap:" + ROW_GAP + "px;padding:" + PANEL_PAD + "px 6px;box-sizing:border-box;width:100%;background:#1e1e1e;border:1px solid #3a3a3a;border-radius:4px;overflow-y:auto;overflow-x:hidden;";
    node._gswqFgPanel = panel;

    // Nodes 2.0（Vue 节点）里 DOM widget 在节点卡片内部，卡片只有 min-height。
    // 面板一旦参与文档流，它的高度就会顶高卡片、被前端记成 contentSize 下限，
    // 节点就只能拉大不能缩小。所以让面板脱离文档流：绝对定位铺满"槽位顶部 → 卡片底部"，
    // 分组再多也只在面板内部滚动。
    const syncPanel = () => {
        if (!panel.isConnected) return;
        const card = panel.closest(".lg-node");
        const st = panel.style;
        if (!card) {
            if (st.position === "absolute") {
                Object.assign(st, { position: "relative", top: "", left: "", right: "", bottom: "", width: "100%" });
                st.height = "";
            }
            return;
        }
        if (st.position === "absolute") return;
        const cardW = card.offsetWidth;
        if (!(cardW > 0) || !(panel.offsetWidth > 20)) return; // 布局未完成，等下一帧
        const cr = card.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        if (!(cr.width > 0)) return;
        const scale = cr.width / cardW;
        const top = (pr.top - cr.top) / scale;
        if (!(top > 0)) return;
        st.position = "absolute";
        st.boxSizing = "border-box";
        st.top = Math.round(top) + "px";
        st.left = Math.round((pr.left - cr.left) / scale) + "px";
        st.right = Math.max(0, Math.round((cr.right - pr.right) / scale)) + "px";
        st.width = "auto";
        st.height = "auto";
        st.minHeight = "0px";
        st.bottom = "0px";
    };

    const render = () => {
        panel.replaceChildren();
        const groups = groupsOf();
        if (!groups.length) {
            const empty = document.createElement("div");
            empty.style.cssText = "color:#666;font:12px Arial;padding:6px 4px;";
            empty.textContent = "未发现分组";
            panel.appendChild(empty);
            return;
        }
        groups.forEach((group, index) => {
            const bypassed = groupBypassed(group);
            const row = document.createElement("div");
            row.style.cssText = [
                "display:flex", "align-items:center", "gap:8px",
                "height:" + BTN_H + "px", "flex:0 0 auto", "padding:0 10px",
                "box-sizing:border-box", "border-radius:6px", "cursor:pointer",
                "user-select:none", "overflow:hidden",
                "border:2px solid " + (bypassed ? "#800080" : "#00ff00"),
                "background:" + (bypassed ? "#353535" : "#444"),
            ].join(";") + ";";
            row.title = (group.title || ("组 " + index)) + "（点击切换 BYPASS）";

            const dot = document.createElement("span");
            dot.style.cssText = "flex:0 0 auto;width:14px;height:14px;border-radius:50%;background:" + (bypassed ? "#800080" : "#00ff00") + ";";

            const name = document.createElement("span");
            name.style.cssText = "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font:bold 13px Arial;";
            name.textContent = group.title || ("组 " + index);

            const status = document.createElement("span");
            status.style.cssText = "flex:0 0 auto;color:" + (bypassed ? "#888" : "#bbb") + ";font:10px Arial;";
            status.textContent = bypassed ? "BYPASS" : "ACTIVE";

            row.append(dot, name, status);
            row.addEventListener("pointerdown", (e) => e.stopPropagation());
            row.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleGroup(group);
            });
            panel.appendChild(row);
        });
    };

    const widget = node.addDOMWidget("分组开关", "gswq_groups", panel, {
        serialize: false,
        hideOnZoom: false,
        margin: 4,
        getValue: () => "",
        setValue: () => {},
    });
    widget.serialize = false;
    widget.serializeValue = () => undefined;
    widget.computeLayoutSize = () => {
        // 卡片内部（Nodes 2.0）时面板已脱离文档流，不占布局高度
        if (panel.isConnected && panel.closest(".lg-node")) return { minHeight: 0, maxHeight: 0, minWidth: 0 };
        const h = panelHeight(groupsOf().length);
        return { minHeight: h, maxHeight: h, minWidth: 0 };
    };

    render();
    let lastSig = groupsSignature();
    const timer = setInterval(() => {
        const sig = groupsSignature();
        if (sig === lastSig) return;
        lastSig = sig;
        render();
    }, 500);
    node._gswqFgTimer = timer;

    const prevResize = node.onResize;
    node.onResize = function () {
        if (prevResize) prevResize.apply(this, arguments);
        syncPanel();
    };
    syncPanel();
    requestAnimationFrame(syncPanel);
    [0, 80, 300, 800].forEach((d) => setTimeout(syncPanel, d));

    const prevRemoved = node.onRemoved;
    node.onRemoved = function () {
        if (node._gswqFgTimer) clearInterval(node._gswqFgTimer);
        node._gswqFgTimer = null;
        node._gswqFgPanel = null;
        if (prevRemoved) prevRemoved.apply(this, arguments);
    };
};

app.registerExtension({
    name: "Geniusewzq.FastGroupsBypasser",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "FastGroupsBypasser") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const created = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            this.serialize_widgets = true;
            this.setSize([280, 150]);
            buildPanel(this);
            return created;
        };

        // ---- 旧画布前端回退：DOM 面板没挂上时继续用前景绘制 ----
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (this.flags && this.flags.collapsed) return;
            if (this._gswqFgPanel && this._gswqFgPanel.isConnected) return;
            const groups = groupsOf();
            if (!groups || groups.length === 0) {
                ctx.fillStyle = "#666";
                ctx.font = "12px Arial";
                ctx.fillText("未发现分组", 10, 30);
                return;
            }
            let y = 30;
            const margin = 10;
            const btnHeight = 35;
            const btnWidth = this.size[0] - 20;
            groups.forEach((group, index) => {
                const isBypassed = groupBypassed(group);
                ctx.fillStyle = isBypassed ? "#353535" : "#444";
                ctx.strokeStyle = isBypassed ? "#800080" : "#00FF00";
                ctx.lineWidth = 2;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(margin, y - 20, btnWidth, btnHeight, [6]);
                else ctx.rect(margin, y - 20, btnWidth, btnHeight);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = "#FFF";
                ctx.font = "bold 13px Arial";
                ctx.fillText(group.title || ("组 " + index), margin + 38, y + 2);
                ctx.fillStyle = isBypassed ? "#800080" : "#00FF00";
                ctx.beginPath();
                ctx.arc(margin + 20, y - 2, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = isBypassed ? "#888" : "#BBB";
                ctx.font = "10px Arial";
                ctx.fillText(isBypassed ? "BYPASS" : "ACTIVE", margin + btnWidth - 55, y + 2);
                y += (btnHeight + 8);
            });
            if (Math.abs(this.size[1] - (y + 10)) > 5) this.size[1] = y + 10;
        };

        nodeType.prototype.onMouseDown = function (e, pos) {
            if (this._gswqFgPanel && this._gswqFgPanel.isConnected) return false;
            if (pos[1] <= 10) return undefined;
            const index = Math.floor((pos[1] - 10) / 43);
            const groups = groupsOf();
            if (groups && groups[index]) {
                toggleGroup(groups[index]);
                return true;
            }
            return undefined;
        };
    },
});

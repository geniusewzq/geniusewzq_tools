import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v1.8.5 loaded: VisualBrowser");

app.registerExtension({
    name: "geniusewzq.VisualBrowser",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "VisualCharacterSelector") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                const node = this;
                const pathWidget = this.widgets.find(w => w.name === "base_directory");
                const imageWidget = this.widgets.find(w => w.name === "image_path");
                
                let memoryWidget = this.widgets.find(w => w.name === "last_folder_memory") || 
                                   this.addWidget("text", "last_folder_memory", ".", (v) => {}, { serialize: true });
                memoryWidget.type = "hidden"; 

                // image_path 只是内部传值（执行时读图 + 随工作流保存），界面上不再显示这一行
                if (imageWidget) imageWidget.type = "hidden";

                // base_directory 也收进内部：路径直接由顶部路径栏显示/输入（和 Windows 资源管理器一样）
                if (pathWidget) pathWidget.type = "hidden";

                // MiniMax H3 Director 等下游节点会读上游节点里名为 "image" 的控件来显示缩略图，
                // 而且它只认 input 目录下的相对路径。选中图片时会在 input/gswq_previews 生成镜像，
                // 这里用一个隐藏控件把相对路径带出去（放在最后，避免打乱旧工作流的 widgets_values 顺序）。
                let previewWidget = null;

                // 32 位 FNV-1a（UTF-8），必须和后端 _fnv1a_hex 完全一致
                const fnv1aHex = (text) => {
                    const bytes = new TextEncoder().encode(text);
                    let h = 0x811c9dc5 >>> 0;
                    for (let i = 0; i < bytes.length; i++) {
                        h ^= bytes[i];
                        h = Math.imul(h, 0x01000193) >>> 0;
                    }
                    return h.toString(16).padStart(8, "0");
                };
                const previewRelFor = (fullPath) => {
                    const norm = String(fullPath).replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
                    return `gswq_previews/p_${fnv1aHex(norm)}.png`;
                };
                // 生成 input/gswq_previews 镜像缩略图，供下游（如 MiniMaxH3Director）按 type=input 读取
                let previewSeq = 0;
                const ensurePreview = async (fullPath, retried) => {
                    if (!fullPath) return;
                    const seq = ++previewSeq;
                    const rel = previewRelFor(fullPath);
                    const fileName = rel.split("/").pop();
                    const url = `/view?filename=${encodeURIComponent(fileName)}&subfolder=gswq_previews&type=input`;
                    // 先同步写给下游：文件名由路径哈希决定，不用等后端，避免“慢一张图”
                    if (previewWidget) previewWidget.value = rel;
                    try {
                        const res = await fetch("/geniusewzq/preview_cache", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ path: fullPath })
                        });
                        const j = await res.json();
                        if (seq !== previewSeq) return;
                        if (!j || !j.success) {
                            // 失败重试一次（多半是同时选了太多张、或图片正被占用）
                            if (!retried) { setTimeout(() => ensurePreview(fullPath, true), 600); }
                            else { console.warn("[geniusewzq] 生成预览缩略图失败:", j && j.error); }
                            return;
                        }
                        // 只预热浏览器缓存，不挂到 node.imgs —— 否则节点画布上会多出一块原生大图预览
                        new Image().src = `${url}&_=${Date.now()}`;
                    } catch (err) {
                        if (!retried) { setTimeout(() => ensurePreview(fullPath, true), 600); }
                        else { console.warn("[geniusewzq] 生成预览缩略图失败", err); }
                    }
                };

                node.viewMode = node.viewMode || "list";
                node.sortMode = node.sortMode || "date_desc";
                // 不挂原生大图预览（缩略图只镜像给下游节点用）
                node.imgs = null; node.imageIndex = 0;
                node.sidebarWidth = node.sidebarWidth || 150;
                node.expandedFolders = node.expandedFolders || new Set(["."]);
                node.focusFolder = node.focusFolder || null;
                node.renderedItems = new Map();
                node.galleryData = { tree: {}, prompts: {}, mtimes: {} };
                // 按需加载：已请求过的文件夹 + 每个文件夹的直接子文件夹数量（避免全库扫描）
                node.listingLoaded = new Set();
                node.childCounts = {};
                node.currentPreviewIndex = -1;
                node.refreshTimestamp = Date.now();

                // --- 输出端口配色：提示词=绿色 ---
                // 新前端用 color_on/color_off 渲染圆点，旧前端读取 color/bgcolor，这里全部写入以保证兼容
                const applyOutputSlotColors = () => {
                    if (!node.outputs) return;
                    const paint = (slot, color) => {
                        slot.color = color;
                        slot.bgcolor = color;
                        slot.color_on = color;
                        slot.color_off = color;
                    };
                    node.outputs.forEach((slot) => {
                        if (slot.name === "提示词" || slot.type === "STRING") paint(slot, "#81C784");
                    });
                };
                applyOutputSlotColors();

                // 旧工作流里保存的 outputs 没有颜色字段（或来自旧版本），加载后需要重新上色
                const prevOnConfigure = node.onConfigure;
                node.onConfigure = function () {
                    if (prevOnConfigure) prevOnConfigure.apply(this, arguments);
                    applyOutputSlotColors();
                };

                const mainWrapper = document.createElement("div");
                Object.assign(mainWrapper.style, {
                    display: "flex", flexDirection: "column", background: "#1a1a1a",
                    border: "1px solid #444", borderRadius: "4px", width: "100%",
                    height: "100%", overflow: "hidden", position: "relative"
                });

                // --- 载入状态遮罩 ---
                const loadingOverlay = document.createElement("div");
                Object.assign(loadingOverlay.style, {
                    position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.8)", zIndex: 10005, display: "none",
                    flexDirection: "column", alignItems: "center", justifyContent: "center",
                    color: "#00ecff", fontSize: "14px", textAlign: "center"
                });
                mainWrapper.appendChild(loadingOverlay);

                const showLoading = (html) => { loadingOverlay.innerHTML = html; loadingOverlay.style.display = "flex"; };
                const hideLoading = () => { loadingOverlay.style.display = "none"; };

                // --- 删除逻辑：先移进 .gswq_trash，5 秒内可撤销 ---
                let lastUndo = null;
                const performDelete = async (filePath) => {
                    const imagesBefore = getSortedImages().slice();
                    const idx = imagesBefore.findIndex(n => buildFullPath(n) === filePath);
                    showLoading(`<div style="font-size:24px; margin-bottom:10px;">🗑️</div><div>正在删除...</div>`);
                    let result = null;
                    try {
                        const res = await fetch(`/geniusewzq/delete_image`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: filePath })
                        });
                        result = await res.json();
                    } catch (e) {
                        result = { success: false, error: "网络请求失败" };
                    } finally {
                        hideLoading();
                    }
                    if (!result || !result.success) {
                        showToast("删除失败：" + ((result && result.error) || "未知错误"));
                        return;
                    }
                    if (overlay.style.display === "flex") closeOverlay();
                    // 删的正是当前选用的图 → 自动落到下一张（没有下一张就用上一张）
                    if (imageWidget.value === filePath) {
                        const rest = imagesBefore.filter((_, i) => i !== idx);
                        const nextName = rest.length ? rest[Math.min(idx, rest.length - 1)] : null;
                        const nextPath = nextName ? buildFullPath(nextName) : "";
                        imageWidget.value = nextPath;
                        if (imageWidget.callback) imageWidget.callback(nextPath);
                        node.setDirtyCanvas(true, true);
                    }
                    await refreshGallery();
                    lastUndo = { items: result.items || [], filePath };
                    showActionToast(`已删除 ${filePath.split('/').pop()}`, "撤销", async () => {
                        if (!lastUndo) return;
                        const items = lastUndo.items;
                        lastUndo = null;
                        try {
                            const res = await fetch(`/geniusewzq/restore_image`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ items })
                            });
                            const r = await res.json();
                            if (!r.success) throw new Error(r.error || "撤销失败");
                            await refreshGallery();
                            imageWidget.value = filePath;
                            if (imageWidget.callback) imageWidget.callback(filePath);
                            node.setDirtyCanvas(true, true);
                            updateVirtualScroll();
                            showToast("已撤销删除");
                        } catch (e) {
                            showToast("撤销失败：" + e.message);
                        }
                    }, 5000);
                };

                // --- 预览 Overlay：上半区图片、下半区提示词，两块各自独立不重叠 ---
                const overlay = document.createElement("div");
                Object.assign(overlay.style, {
                    position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                    background: "#0d0d0d", zIndex: 10000, display: "none",
                    flexDirection: "column"
                });

                // 翻页即选用：预览到哪张，节点就用哪张
                const previewState = { index: -1 };
                const buildFullPath = (imgName) => {
                    const base = String(pathWidget.value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
                    const rel = String(memoryWidget.value || ".").replace(/\\/g, "/").replace(/^\.\/?$/, "");
                    return rel ? `${base}/${rel}/${imgName}` : `${base}/${imgName}`;
                };
                const getPreviewName = () => getSortedImages()[previewState.index] || null;
                const getPreviewPath = () => { const n = getPreviewName(); return n ? buildFullPath(n) : null; };
                const commitSelection = (fullPath) => {
                    if (!fullPath) return;
                    // 统一成正斜杠，避免 image_path 出现 C:\a/b 这种混写导致下游解析失败
                    const normalized = String(fullPath).replace(/\\/g, "/").replace(/\/{2,}/g, "/");
                    ensurePreview(normalized);
                    if (imageWidget.value === normalized) return;
                    imageWidget.value = normalized;
                    if (imageWidget.callback) imageWidget.callback(normalized);
                    node.setDirtyCanvas(true, true);
                };

                // 顶部信息条：文件名 / 尺寸 / n-N / 删除
                const headerRow = document.createElement("div");
                Object.assign(headerRow.style, {
                    display: "flex", alignItems: "center", gap: "10px", flexShrink: "0",
                    padding: "10px 14px", borderBottom: "1px solid #2a2a2a", background: "rgba(20,20,20,0.6)"
                });
                const titleTag = document.createElement("div");
                Object.assign(titleTag.style, {
                    color: "#fff", fontSize: "13px", fontWeight: "bold", maxWidth: "45%",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                });
                const infoTag = document.createElement("div");
                Object.assign(infoTag.style, { color: "#00ecff", fontSize: "11px" });
                const counterEl = document.createElement("span");
                counterEl.style = "font-size:10px; color:#999;";
                const headerSpacer = document.createElement("div");
                headerSpacer.style = "flex:1;";

                const delBtn = document.createElement("button");
                delBtn.innerHTML = "🗑️ 删除";
                Object.assign(delBtn.style, {
                    padding: "5px 10px", background: "#5a1f1f", color: "#ffb4b4",
                    border: "1px solid #b30000", borderRadius: "4px", cursor: "pointer",
                    fontSize: "11px", fontWeight: "bold"
                });
                delBtn.title = "删除当前预览的图片（5 秒内可撤销）";
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    const target = getPreviewPath() || imageWidget.value;
                    if (!target) return;
                    performDelete(target);
                };

                headerRow.appendChild(titleTag);
                headerRow.appendChild(infoTag);
                headerRow.appendChild(headerSpacer);
                headerRow.appendChild(counterEl);
                headerRow.appendChild(delBtn);

                // 图片区：占据上半部分剩余高度
                const stage = document.createElement("div");
                Object.assign(stage.style, {
                    position: "relative", flex: "1", minHeight: "0", overflow: "hidden",
                    display: "flex", alignItems: "center", justifyContent: "center"
                });
                const imgDisplay = document.createElement("img");
                Object.assign(imgDisplay.style, {
                    maxWidth: "86%", maxHeight: "88%", objectFit: "contain",
                    cursor: "zoom-out", border: "1px solid #333", boxShadow: "0 0 40px rgba(0,0,0,1)"
                });
                const navBtnStyle = "position:absolute; top:50%; transform:translateY(-50%); cursor:pointer; background:rgba(255,255,255,0.06); color:white; border:none; border-radius:50%; width:52px; height:52px; font-size:28px; display:flex; align-items:center; justify-content:center; z-index:2; outline:none;";
                const prevBtn = document.createElement("button"); prevBtn.innerHTML = "‹"; prevBtn.style = navBtnStyle + "left:14px;";
                const nextBtn = document.createElement("button"); nextBtn.innerHTML = "›"; nextBtn.style = navBtnStyle + "right:14px;";
                stage.appendChild(imgDisplay);
                stage.appendChild(prevBtn);
                stage.appendChild(nextBtn);

                // 提示词区：固定高度，和图片区由分隔线分开
                const promptPanel = document.createElement("div");
                Object.assign(promptPanel.style, {
                    flexShrink: "0", height: "170px", boxSizing: "border-box",
                    display: "flex", flexDirection: "column", gap: "6px",
                    padding: "8px 14px 12px", borderTop: "1px solid #333", background: "#141414"
                });
                const promptHintRow = document.createElement("div");
                Object.assign(promptHintRow.style, { display: "flex", alignItems: "center", gap: "10px", fontSize: "10px" });
                const statusHint = document.createElement("span");
                statusHint.style = "color:#81C784;";
                statusHint.innerText = "翻页即选用 · 提示词自动保存";
                const hintBar = document.createElement("span");
                hintBar.style = "color:#777; margin-left:auto;";
                hintBar.innerText = "滚轮翻页 · Esc 关闭";
                promptHintRow.appendChild(statusHint);
                promptHintRow.appendChild(hintBar);

                const promptTextarea = document.createElement("textarea");
                Object.assign(promptTextarea.style, {
                    width: "100%", flex: "1", minHeight: "0", boxSizing: "border-box",
                    background: "rgba(30,30,30,0.95)", color: "#ccc",
                    border: "1px solid #555", borderRadius: "4px", padding: "8px",
                    fontSize: "12px", resize: "none", outline: "none"
                });
                promptTextarea.placeholder = "暂无提示词，在此输入...";

                const saveBtn = document.createElement("button");
                saveBtn.innerText = "💾 立即保存";
                Object.assign(saveBtn.style, {
                    alignSelf: "flex-end", padding: "5px 14px", background: "#2a5a3a", color: "#4caf50",
                    border: "1px solid #4caf50", borderRadius: "4px", cursor: "pointer",
                    fontSize: "11px", fontWeight: "bold"
                });

                promptPanel.appendChild(promptHintRow);
                promptPanel.appendChild(promptTextarea);
                promptPanel.appendChild(saveBtn);

                overlay.appendChild(headerRow);
                overlay.appendChild(stage);
                overlay.appendChild(promptPanel);
                mainWrapper.appendChild(overlay);

                // --- 提示词：输入停止 800ms 自动保存，按钮保留为“立即保存”兜底 ---
                let promptSaveTimer = null;
                let promptSavePath = null;   // 这段文字属于哪张图（翻页前先落盘，别存错图）
                const setSaveState = (state) => {
                    if (state === "saving") { saveBtn.innerText = "保存中..."; saveBtn.style.opacity = "0.7"; return; }
                    if (state === "saved") {
                        saveBtn.innerText = "✓ 已保存";
                        saveBtn.style.opacity = "1";
                        setTimeout(() => { saveBtn.innerText = "💾 立即保存"; }, 1200);
                        return;
                    }
                    if (state === "error") {
                        saveBtn.innerText = "✗ 保存失败";
                        saveBtn.style.opacity = "1";
                        setTimeout(() => { saveBtn.innerText = "💾 立即保存"; }, 1800);
                        return;
                    }
                    saveBtn.innerText = "💾 立即保存";
                    saveBtn.style.opacity = "1";
                };

                const savePromptNow = async (target, content) => {
                    if (!target) return false;
                    setSaveState("saving");
                    try {
                        const res = await fetch("/geniusewzq/save_prompt", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ path: target, content })
                        });
                        const result = await res.json();
                        if (!result.success) throw new Error(result.error || "保存失败");
                        markPromptFlag(target, (content || "").trim().length > 0);
                        setSaveState("saved");
                        return true;
                    } catch (err) {
                        console.error("保存提示词失败:", err);
                        setSaveState("error");
                        return false;
                    }
                };

                // 立即把挂起的自动保存写掉（翻页 / 关闭预览前调用）
                const flushPromptSave = () => {
                    if (!promptSaveTimer && !promptSavePath) return;
                    if (promptSaveTimer) { clearTimeout(promptSaveTimer); promptSaveTimer = null; }
                    const target = promptSavePath;
                    promptSavePath = null;
                    if (target) savePromptNow(target, promptTextarea.value);
                };

                promptTextarea.oninput = () => {
                    const target = getPreviewPath() || imageWidget.value;
                    if (!target) return;
                    promptSavePath = target;
                    if (promptSaveTimer) clearTimeout(promptSaveTimer);
                    promptSaveTimer = setTimeout(() => {
                        promptSaveTimer = null;
                        const t = promptSavePath;
                        promptSavePath = null;
                        savePromptNow(t, promptTextarea.value);
                    }, 800);
                };

                saveBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (promptSaveTimer) { clearTimeout(promptSaveTimer); promptSaveTimer = null; }
                    promptSavePath = null;
                    const currentImgPath = getPreviewPath() || imageWidget.value;
                    if (!currentImgPath) return;
                    await savePromptNow(currentImgPath, promptTextarea.value);
                };

                // --- 键盘事件 ---
                // 只保留 Esc 关闭；翻页用鼠标滚轮，避免和 ComfyUI/输入框的快捷键冲突
                const handleKeyDown = (e) => {
                    if (overlay.style.display !== "flex") return;
                    if (e.isComposing) return; // 输入法组字中不拦截
                    if (e.key === "Escape") {
                        e.preventDefault(); e.stopPropagation();
                        closeOverlayWithFlush();
                    }
                };
                window.addEventListener("keydown", handleKeyDown);

                // --- 滚轮翻页 ---
                // 提示词框里的滚轮留给文本框自己滚，其它位置滚轮翻页；220ms 内只翻一张，避免触控板一次滑动跳很多张
                let lastWheelAt = 0;
                const handleWheel = (e) => {
                    if (overlay.style.display !== "flex") return;
                    if (promptPanel.contains(e.target)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const now = Date.now();
                    if (now - lastWheelAt < 220) return;
                    lastWheelAt = now;
                    if (e.deltaY > 0) stepPreview(1);
                    else if (e.deltaY < 0) stepPreview(-1);
                };
                overlay.addEventListener("wheel", handleWheel, { passive: false });
                const onRemoved = node.onRemoved;
                node.onRemoved = () => { window.removeEventListener("keydown", handleKeyDown); if (onRemoved) onRemoved.apply(node, arguments); };

                const syncOverlayChrome = () => {
                    const images = getSortedImages();
                    const total = images.length;
                    counterEl.innerText = total && previewState.index >= 0 ? `${previewState.index + 1}/${total}` : "";
                    const setState = (btn, enabled) => { btn.disabled = !enabled; btn.style.opacity = enabled ? "1" : "0.25"; btn.style.cursor = enabled ? "pointer" : "default"; };
                    setState(prevBtn, total > 1);
                    setState(nextBtn, total > 1);
                };

                const renderPreview = async (index) => {
                    const images = getSortedImages();
                    if (!images.length) { closeOverlay(); return; }
                    flushPromptSave();
                    const total = images.length;
                    const clamped = ((index % total) + total) % total;   // 首尾循环翻页
                    previewState.index = clamped;
                    node.currentPreviewIndex = clamped;
                    const imgName = images[clamped];
                    const fullPath = buildFullPath(imgName);
                    commitSelection(fullPath);   // 翻页即选用
                    syncOverlayChrome();
                    updateVirtualScroll();

                    imgDisplay.style.opacity = "0.3";
                    titleTag.innerText = imgName;
                    infoTag.innerText = "载入中...";

                    // 自动加载提示词（只填到文本框，不动节点）
                    promptTextarea.value = "";
                    promptTextarea.placeholder = "加载中...";
                    try {
                        const res = await fetch(`/geniusewzq/get_prompt?path=${encodeURIComponent(fullPath)}`);
                        const data = await res.json();
                        if (previewState.index !== clamped) return; // 快速翻页时丢弃过期响应
                        promptTextarea.value = data.content || "";
                        promptTextarea.placeholder = "暂无提示词，在此输入...";
                    } catch (err) {
                        console.error("加载提示词失败:", err);
                        promptTextarea.placeholder = "加载失败，可手动输入...";
                    }

                    // 直接给展示图设 src，避免再额外下载一遍；失败时明确提示，而不是一直“载入中”
                    imgDisplay.onload = () => {
                        if (previewState.index !== clamped) return;
                        infoTag.innerText = `${imgDisplay.naturalWidth} × ${imgDisplay.naturalHeight}`;
                        imgDisplay.style.opacity = "1";
                    };
                    imgDisplay.onerror = () => {
                        if (previewState.index !== clamped) return;
                        infoTag.innerText = "图片加载失败（路径可能已失效）";
                        imgDisplay.style.opacity = "1";
                        console.warn("[geniusewzq] 无法加载图片:", fullPath);
                    };
                    imgDisplay.src = `/geniusewzq/view_image?path=${encodeURIComponent(fullPath)}&t=${Date.now()}`;
                };

                const openOverlayAt = (index) => {
                    overlay.style.display = "flex";
                    renderPreview(index);
                };
                const stepPreview = (delta) => {
                    if (overlay.style.display !== "flex") return;
                    renderPreview(previewState.index + delta);
                };
                // 关闭时把预览位置对齐到“已选用”的图，下次打开不会停在上次的浏览位置
                const closeOverlay = () => {
                    overlay.style.display = "none";
                    imgDisplay.src = "";
                    const images = getSortedImages();
                    const idx = images.findIndex(n => buildFullPath(n) === imageWidget.value);
                    previewState.index = idx;
                    node.currentPreviewIndex = idx;
                };

                // 关闭预览前先把没保存完的提示词落盘
                const closeOverlayWithFlush = () => { flushPromptSave(); closeOverlay(); };

                imgDisplay.onclick = () => closeOverlayWithFlush();
                overlay.onclick = (e) => { if (e.target === overlay) closeOverlayWithFlush(); };
                prevBtn.onclick = (e) => { e.stopPropagation(); stepPreview(-1); };
                nextBtn.onclick = (e) => { e.stopPropagation(); stepPreview(1); };
                // --- 工具栏（一排）：上一级 / 面包屑路径 / 视图 / 排序 / 刷新 ---
                const topBar = document.createElement("div");
                topBar.style = "display:flex; padding:4px 8px; background:#252525; border-bottom:1px solid #333; flex-shrink:0; height:34px; align-items:center; gap:6px; box-sizing:border-box;";
                const btnStyle = (active) => `cursor:pointer; font-size:10px; padding:3px 8px; background:${active?"#444":"#222"}; color:${active?"#00ecff":"#888"}; border:1px solid #555; border-radius:3px; outline:none;`;
                const modeGroup = document.createElement("div");
                modeGroup.style = "display:flex; gap:4px; flex-shrink:0;";
                const btnLarge = document.createElement("button"); btnLarge.innerText = "🖼️ 大图"; btnLarge.style = btnStyle(node.viewMode === "large");
                const btnList = document.createElement("button"); btnList.innerText = "📜 列表"; btnList.style = btnStyle(node.viewMode === "list");
                modeGroup.appendChild(btnLarge); modeGroup.appendChild(btnList);

                const sortSelect = document.createElement("select");
                sortSelect.style = "background:#222; color:#ccc; border:1px solid #555; font-size:10px; padding:2px; border-radius:3px; flex-shrink:0;";
                [{id:"date_desc", n:"最新在前"}, {id:"date_asc", n:"最早在前"}, {id:"name_asc", n:"名称 A-Z"}, {id:"name_desc", n:"名称 Z-A"}].forEach(s => {
                    const opt = document.createElement("option"); opt.value = s.id; opt.innerText = s.n; if(node.sortMode === s.id) opt.selected = true; sortSelect.appendChild(opt);
                });
                const refreshBtn = document.createElement("button"); refreshBtn.innerText = "↻"; refreshBtn.title = "刷新（重新读取当前目录）";
                refreshBtn.style = "width:24px; height:22px; display:flex; align-items:center; justify-content:center; background:#2a2a2a; color:#00ecff; border:1px solid #444; border-radius:3px; font-size:14px; cursor:pointer; padding:0; flex-shrink:0;";
                const locateBtn = document.createElement("button"); locateBtn.innerText = "⌖"; locateBtn.title = "回到当前选中的图片";
                locateBtn.style = "width:24px; height:22px; display:flex; align-items:center; justify-content:center; background:#2a2a2a; color:#81C784; border:1px solid #444; border-radius:3px; font-size:15px; cursor:pointer; padding:0; flex-shrink:0;";

                const upBtn = document.createElement("button"); upBtn.innerText = "↑"; upBtn.title = "上一级文件夹";
                upBtn.style = "width:24px; height:22px; display:flex; align-items:center; justify-content:center; background:#2a2a2a; color:#ccc; border:1px solid #444; border-radius:3px; font-size:12px; cursor:pointer; padding:0; flex-shrink:0;";
                const crumbBar = document.createElement("div");
                crumbBar.className = "vb-crumb";
                Object.assign(crumbBar.style, {
                    display: "flex", alignItems: "center", gap: "2px", flex: "1", minWidth: "0",
                    overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", scrollbarWidth: "none"
                });
                if (!document.getElementById("vb-crumb-style")) {
                    const st = document.createElement("style");
                    st.id = "vb-crumb-style";
                    st.textContent = ".vb-crumb::-webkit-scrollbar{height:0;width:0;display:none}";
                    document.head.appendChild(st);
                }
                topBar.appendChild(locateBtn); topBar.appendChild(upBtn); topBar.appendChild(crumbBar);
                topBar.appendChild(refreshBtn);
                topBar.appendChild(modeGroup); topBar.appendChild(sortSelect);

                const bodyContainer = document.createElement("div");
                bodyContainer.style = "display:flex; flex:1; overflow:hidden; position:relative;";
                const sidebar = document.createElement("div");
                sidebar.style = `width:${node.sidebarWidth}px; overflow-y:auto; border-right:1px solid #333; background:#1e1e1e; flex-shrink:0; padding-top:5px;`;
                const resizer = document.createElement("div");
                resizer.style = "width:4px; cursor:col-resize; background:transparent; position:relative; z-index:10; margin-left:-2px;";
                const viewport = document.createElement("div");
                viewport.style = "flex:1; overflow-y:auto; background:#111; position:relative;";
                const ghostContent = document.createElement("div"); ghostContent.style = "position:absolute; top:0; left:0; width:100%; pointer-events:none;";
                const itemContainer = document.createElement("div"); itemContainer.style = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;";
                viewport.appendChild(ghostContent); viewport.appendChild(itemContainer);
                bodyContainer.appendChild(sidebar); bodyContainer.appendChild(resizer); bodyContainer.appendChild(viewport);
                mainWrapper.appendChild(topBar); mainWrapper.appendChild(bodyContainer);

                // --- 文件夹导航辅助：路径规范化 / 展开状态 / 面包屑 ---
                const normalizeFolder = (p) => {
                    let f = (p || ".").replace(/\\/g, "/").trim();
                    f = f.replace(/^\.?\/+|\/+$/g, "");
                    return f ? f : ".";
                };
                const getCurrentFolder = () => normalizeFolder(memoryWidget.value);
                const getParentFolder = (folder) => {
                    const f = normalizeFolder(folder);
                    if (f === ".") return ".";
                    const parts = f.split("/");
                    parts.pop();
                    return parts.length ? parts.join("/") : ".";
                };
                const getRootLabel = () => {
                    const base = (pathWidget.value || "").trim().replace(/[\\/]+$/, "");
                    if (!base) return "根目录";
                    return base.split(/[\\/]/).filter(Boolean).pop() || "根目录";
                };

                // --- 绝对路径辅助（和 Windows 资源管理器一致：C:\a\b） ---
                const normSlashes = (s) => String(s || "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
                // 保留盘符根 "E:/"（去掉斜杠会变成 "E:"，Windows 上含义会变成“E: 当前目录”）
                const stripTrailingSlash = (s) => (/^[a-zA-Z]:\/$/.test(s) ? s : s.replace(/\/+$/, ""));
                const isAbsolutePath = (s) => /^[a-zA-Z]:(\/|$)/.test(s) || s.startsWith("//");
                const getBasePath = () => stripTrailingSlash(normSlashes((pathWidget.value || "").trim()));
                const getAbsoluteFolder = () => {
                    const base = getBasePath();
                    const rel = getCurrentFolder();
                    if (!base) return rel === "." ? "" : rel;
                    return rel === "." ? base : stripTrailingSlash(`${base}/${rel}`);
                };
                const splitAbsolute = (abs) => {
                    const parts = normSlashes(abs).split("/").filter(Boolean);
                    const segs = [];
                    let acc = "";
                    parts.forEach((p, i) => {
                        if (i === 0 && /^[a-zA-Z]:$/.test(p)) acc = `${p}/`;
                        else acc = acc ? (acc.endsWith("/") ? `${acc}${p}` : `${acc}/${p}`) : p;
                        segs.push({ label: p, path: stripTrailingSlash(acc) });
                    });
                    return segs;
                };
                const resolveDots = (p) => {
                    const out = [];
                    normSlashes(p).split("/").forEach(part => {
                        if (!part || part === ".") return;
                        if (part === "..") { if (out.length) out.pop(); return; }
                        out.push(part);
                    });
                    return out.join("/") || ".";
                };

                // 切换库根（路径栏里点盘符之上的段、或输入另一个绝对路径时用）
                const setBasePath = (abs) => {
                    if (!abs) return;
                    pathWidget.value = stripTrailingSlash(normSlashes(abs));
                    memoryWidget.value = ".";
                    node.expandedFolders = new Set(["."]);
                    if (pathWidget.callback) return pathWidget.callback(pathWidget.value);
                    return refreshGallery();
                };
                const folderExists = (folder) => {
                    const tree = node.galleryData && node.galleryData.tree;
                    return !!tree && Object.prototype.hasOwnProperty.call(tree, folder);
                };
                const expandAncestors = (folder) => {
                    node.expandedFolders.add(".");
                    if (!folder || folder === ".") return;
                    const parts = folder.split("/");
                    for (let i = 1; i <= parts.length; i++) node.expandedFolders.add(parts.slice(0, i).join("/"));
                };

                // 只拉一层：当前文件夹的图片 + 直接子文件夹
                const listFolder = async (folder, force) => {
                    const key = normalizeFolder(folder);
                    if (!force && node.listingLoaded.has(key)) return true;
                    const base = (pathWidget.value || "").trim();
                    if (!base) return false;
                    try {
                        const res = await fetch(`/geniusewzq/list_folder?path=${encodeURIComponent(base)}&folder=${encodeURIComponent(key)}&t=${Date.now()}`);
                        const j = await res.json();
                        if (!j || j.error) { if (j && j.error) showToast(j.error); return false; }
                        node.galleryData.tree[key] = j.files || [];
                        node.galleryData.mtimes[key] = j.mtimes || {};
                        if ((j.prompts || []).length) node.galleryData.prompts[key] = j.prompts;
                        else delete node.galleryData.prompts[key];
                        node.childCounts[key] = j.childCounts || {};
                        // 让侧栏能显示还没展开过的子文件夹
                        Object.keys(node.childCounts[key]).forEach(k => {
                            if (!(k in node.galleryData.tree)) node.galleryData.tree[k] = [];
                        });
                        node.listingLoaded.add(key);
                        return true;
                    } catch (e) {
                        console.error("[geniusewzq] 读取文件夹失败", e);
                        return false;
                    }
                };
                // 保证从库根到目标目录每一级都加载过（点路径栏/深链接时用）
                const ensureFolderChain = async (folder, force) => {
                    const key = normalizeFolder(folder);
                    if (!(await listFolder(".", force))) return false;
                    if (key === ".") return true;
                    const parts = key.split("/");
                    let cur = ".";
                    for (const p of parts) {
                        cur = cur === "." ? p : `${cur}/${p}`;
                        if (!(await listFolder(cur, force))) return false;
                    }
                    return true;
                };
                const syncToolbar = () => {
                    const base = getBasePath();
                    const baseDepth = base ? stripTrailingSlash(base).split("/").filter(Boolean).length : 0;
                    const canUp = getCurrentFolder() !== "." || (baseDepth > 1 && !/^[a-zA-Z]:[\\/]?$/.test(base));
                    upBtn.disabled = !canUp;
                    upBtn.style.opacity = canUp ? "1" : "0.35";
                    upBtn.style.cursor = canUp ? "pointer" : "default";
                };
                const renderBreadcrumb = () => {
                    const base = getBasePath();
                    const abs = getAbsoluteFolder();
                    const current = getCurrentFolder();
                    crumbBar.innerHTML = "";

                    const makeCrumb = (label, onClick, isLast, fullPath) => {
                        const el = document.createElement("span");
                        el.innerText = label;
                        el.title = isLast ? "点击可输入完整路径（回车跳转）" : fullPath;
                        Object.assign(el.style, {
                            padding: "2px 6px", borderRadius: "3px", fontSize: "11px",
                            color: isLast ? "#ffffff" : "#8ab4c8",
                            background: isLast ? "#2c2c2c" : "transparent",
                            cursor: isLast ? "text" : "pointer",
                            maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", flexShrink: "0"
                        });
                        if (isLast) {
                            // 点当前文件夹名字 = 进入编辑路径（像资源管理器的地址栏）
                            el.onmouseenter = () => { el.style.background = "#3a3a3a"; };
                            el.onmouseleave = () => { el.style.background = "#2c2c2c"; };
                            el.onclick = (e) => { e.stopPropagation(); startPathEdit(); };
                        } else if (onClick) {
                            el.onmouseenter = () => { el.style.background = "#333333"; el.style.color = "#00ecff"; };
                            el.onmouseleave = () => { el.style.background = "transparent"; el.style.color = "#8ab4c8"; };
                            el.onclick = (e) => { e.stopPropagation(); onClick(); };
                        }
                        crumbBar.appendChild(el);
                    };

                    const segs = splitAbsolute(abs);
                    if (!segs.length) {
                        makeCrumb("根目录", null, true, base);
                    } else {
                        // 路径太长时折叠中间段：盘符 … 最近两级，保证当前文件夹始终可见
                        const shown = segs.length > 4
                            ? [segs[0], { ellipsis: true, path: abs }, ...segs.slice(-2)]
                            : segs;
                        const baseLower = base.toLowerCase();
                        shown.forEach((seg, i) => {
                            if (i > 0) {
                                const sep = document.createElement("span");
                                sep.innerText = "›";
                                sep.style = "color:#555; font-size:10px; flex-shrink:0;";
                                crumbBar.appendChild(sep);
                            }
                            const isLast = i === shown.length - 1;
                            if (seg.ellipsis) {
                                makeCrumb("…", () => startPathEdit(), false, abs);
                                return;
                            }
                            const insideBase = !!base && (seg.path + "/").toLowerCase().startsWith(baseLower + "/");
                            if (insideBase) {
                                const rel = seg.path.slice(base.length).replace(/^\/+/, "") || ".";
                                makeCrumb(seg.label, () => applyFolder(rel), isLast, seg.path);
                            } else {
                                makeCrumb(seg.label, () => setBasePath(seg.path), isLast, seg.path);
                            }
                        });
                    }

                    // 点空白处直接输入路径（绝对路径 / 相对当前目录 / .. 都行）
                    const spacer = document.createElement("span");
                    spacer.style = "flex:1; min-width:8px; align-self:stretch;";
                    crumbBar.appendChild(spacer);
                    const penEl = document.createElement("span");
                    penEl.innerText = "✎";
                    Object.assign(penEl.style, { flexShrink: "0", fontSize: "10px", color: "#666", padding: "0 4px", cursor: "text" });
                    penEl.title = "点击输入完整路径";
                    penEl.onclick = (e) => { e.stopPropagation(); startPathEdit(); };
                    crumbBar.appendChild(penEl);
                    crumbBar.title = "点击空白处可输入完整路径（回车跳转，Esc 取消）";
                    crumbBar.style.cursor = "text";
                    crumbBar.onmouseenter = () => { crumbBar.style.background = "#262626"; };
                    crumbBar.onmouseleave = () => { crumbBar.style.background = "transparent"; };
                    crumbBar.onclick = (e) => {
                        if (e.target !== crumbBar && e.target !== spacer) return;
                        startPathEdit();
                    };
                    requestAnimationFrame(() => { crumbBar.scrollLeft = 0; });
                };

                const resolveTypedPath = async (raw) => {
                    const typed = (raw || "").trim();
                    if (!typed) return { ok: true, rel: "." };
                    let v = normSlashes(typed);
                    if (isAbsolutePath(v)) {
                        v = stripTrailingSlash(v);
                        let chk = { exists: false, is_dir: false };
                        try { chk = await (await fetch(`/geniusewzq/check_path?path=${encodeURIComponent(v)}`)).json(); } catch (e) {}
                        if (!chk.exists || !chk.is_dir) return { ok: false, error: `没有这个文件夹：${v}` };
                        const base = getBasePath();
                        const lowV = stripTrailingSlash(normSlashes(chk.path || v)).toLowerCase();
                        const lowB = base.toLowerCase();
                        if (base && (lowV === lowB || lowV.startsWith(lowB + "/"))) {
                            const rel = stripTrailingSlash(normSlashes(chk.path || v)).slice(base.length).replace(/^\/+/, "");
                            return { ok: true, rel: rel || "." };
                        }
                        return { ok: true, abs: stripTrailingSlash(normSlashes(chk.path || v)) };
                    }
                    // 相对路径：先按当前目录解析，找不到再按库根目录解析
                    const cur = getCurrentFolder();
                    const candidates = [];
                    if (cur !== ".") candidates.push(`${cur}/${v}`);
                    candidates.push(v);
                    for (const cand of candidates) {
                        const rel = normalizeFolder(resolveDots(cand));
                        if (folderExists(rel)) return { ok: true, rel };
                    }
                    return { ok: false, error: `没有这个文件夹：${typed}` };
                };

                let toastTimer = null;
                const showToast = (msg) => {
                    let el = mainWrapper.querySelector(".vb-toast");
                    if (!el) {
                        el = document.createElement("div");
                        el.className = "vb-toast";
                        Object.assign(el.style, {
                            position: "absolute", left: "50%", bottom: "10px", transform: "translateX(-50%)",
                            background: "rgba(20,20,20,0.95)", border: "1px solid #555", color: "#ffb4b4",
                            fontSize: "11px", padding: "6px 12px", borderRadius: "4px", zIndex: "60",
                            pointerEvents: "none", opacity: "0", transition: "opacity 0.15s"
                        });
                        mainWrapper.appendChild(el);
                    }
                    el.innerText = msg;
                    el.style.opacity = "1";
                    clearTimeout(toastTimer);
                    toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2200);
                };

                // 带操作按钮的提示条（删除后 5 秒内可撤销）
                let actionToastTimer = null;
                const hideActionToast = () => {
                    const el = mainWrapper.querySelector(".vb-action-toast");
                    if (el) el.remove();
                    clearTimeout(actionToastTimer);
                };
                const showActionToast = (msg, actionLabel, onAction, ms = 5000) => {
                    hideActionToast();
                    const el = document.createElement("div");
                    el.className = "vb-action-toast";
                    Object.assign(el.style, {
                        position: "absolute", left: "50%", bottom: "34px", transform: "translateX(-50%)",
                        display: "flex", alignItems: "center", gap: "10px",
                        background: "rgba(24,24,24,0.98)", border: "1px solid #5a5a5a", color: "#ddd",
                        fontSize: "11px", padding: "7px 10px", borderRadius: "5px", zIndex: "12000"
                    });
                    const text = document.createElement("span");
                    text.innerText = msg;
                    const btn = document.createElement("button");
                    btn.innerText = actionLabel;
                    Object.assign(btn.style, {
                        padding: "2px 8px", border: "1px solid #4caf50", borderRadius: "3px",
                        background: "transparent", color: "#7ee0a0", fontSize: "11px", cursor: "pointer"
                    });
                    btn.onclick = async (e) => {
                        e.stopPropagation();
                        hideActionToast();
                        await onAction();
                    };
                    el.appendChild(text);
                    el.appendChild(btn);
                    mainWrapper.appendChild(el);
                    actionToastTimer = setTimeout(hideActionToast, ms);
                };

                const startPathEdit = () => {
                    if (crumbBar.querySelector("input")) return;
                    const abs = getAbsoluteFolder();
                    const extra = Array.from(crumbBar.children).filter(el => !el.querySelector("input"));
                    extra.forEach(el => { el.style.display = "none"; });
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = abs;
                    input.placeholder = "输入完整路径（如 C:\\图库\\角色A），回车跳转";
                    Object.assign(input.style, {
                        flex: "1", minWidth: "0", background: "#1a1a1a", color: "#00ecff",
                        border: "1px solid #00ecff", borderRadius: "3px", fontSize: "11px",
                        padding: "2px 6px", outline: "none", boxSizing: "border-box", height: "22px"
                    });
                    const finish = async (commit) => {
                        const typed = input.value;
                        input.remove();
                        Array.from(crumbBar.children).forEach(el => { el.style.display = ""; });
                        if (!commit) { renderBreadcrumb(); return; }
                        const res = await resolveTypedPath(typed);
                        if (!res.ok) {
                            renderBreadcrumb();
                            showToast(res.error || "路径无效");
                            return;
                        }
                        if (res.abs) { setBasePath(res.abs); return; }
                        applyFolder(res.rel);
                    };
                    input.onkeydown = (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") { e.preventDefault(); finish(true); }
                        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
                    };
                    input.onblur = () => finish(false);
                    crumbBar.appendChild(input);
                    requestAnimationFrame(() => { input.focus(); input.select(); });
                };

                const renderSidebar = () => {
                    sidebar.innerHTML = "";
                    if (!node.galleryData || node.galleryData.error) return;
                    const folders = Object.keys(node.galleryData.tree).sort();
                    const childrenMap = new Map();
                    folders.forEach(f => {
                        if (f === ".") return;
                        const parent = getParentFolder(f);
                        if (!childrenMap.has(parent)) childrenMap.set(parent, []);
                        childrenMap.get(parent).push(f);
                    });
                    const current = getCurrentFolder();
                    let selectedEl = null;
                    const buildTreeElement = (path, depth) => {
                        const children = childrenMap.get(path) || [];
                        const hasChildren = children.length > 0;
                        const isSelected = current === path;
                        const isExpanded = node.expandedFolders.has(path);
                        const item = document.createElement("div");
                        item.style = `padding:5px 6px; padding-left:${depth * 12 + 4}px; cursor:pointer; font-size:11px; display:flex; align-items:center; gap:3px; color:${isSelected?"#00ecff":"#ccc"}; background:${isSelected?"#2a2a2a":"transparent"}; border-radius:2px; margin:1px 4px; white-space:nowrap; overflow:hidden;`;
                        item.title = path === "." ? (pathWidget.value || "").trim() : path;
                        item.onmouseenter = () => { if (!isSelected) item.style.background = "#262626"; };
                        item.onmouseleave = () => { if (!isSelected) item.style.background = "transparent"; };
                        const arrow = document.createElement("span");
                        arrow.innerText = hasChildren ? (isExpanded ? "▾" : "▸") : "";
                        Object.assign(arrow.style, {
                            width: "12px", flexShrink: "0", textAlign: "center", fontSize: "9px",
                            color: isSelected ? "#00ecff" : "#666", cursor: hasChildren ? "pointer" : "default",
                            padding: "2px 0"
                        });
                        if (hasChildren) {
                            arrow.title = isExpanded ? "折叠" : "展开";
                            arrow.onclick = (e) => {
                                e.stopPropagation();
                                if (node.expandedFolders.has(path)) node.expandedFolders.delete(path);
                                else node.expandedFolders.add(path);
                                renderSidebar();
                            };
                        }
                        const icon = document.createElement("span");
                        icon.innerText = isExpanded && hasChildren ? "📂" : "📁";
                        icon.style = "font-size:11px; flex-shrink:0;";
                        const label = document.createElement("span");
                        label.innerText = path === "." ? "根目录" : path.split("/").pop();
                        label.style = "overflow:hidden; text-overflow:ellipsis;";
                        item.appendChild(arrow); item.appendChild(icon); item.appendChild(label);
                        item.onclick = (e) => {
                            if (e.target === arrow) return;
                            e.stopPropagation();
                            applyFolder(path);
                        };
                        if (isSelected) selectedEl = item;
                        sidebar.appendChild(item);
                        if (isExpanded && hasChildren) children.forEach(child => buildTreeElement(child, depth + 1));
                    };
                    buildTreeElement(".", 0);
                    if (selectedEl) {
                        requestAnimationFrame(() => {
                            if (!selectedEl.isConnected) return;
                            const top = selectedEl.offsetTop;
                            const bottom = top + selectedEl.offsetHeight;
                            if (top < sidebar.scrollTop || bottom > sidebar.scrollTop + sidebar.clientHeight) {
                                sidebar.scrollTop = Math.max(0, top - sidebar.clientHeight / 2);
                            }
                        });
                    }
                };

                // 切换文件夹（按需加载目标目录及其祖先，只请求一层）
                const applyFolder = async (folder) => {
                    const target = normalizeFolder(folder);
                    const prev = getCurrentFolder();
                    node.focusFolder = null;
                    memoryWidget.value = target;
                    expandAncestors(target);
                    const ok = await ensureFolderChain(target);
                    if (!ok) {
                        memoryWidget.value = prev;
                        return false;
                    }
                    renderSidebar();
                    renderBreadcrumb();
                    clearAndRefresh();
                    viewport.scrollTop = 0;
                    syncToolbar();
                    return true;
                };

                upBtn.onclick = async () => {
                    const current = getCurrentFolder();
                    if (current !== ".") { applyFolder(getParentFolder(current)); return; }
                    // 已经在库根：往上就是 base 的父目录（真正的上一级）
                    const base = getBasePath();
                    if (!base || /^[a-zA-Z]:\/$/.test(base)) { showToast("已经是顶层目录了"); return; }
                    let parent = base.replace(/\/[^\/]+$/, "");
                    if (/^[a-zA-Z]:$/.test(parent)) parent += "/";
                    let chk = { exists: false, is_dir: false };
                    try { chk = await (await fetch(`/geniusewzq/check_path?path=${encodeURIComponent(parent)}`)).json(); } catch (e) {}
                    if (chk.exists && chk.is_dir) { await setBasePath(parent); syncToolbar(); }
                    else showToast("已经是顶层目录了");
                };
                crumbBar.onwheel = (e) => {
                    if (crumbBar.scrollWidth <= crumbBar.clientWidth) return;
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        crumbBar.scrollLeft += e.deltaY;
                        e.preventDefault();
                    }
                };

                const getSortedImages = () => {
                    // memoryWidget 里可能是 "A\B" 这种反斜杠写法（旧工作流），先归一化
                    const folder = normalizeFolder(memoryWidget.value || ".");
                    let list = node.galleryData?.tree?.[folder] || [];
                    const sorted = [...list];
                    const mt = (name) => node.galleryData?.mtimes?.[folder]?.[name] || 0;
                    if (node.sortMode === "name_asc") sorted.sort((a,b) => a.localeCompare(b));
                    if (node.sortMode === "name_desc") sorted.sort((a,b) => b.localeCompare(a));
                    if (node.sortMode === "date_desc") sorted.sort((a,b) => mt(b) - mt(a) || a.localeCompare(b));
                    if (node.sortMode === "date_asc") sorted.sort((a,b) => mt(a) - mt(b) || a.localeCompare(b));
                    return sorted;
                };

                // 从绝对路径拆出“相对根目录的文件夹 + 文件名”（不依赖当前浏览位置）
                const splitPath = (fullPath) => {
                    const base = (pathWidget.value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
                    let f = (fullPath || "").replace(/\\/g, "/");
                    if (base && f.toLowerCase().startsWith(base.toLowerCase())) f = f.slice(base.length);
                    f = f.replace(/^\/+/, "");
                    const parts = f.split("/");
                    const name = parts.pop() || "";
                    return { folder: parts.join("/") || ".", name };
                };

                // 该图是否有同名的非空 txt（后端 get_gallery 里顺手统计好，前端不用再多请求）
                const hasPrompt = (fullPath) => {
                    const { folder, name } = splitPath(fullPath);
                    const list = node.galleryData?.prompts?.[folder];
                    return Array.isArray(list) && list.includes(name);
                };
                const markPromptFlag = (fullPath, has) => {
                    const { folder, name } = splitPath(fullPath);
                    if (!node.galleryData.prompts) node.galleryData.prompts = {};
                    const list = node.galleryData.prompts[folder] || (node.galleryData.prompts[folder] = []);
                    const i = list.indexOf(name);
                    if (has && i === -1) list.push(name);
                    if (!has && i !== -1) list.splice(i, 1);
                    updateVirtualScroll();
                };

                // 当前文件夹下的直接子文件夹（浏览区里也显示，可双击进入）
                const getSubfolders = () => {
                    const folder = getCurrentFolder();
                    const tree = node.galleryData?.tree || {};
                    return Object.keys(tree)
                        .filter(p => p !== "." && getParentFolder(p) === folder)
                        .sort((a, b) => a.localeCompare(b));
                };

                const updateVirtualScroll = () => {
                    const curFolder = getCurrentFolder();
                    const images = getSortedImages();
                    const subfolders = getSubfolders();
                    const entries = [
                        ...subfolders.map(p => ({ kind: "folder", path: p, name: p.split("/").pop(), count: (node.childCounts[curFolder] || {})[p] ?? (node.galleryData.tree[p] || []).length })),
                        ...images.map(n => ({ kind: "image", name: n }))
                    ];
                    const isList = node.viewMode === "list";
                    const cols = isList ? 1 : 3;
                    const gap = isList ? 2 : 10; const padding = 10;
                    const viewWidth = viewport.clientWidth || 450;
                    const itemWidth = isList ? (viewWidth - 25) : (viewWidth - (padding * 2) - (gap * (cols - 1))) / cols;
                    const rowHeight = (isList ? 26 : itemWidth) + gap;
                    ghostContent.style.height = (Math.ceil(entries.length / cols) * rowHeight + padding * 2) + "px";
                    const scrollTop = viewport.scrollTop;
                    const startRow = Math.max(0, Math.floor((scrollTop - padding) / rowHeight) - 1);
                    const endRow = Math.min(Math.ceil(entries.length / cols), startRow + (Math.ceil((viewport.clientHeight || 600) / rowHeight) + 2));
                    const startIndex = startRow * cols;
                    const endIndex = Math.min(entries.length, endRow * cols);
                    const currentVisibleKeys = new Set();
                    const currentPath = pathWidget.value.trim();
                    const folder = normalizeFolder(memoryWidget.value || ".");

                    for (let i = startIndex; i < endIndex; i++) {
                        const entry = entries[i];
                        if (!entry) continue;
                        const isFolder = entry.kind === "folder";
                        const fullPath = isFolder ? null : buildFullPath(entry.name);
                        const key = isFolder ? `dir:${entry.path}` : fullPath;
                        currentVisibleKeys.add(key);
                        const isSelected = isFolder ? node.focusFolder === entry.path : normSlashes(imageWidget.value) === fullPath;
                        const x = padding + (i % cols) * (itemWidth + gap);
                        const y = padding + Math.floor(i / cols) * rowHeight;
                        if (!node.renderedItems.has(key)) {
                            const box = document.createElement("div");
                            box._key = key;
                            box.style = `position:absolute; pointer-events:auto; overflow:hidden; box-sizing:border-box;`;
                            if (isFolder) {
                                box.style.cursor = "pointer";
                                if (isList) {
                                    box.style.lineHeight = "22px"; box.style.padding = "0 10px"; box.style.fontSize = "12px";
                                    box.style.display = "flex"; box.style.alignItems = "center"; box.style.gap = "6px";
                                    const iconEl = document.createElement("span"); iconEl.innerText = "📁"; iconEl.style = "flex-shrink:0; font-size:11px;";
                                    const nameEl = document.createElement("span");
                                    nameEl.style = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#ffffff;";
                                    box.appendChild(iconEl); box.appendChild(nameEl);
                                    box._nameEl = nameEl;
                                } else {
                                    box.style.background = "#1b1b1b"; box.style.borderRadius = "4px";
                                    const glyph = document.createElement("div");
                                    glyph.innerText = "📁";
                                    Object.assign(glyph.style, {
                                        position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
                                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", opacity: "0.75"
                                    });
                                    box.appendChild(glyph);
                                    // 大图模式下文件夹仍显示名称
                                    const nameEl = document.createElement("div");
                                    Object.assign(nameEl.style, {
                                        position: "absolute", left: "0", right: "0", bottom: "0",
                                        padding: "2px 4px", textAlign: "center", fontSize: "10px", lineHeight: "14px",
                                        color: "#ffffff", background: "rgba(0,0,0,0.5)",
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                                    });
                                    box.appendChild(nameEl);
                                    box._nameEl = nameEl;
                                }
                                box.title = `${entry.path}（双击进入）`;
                                box.onclick = (e) => {
                                    e.stopPropagation();
                                    node.focusFolder = entry.path;
                                    updateVirtualScroll();
                                };
                                box.ondblclick = (e) => { e.stopPropagation(); applyFolder(entry.path); };
                                box.tabIndex = 0;
                                box.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); applyFolder(entry.path); } };
                            } else if (isList) {
                                box.style.lineHeight = "22px"; box.style.padding = "0 10px"; box.style.fontSize = "12px";
                                box.style.display = "flex"; box.style.alignItems = "center"; box.style.gap = "6px";
                                const nameEl = document.createElement("span");
                                nameEl.style = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                                const markEl = document.createElement("span");
                                markEl.innerText = "词"; markEl.title = "有提示词(txt)";
                                markEl.style = "flex-shrink:0; font-size:9px; line-height:13px; color:#81C784; background:rgba(129,199,132,0.12); border-radius:3px; padding:0 3px; opacity:0;";
                                box.appendChild(nameEl); box.appendChild(markEl);
                                box._nameEl = nameEl; box._markEl = markEl;
                            } else {
                                box.style.background = "#222"; box.style.borderRadius = "4px";
                                const img = document.createElement("img"); img.style = "width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity 0.3s;";
                                img.loading = "lazy"; img.decoding = "async";
                                img.src = `/geniusewzq/view_image?path=${encodeURIComponent(fullPath)}&thumb=320&t=${node.refreshTimestamp}`; img.onload = () => img.style.opacity = "1";
                                box.appendChild(img);
                                const markEl = document.createElement("span");
                                markEl.innerText = "词"; markEl.title = "有提示词(txt)";
                                markEl.style = "position:absolute; top:3px; left:3px; font-size:9px; line-height:14px; background:rgba(0,0,0,0.65); border-radius:3px; padding:0 3px; color:#81C784; opacity:0;";
                                box.appendChild(markEl);
                                box._markEl = markEl;

                            }
                            if (!isFolder) {
                                // 单击 = 选用这张图；双击 = 打开大图预览
                                const imgIdx = images.indexOf(entry.name);
                                box.onclick = () => {
                                    commitSelection(fullPath);
                                    updateVirtualScroll();
                                };
                                box.ondblclick = () => {
                                    commitSelection(fullPath);
                                    openOverlayAt(imgIdx);
                                };
                            }
                            itemContainer.appendChild(box); node.renderedItems.set(key, box);
                        }
                        const box = node.renderedItems.get(key);
                        box.style.width = `${itemWidth}px`; box.style.height = `${isList ? 26 : itemWidth}px`;
                        box.style.transform = `translate(${x}px, ${y}px)`;
                        if (box._nameEl) box._nameEl.innerText = entry.name;
                        if (box._countEl) box._countEl.innerText = isFolder && entry.count ? String(entry.count) : "";
                        if (isFolder) {
                            if (isList) {
                                box.style.background = isSelected ? "#2a2a2a" : "transparent";
                            } else {
                                box.style.border = isSelected ? "2px solid #cccccc" : "1px solid #333";
                            }
                            continue;
                        }
                        const showMark = hasPrompt(fullPath);
                        box.title = entry.name + (showMark ? "（有提示词）" : "");
                        if (box._markEl) box._markEl.style.opacity = showMark ? "1" : "0";
                        if (isList) {
                            box.style.color = isSelected ? "#00ecff" : "#ccc"; box.style.background = isSelected ? "#2a2a2a" : "transparent";
                        } else {
                            box.style.border = isSelected ? "2px solid #00ecff" : "1px solid #333";
                        }
                    }
                    for (const [key, element] of node.renderedItems) { if (!currentVisibleKeys.has(key)) { element.remove(); node.renderedItems.delete(key); } }
                };

                const clearAndRefresh = () => { node.renderedItems.forEach(el => el.remove()); node.renderedItems.clear(); updateVirtualScroll(); };

                const refreshGallery = async () => {
                    const base = pathWidget.value?.trim();
                    if (!base) return;
                    showLoading(`<div style="margin-bottom:10px; font-size:24px;">⌛</div><div>同步中...</div>`);
                    try {
                        // 更新时间戳，强制刷新图片缓存
                        node.refreshTimestamp = Date.now();
                        // 刷新 = 丢掉按需加载的缓存，只重新拉当前这条链（不扫全库）
                        node.listingLoaded = new Set();
                        node.childCounts = {};
                        node.galleryData = { tree: {}, prompts: {}, mtimes: {} };
                        let current = getCurrentFolder();
                        if (!(await ensureFolderChain(current, true))) {
                            current = ".";
                            memoryWidget.value = ".";
                            await ensureFolderChain(".", true);
                        }
                        expandAncestors(current);
                        renderSidebar();
                        renderBreadcrumb();
                        clearAndRefresh();
                        syncToolbar();
                        // 首次打开时 DOM 可能尚未完成布局（viewport.clientHeight=0/偏小），
                        // 等下一帧及稍后布局稳定后各重算一次，避免列表只渲染前几行
                        requestAnimationFrame(() => updateVirtualScroll());
                        setTimeout(() => updateVirtualScroll(), 120);
                    } catch (e) { console.error(e); } finally { hideLoading(); }
                };

                // 回到当前选中的图片：切到它所在目录并滚动高亮
                const scrollToSelected = async () => {
                    const full = normSlashes((imageWidget.value || "").trim());
                    if (!full) { showToast("还没有选图：先在浏览区点一张"); return; }
                    const base = getBasePath();
                    const lowFull = full.toLowerCase();
                    let folderRel = null;
                    if (base && lowFull.startsWith(base.toLowerCase() + "/")) {
                        const rel = full.slice(base.length + 1);
                        folderRel = rel.split("/").slice(0, -1).join("/") || ".";
                    }
                    if (folderRel === null) {
                        // 选中的图不在当前库根下：把库根切到它所在目录的「父目录」，
                        // 这样左侧目录树仍然能看到这一层和它的兄弟，不会变成空的。
                        const dir = full.split("/").slice(0, -1).join("/");
                        const parts = dir.split("/").filter(Boolean);
                        if (!dir) { showToast("图片路径无效"); return; }
                        if (parts.length > 1) {
                            await setBasePath(parts.slice(0, -1).join("/"));
                            folderRel = parts[parts.length - 1];
                        } else {
                            await setBasePath(dir);
                            folderRel = ".";
                        }
                    }
                    if (normalizeFolder(folderRel) !== getCurrentFolder()) {
                        const ok = await applyFolder(folderRel);
                        if (!ok) { showToast("打不开这张图所在的目录"); return; }
                    }
                    const name = full.split("/").pop();
                    const images = getSortedImages();
                    const idx = images.indexOf(name);
                    if (idx < 0) { showToast("这张图不在当前目录（可能已被移动或删除）"); return; }
                    const isList = node.viewMode === "list";
                    const cols = isList ? 1 : 3;
                    const gap = isList ? 2 : 10; const padding = 10;
                    const viewWidth = viewport.clientWidth || 450;
                    const itemWidth = isList ? (viewWidth - 25) : (viewWidth - (padding * 2) - (gap * (cols - 1))) / cols;
                    const rowHeight = (isList ? 26 : itemWidth) + gap;
                    const index = getSubfolders().length + idx;
                    const top = padding + Math.floor(index / cols) * rowHeight;
                    viewport.scrollTop = Math.max(0, top - Math.max(0, viewport.clientHeight / 2 - rowHeight / 2));
                    updateVirtualScroll();
                    requestAnimationFrame(() => {
                        const target = [...itemContainer.children].find(el => el._key && String(el._key).toLowerCase() === full.toLowerCase());
                        if (!target) return;
                        target.style.boxShadow = "inset 0 0 0 2px #00ecff";
                        setTimeout(() => { target.style.boxShadow = ""; }, 1400);
                    });
                };

                btnLarge.onclick = () => { node.viewMode = "large"; btnLarge.style = btnStyle(true); btnList.style = btnStyle(false); clearAndRefresh(); };
                btnList.onclick = () => { node.viewMode = "list"; btnLarge.style = btnStyle(false); btnList.style = btnStyle(true); clearAndRefresh(); };
                sortSelect.onchange = (e) => { node.sortMode = e.target.value; clearAndRefresh(); };
                refreshBtn.onclick = () => refreshGallery();
                locateBtn.onclick = () => scrollToSelected();
                viewport.onscroll = updateVirtualScroll;

                this.addDOMWidget("gallery_ui", "HTML", mainWrapper);

                // 放在 gallery 之后：旧工作流前 4 个 widgets_values 仍然一一对应
                previewWidget = node.widgets.find(w => w.name === "image");
                if (!previewWidget) {
                    previewWidget = node.addWidget("text", "image", "", () => {}, { serialize: true });
                    previewWidget.type = "hidden";
                }
                // 换库根目录时回到根目录
                pathWidget.callback = () => {
                    memoryWidget.value = ".";
                    return refreshGallery();
                };
                node.onResize = () => { if (node.resizeTimer) clearTimeout(node.resizeTimer); node.resizeTimer = setTimeout(() => updateVirtualScroll(), 60); };

                // 视口尺寸变化（含首次布局完成、侧栏拖拽、节点缩放）→ 自动重算可见行，
                // 从根本上避免“刚打开时列表只显示一部分”
                if (window.ResizeObserver) {
                    const ro = new ResizeObserver(() => {
                        if (node.resizeTimer) clearTimeout(node.resizeTimer);
                        node.resizeTimer = setTimeout(() => updateVirtualScroll(), 60);
                    });
                    ro.observe(viewport);
                    node._gswqGalleryResizeObserver = ro;
                }
                
                let isResizing = false;
                resizer.onmousedown = (e) => { isResizing = true; document.body.style.cursor = "col-resize"; e.preventDefault(); };
                window.addEventListener("mousemove", (e) => {
                    if (!isResizing) return;
                    const rect = bodyContainer.getBoundingClientRect();
                    let newWidth = e.clientX - rect.left;
                    newWidth = Math.max(100, Math.min(newWidth, 400));
                    node.sidebarWidth = newWidth; sidebar.style.width = `${newWidth}px`; updateVirtualScroll();
                });
                window.addEventListener("mouseup", () => { isResizing = false; document.body.style.cursor = "default"; });

                // --- 拖拽上传功能 ---
                const setupDragAndDrop = () => {
                    // 阻止默认拖拽行为
                    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                        mainWrapper.addEventListener(eventName, (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }, false);
                    });

                    // 拖拽进入时的视觉反馈
                    mainWrapper.addEventListener('dragenter', () => {
                        mainWrapper.style.border = '2px dashed #00ecff';
                    });

                    mainWrapper.addEventListener('dragleave', () => {
                        mainWrapper.style.border = '1px solid #444';
                    });

                    // 处理拖放
                    mainWrapper.addEventListener('drop', async (e) => {
                        mainWrapper.style.border = '1px solid #444';
                        const files = e.dataTransfer.files;
                        await handleImageFiles(files);
                    });
                };

                // --- 粘贴上传功能 ---
                const setupPaste = () => {
                    document.addEventListener('paste', async (e) => {
                        // 只有当节点被选中时才处理粘贴
                        if (!node.selected) return;
                        
                        const items = e.clipboardData.items;
                        const imageFiles = [];
                        
                        for (let i = 0; i < items.length; i++) {
                            if (items[i].type.indexOf('image') !== -1) {
                                const blob = items[i].getAsFile();
                                imageFiles.push(blob);
                            }
                        }
                        
                        if (imageFiles.length > 0) {
                            await handleImageFiles(imageFiles);
                        }
                    });
                };

                // --- 处理图片文件上传 ---
                const handleImageFiles = async (files) => {
                    const currentPath = pathWidget.value?.trim();
                    const folder = memoryWidget.value || ".";
                    const targetDir = `${currentPath}/${folder}`.replace(/\/+/g, '/');
                    
                    if (!currentPath) {
                        alert("请先设置基础目录");
                        return;
                    }

                    showLoading(`<div style="font-size:24px; margin-bottom:10px;">📤</div><div>正在上传...</div>`);
                    
                    const uploadedFiles = [];
                    
                    for (const file of files) {
                        if (!file.type.startsWith('image/')) continue;
                        
                        const formData = new FormData();
                        formData.append('image', file);
                        formData.append('targetDir', targetDir);
                        
                        try {
                            const res = await fetch('/geniusewzq/upload_image', {
                                method: 'POST',
                                body: formData
                            });
                            const result = await res.json();
                            if (result.success) {
                                uploadedFiles.push(result.filename);
                            } else {
                                console.error('上传失败:', result.error);
                            }
                        } catch (err) {
                            console.error('上传出错:', err);
                        }
                    }
                    
                    hideLoading();
                    
                    if (uploadedFiles.length > 0) {
                        // 刷新画廊
                        await refreshGallery();
                        // 选中新上传的第一张图片
                        const lastUploaded = uploadedFiles[uploadedFiles.length - 1];
                        selectImageByName(lastUploaded);
                    }
                };

                // --- 根据图片名称选择图片 ---
                const selectImageByName = (imgName) => {
                    const images = getSortedImages();
                    const index = images.indexOf(imgName);
                    if (index !== -1) {
                        const folder = memoryWidget.value || ".";
                        const currentPath = pathWidget.value.trim();
                        const fullPath = `${currentPath}/${folder}/${imgName}`.replace(/\/+/g, '/');
                        imageWidget.value = fullPath;
                        if (imageWidget.callback) imageWidget.callback(fullPath);
                        node.setDirtyCanvas(true, true);
                        updateVirtualScroll();
                        // 滚动到新图片位置
                        const isList = node.viewMode === "list";
                        const cols = isList ? 1 : 3;
                        const gap = isList ? 2 : 10;
                        const padding = 10;
                        const viewWidth = viewport.clientWidth || 450;
                        const itemWidth = isList ? (viewWidth - 25) : (viewWidth - (padding * 2) - (gap * (cols - 1))) / cols;
                        const rowHeight = (isList ? 26 : itemWidth) + gap;
                        const rowIndex = Math.floor(index / cols);
                        viewport.scrollTop = rowIndex * rowHeight;
                    }
                };

                setupDragAndDrop();
                setupPaste();

                // 旧工作流里 memoryWidget 可能是 "A\B" / "./A" 这种写法，入口处先归一化
                memoryWidget.value = normalizeFolder(memoryWidget.value || ".");
                setTimeout(refreshGallery, 500);
                // 打开已保存的工作流时，把上次选中的图片同步成预览缩略图
                if (imageWidget && imageWidget.value) {
                    setTimeout(() => ensurePreview(imageWidget.value), 900);
                }
                this.setSize([650, 650]);
            };
        }
    }
});

































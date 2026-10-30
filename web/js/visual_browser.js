import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v1.5.1 loaded: VisualBrowser");

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

                node.viewMode = node.viewMode || "list";
                node.sortMode = node.sortMode || "name_asc";
                node.sidebarWidth = node.sidebarWidth || 150;
                node.expandedFolders = node.expandedFolders || new Set(["."]);
                node.navHistory = node.navHistory || [];
                node.navIndex = node.navIndex || 0;
                node.renderedItems = new Map();
                node.galleryData = { tree: {} };
                node.currentPreviewIndex = -1;
                node.refreshTimestamp = Date.now();

                // --- 输出端口配色：提示词=绿色，透明通道=灰色 ---
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
                        else if (slot.name === "透明通道" || slot.type === "MASK") paint(slot, "#8c8c8c");
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

                // --- 自定义 UI 确认框 (居中显示) ---
                const createConfirmModal = (title, message, onConfirm) => {
                    const modalOverlay = document.createElement("div");
                    Object.assign(modalOverlay.style, {
                        position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
                        background: "rgba(0,0,0,0.7)", zIndex: 20000, display: "flex",
                        alignItems: "center", justifyContent: "center"
                    });
                    const dialog = document.createElement("div");
                    Object.assign(dialog.style, {
                        background: "#222", border: "1px solid #00ecff", borderRadius: "8px",
                        padding: "20px", width: "300px", textAlign: "center", color: "white",
                        boxShadow: "0 0 20px rgba(0,0,0,0.5)"
                    });
                    dialog.innerHTML = `<h3 style="margin:0 0 10px; color:#00ecff;">${title}</h3><p style="font-size:12px; color:#ccc; word-break:break-all;">${message}</p>`;
                    
                    const btnContainer = document.createElement("div");
                    btnContainer.style = "display:flex; justify-content:center; gap:10px; margin-top:20px;";
                    
                    const yesBtn = document.createElement("button");
                    yesBtn.innerText = "确认删除";
                    yesBtn.style = "padding:6px 15px; background:#b30000; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;";
                    
                    const noBtn = document.createElement("button");
                    noBtn.innerText = "取消";
                    noBtn.style = "padding:6px 15px; background:#444; color:white; border:none; border-radius:4px; cursor:pointer;";
                    
                    const close = () => document.body.removeChild(modalOverlay);
                    yesBtn.onclick = () => { onConfirm(); close(); };
                    noBtn.onclick = close;
                    
                    btnContainer.appendChild(noBtn);
                    btnContainer.appendChild(yesBtn);
                    dialog.appendChild(btnContainer);
                    modalOverlay.appendChild(dialog);
                    document.body.appendChild(modalOverlay);
                };

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

                // --- 删除逻辑 ---
                const performDelete = async (filePath) => {
                    showLoading(`<div style="font-size:24px; margin-bottom:10px;">🗑️</div><div>正在处理...</div>`);
                    try {
                        const res = await fetch(`/geniusewzq/delete_image`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: filePath })
                        });
                        const result = await res.json();
                        if (result.success) {
                            if (overlay.style.display === "block") {
                                overlay.style.display = "none";
                                imgDisplay.src = "";
                                previewState.index = -1;
                                node.currentPreviewIndex = -1;
                            }
                            await refreshGallery(); 
                        } else {
                            alert("删除失败: " + (result.error || "未知错误"));
                        }
                    } catch (e) {
                        alert("网络请求失败，请检查后端路由设置");
                    } finally {
                        hideLoading();
                    }
                };

                // --- 预览 Overlay ---
                const overlay = document.createElement("div");
                Object.assign(overlay.style, { position:"absolute", top:0, left:0, width:"100%", height:"100%", background:"rgba(0,0,0,0.95)", zIndex:10000, display:"none" });

                // 预览状态与“已选用”状态分离：在大图里翻页只是浏览，不会改掉节点正在用的图
                const previewState = { index: -1 };
                const buildFullPath = (imgName) => `${pathWidget.value.trim()}/${memoryWidget.value || "."}/${imgName}`.replace(/\/+/g, '/');
                const getPreviewName = () => getSortedImages()[previewState.index] || null;
                const getPreviewPath = () => { const n = getPreviewName(); return n ? buildFullPath(n) : null; };
                const isPreviewSelected = () => { const p = getPreviewPath(); return !!p && p === imageWidget.value; };

                // “使用此图”：把当前预览的图片设为节点图片（唯一会改变 image_path 的入口）
                const useBtn = document.createElement("button");
                useBtn.innerText = "✅ 使用此图";
                Object.assign(useBtn.style, {
                    position: "absolute", top: "20px", right: "140px", padding: "8px 16px",
                    background: "#1f4d33", color: "#7ee0a0", border: "1px solid #4caf50", borderRadius: "4px",
                    cursor: "pointer", fontSize: "12px", zIndex: 10003, fontWeight: "bold", display: "none"
                });
                const browseHint = document.createElement("div");
                Object.assign(browseHint.style, {
                    position: "absolute", top: "56px", left: "50%", transform: "translateX(-50%)",
                    color: "#e0b060", fontSize: "11px", zIndex: 10002, pointerEvents: "none", display: "none"
                });
                browseHint.innerText = "浏览中（未选用）— 点“✅ 使用此图”才会替换节点图片";

                const delBtn = document.createElement("button");
                delBtn.innerHTML = "🗑️ 删除图片";
                Object.assign(delBtn.style, {
                    position: "absolute", top: "20px", right: "20px", padding: "8px 16px",
                    background: "#b30000", color: "white", border: "none", borderRadius: "4px",
                    cursor: "pointer", fontSize: "12px", zIndex: 10003, fontWeight: "bold"
                });
                delBtn.onclick = (e) => { 
                    e.stopPropagation(); 
                    const target = getPreviewPath() || imageWidget.value;
                    if (!target) return;
                    createConfirmModal("删除确认", `文件：${target.split('/').pop()}`, () => performDelete(target));
                };

                const titleTag = document.createElement("div");
                Object.assign(titleTag.style, { position:"absolute", top:"20px", left:"50%", transform:"translateX(-50%)", color:"#fff", fontSize:"14px", fontWeight:"bold", width:"50%", textAlign:"center", zIndex:10002, pointerEvents:"none" });

                const infoTag = document.createElement("div");
                Object.assign(infoTag.style, { position:"absolute", top:"42px", left:"50%", transform:"translateX(-50%)", color:"#00ecff", fontSize:"12px", zIndex:10002, pointerEvents:"none" });
                
                const navBtnStyle = "position:absolute; top:50%; transform:translateY(-50%); cursor:pointer; background:rgba(255,255,255,0.05); color:white; border:none; border-radius:50%; width:60px; height:60px; font-size:32px; display:flex; align-items:center; justify-content:center; z-index:10002; outline:none;";
                const prevBtn = document.createElement("button"); prevBtn.innerHTML = "‹"; prevBtn.style = navBtnStyle + "left:20px;";
                const nextBtn = document.createElement("button"); nextBtn.innerHTML = "›"; nextBtn.style = navBtnStyle + "right:20px;";
                
                const imgDisplay = document.createElement("img");
                Object.assign(imgDisplay.style, { position:"absolute", top:"50%", left:"50%", transform:"translate(-50%, -50%)", maxWidth:"75%", maxHeight:"75%", objectFit:"contain", cursor:"zoom-out", border:"1px solid #333", boxShadow:"0 0 50px rgba(0,0,0,1)", zIndex:10001 });
                
                // --- 底部提示词编辑区域 ---
                const promptContainer = document.createElement("div");
                Object.assign(promptContainer.style, {
                    position: "absolute",
                    bottom: "20px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "60%",
                    maxWidth: "600px",
                    zIndex: 10002,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px"
                });

                const promptTextarea = document.createElement("textarea");
                Object.assign(promptTextarea.style, {
                    width: "100%",
                    height: "80px",
                    background: "rgba(30,30,30,0.95)",
                    color: "#ccc",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    padding: "8px",
                    fontSize: "12px",
                    resize: "none",
                    outline: "none"
                });
                promptTextarea.placeholder = "点击加载提示词...";

                const saveBtn = document.createElement("button");
                saveBtn.innerText = "💾 保存提示词";
                Object.assign(saveBtn.style, {
                    alignSelf: "flex-end",
                    padding: "6px 16px",
                    background: "#2a5a3a",
                    color: "#4caf50",
                    border: "1px solid #4caf50",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "bold"
                });

                // 保存提示词功能
                saveBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const currentImgPath = getPreviewPath() || imageWidget.value;
                    if (!currentImgPath) return;

                    saveBtn.innerText = "保存中...";
                    saveBtn.style.opacity = "0.7";

                    try {
                        const res = await fetch("/geniusewzq/save_prompt", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                path: currentImgPath,
                                content: promptTextarea.value
                            })
                        });
                        const result = await res.json();
                        if (result.success) {
                            markPromptFlag(currentImgPath, promptTextarea.value.trim().length > 0);
                            saveBtn.innerText = "✓ 已保存";
                            saveBtn.style.background = "#2a5a3a";
                            setTimeout(() => {
                                saveBtn.innerText = "💾 保存提示词";
                                saveBtn.style.opacity = "1";
                            }, 1500);
                        } else {
                            throw new Error(result.error || "保存失败");
                        }
                    } catch (err) {
                        console.error("保存提示词失败:", err);
                        saveBtn.innerText = "✗ 保存失败";
                        saveBtn.style.background = "#5a2a2a";
                        setTimeout(() => {
                            saveBtn.innerText = "💾 保存提示词";
                            saveBtn.style.background = "#2a5a3a";
                            saveBtn.style.opacity = "1";
                        }, 2000);
                    }
                };

                promptContainer.appendChild(promptTextarea);
                promptContainer.appendChild(saveBtn);

                overlay.appendChild(delBtn);
                overlay.appendChild(titleTag);
                overlay.appendChild(infoTag);
                overlay.appendChild(prevBtn);
                overlay.appendChild(nextBtn);
                overlay.appendChild(imgDisplay);
                overlay.appendChild(promptContainer);
                overlay.appendChild(useBtn);
                overlay.appendChild(browseHint);
                mainWrapper.appendChild(overlay);

                // --- 键盘事件 ---
                // 注意：光标在输入框里时（编辑提示词），方向键必须交还给浏览器，否则无法移动光标
                const isTypingTarget = (target) => {
                    if (!target || !target.tagName) return false;
                    const tag = target.tagName.toUpperCase();
                    return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || target.isContentEditable;
                };
                const handleKeyDown = (e) => {
                    if (overlay.style.display !== "block") return;
                    if (e.isComposing) return; // 输入法组字中不拦截
                    if (e.key === "Escape") {
                        e.preventDefault(); e.stopPropagation();
                        closeOverlay();
                        return;
                    }
                    if (isTypingTarget(e.target)) return; // 正在输入：方向键留给光标
                    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); stepPreview(-1); }
                    if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); stepPreview(1); }
                };
                window.addEventListener("keydown", handleKeyDown);
                const onRemoved = node.onRemoved;
                node.onRemoved = () => { window.removeEventListener("keydown", handleKeyDown); if (onRemoved) onRemoved.apply(node, arguments); };

                // --- 基础 UI 渲染 ---
                // 大图预览 = 只浏览。翻页不会写 image_path，避免“只是看看”却把节点图片换掉
                const syncOverlayChrome = () => {
                    const hasPreview = !!getPreviewName();
                    const selected = hasPreview && isPreviewSelected();
                    useBtn.style.display = selected ? "none" : "block";
                    browseHint.style.display = selected ? "none" : "block";
                    const images = getSortedImages();
                    const setState = (btn, enabled) => { btn.disabled = !enabled; btn.style.opacity = enabled ? "1" : "0.25"; btn.style.cursor = enabled ? "pointer" : "default"; };
                    setState(prevBtn, previewState.index > 0);
                    setState(nextBtn, previewState.index >= 0 && previewState.index < images.length - 1);
                };

                const renderPreview = async (index) => {
                    const images = getSortedImages();
                    if (!images.length) { closeOverlay(); return; }
                    const clamped = Math.max(0, Math.min(index, images.length - 1));
                    previewState.index = clamped;
                    node.currentPreviewIndex = clamped;
                    const imgName = images[clamped];
                    const fullPath = buildFullPath(imgName);
                    syncOverlayChrome();

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

                    const tImg = new Image();
                    tImg.src = `/geniusewzq/view_image?path=${encodeURIComponent(fullPath)}&t=${Date.now()}`;
                    tImg.onload = () => {
                        if (previewState.index !== clamped) return;
                        infoTag.innerText = `${tImg.naturalWidth} × ${tImg.naturalHeight}`;
                        imgDisplay.src = tImg.src;
                        imgDisplay.style.opacity = "1";
                    };
                };

                const openOverlayAt = (index) => {
                    overlay.style.display = "block";
                    renderPreview(index);
                };
                const stepPreview = (delta) => {
                    if (overlay.style.display !== "block") return;
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

                // 唯一会把“浏览的图”写成“节点使用的图”的动作
                useBtn.onclick = (e) => {
                    e.stopPropagation();
                    const target = getPreviewPath();
                    if (!target) return;
                    imageWidget.value = target;
                    if (imageWidget.callback) imageWidget.callback(target);
                    node.setDirtyCanvas(true, true);
                    updateVirtualScroll();
                    syncOverlayChrome();
                };

                imgDisplay.onclick = () => closeOverlay();
                overlay.onclick = (e) => { if (e.target === overlay) closeOverlay(); };
                prevBtn.onclick = (e) => { e.stopPropagation(); stepPreview(-1); };
                nextBtn.onclick = (e) => { e.stopPropagation(); stepPreview(1); };

                const topBar = document.createElement("div");
                topBar.style = "display:flex; padding:5px 10px; background:#252525; border-bottom:1px solid #333; flex-shrink:0; height:40px; align-items:center; gap:8px;";
                const btnStyle = (active) => `cursor:pointer; font-size:10px; padding:3px 8px; background:${active?"#444":"#222"}; color:${active?"#00ecff":"#888"}; border:1px solid #555; border-radius:3px; outline:none;`;
                const modeGroup = document.createElement("div");
                modeGroup.style = "display:flex; gap:4px;";
                const btnLarge = document.createElement("button"); btnLarge.innerText = "🖼️ 大图"; btnLarge.style = btnStyle(node.viewMode === "large");
                const btnList = document.createElement("button"); btnList.innerText = "📜 列表"; btnList.style = btnStyle(node.viewMode === "list");
                modeGroup.appendChild(btnLarge); modeGroup.appendChild(btnList);
                
                const sortSelect = document.createElement("select");
                sortSelect.style = "background:#222; color:#ccc; border:1px solid #555; font-size:10px; padding:2px; border-radius:3px;";
                [{id:"name_asc", n:"名称 A-Z"}, {id:"name_desc", n:"名称 Z-A"}, {id:"date_desc", n:"最新优先"}, {id:"date_asc", n:"最早优先"}].forEach(s => {
                    const opt = document.createElement("option"); opt.value = s.id; opt.innerText = s.n; if(node.sortMode === s.id) opt.selected = true; sortSelect.appendChild(opt);
                });
                const refreshBtn = document.createElement("button"); refreshBtn.innerText = "🔄 刷新"; refreshBtn.style = "cursor:pointer; font-size:10px; padding:3px 10px; background:#333; color:#00ecff; border:1px solid #555; border-radius:3px; margin-left:auto;";
                topBar.appendChild(modeGroup); topBar.appendChild(sortSelect); topBar.appendChild(refreshBtn);

                // --- 资源管理器式导航栏：后退 / 前进 / 上一级 + 面包屑路径 ---
                const navBar = document.createElement("div");
                Object.assign(navBar.style, {
                    display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px",
                    background: "#202020", borderBottom: "1px solid #333", flexShrink: "0", height: "28px"
                });
                const folderNavBtnStyle = "width:22px; height:20px; display:flex; align-items:center; justify-content:center; background:#2a2a2a; color:#ccc; border:1px solid #444; border-radius:3px; font-size:12px; cursor:pointer; padding:0; flex-shrink:0;";
                const backBtn = document.createElement("button"); backBtn.innerText = "←"; backBtn.title = "后退"; backBtn.style = folderNavBtnStyle;
                const forwardBtn = document.createElement("button"); forwardBtn.innerText = "→"; forwardBtn.title = "前进"; forwardBtn.style = folderNavBtnStyle;
                const upBtn = document.createElement("button"); upBtn.innerText = "↑"; upBtn.title = "上一级文件夹"; upBtn.style = folderNavBtnStyle;
                const crumbBar = document.createElement("div");
                Object.assign(crumbBar.style, {
                    display: "flex", alignItems: "center", gap: "2px", flex: "1", minWidth: "0",
                    overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", paddingBottom: "1px"
                });
                navBar.appendChild(backBtn); navBar.appendChild(forwardBtn); navBar.appendChild(upBtn); navBar.appendChild(crumbBar);

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
                mainWrapper.appendChild(topBar); mainWrapper.appendChild(navBar); mainWrapper.appendChild(bodyContainer);

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
                const syncNavButtons = () => {
                    const setEnabled = (btn, enabled) => {
                        btn.disabled = !enabled;
                        btn.style.opacity = enabled ? "1" : "0.35";
                        btn.style.cursor = enabled ? "pointer" : "default";
                    };
                    setEnabled(backBtn, node.navIndex > 0);
                    setEnabled(forwardBtn, node.navIndex < node.navHistory.length - 1);
                    setEnabled(upBtn, getCurrentFolder() !== ".");
                };
                const renderBreadcrumb = () => {
                    const current = getCurrentFolder();
                    const base = (pathWidget.value || "").trim();
                    crumbBar.innerHTML = "";
                    const makeCrumb = (label, folder, isLast, fullPath) => {
                        const el = document.createElement("span");
                        el.innerText = label;
                        el.title = fullPath;
                        Object.assign(el.style, {
                            padding: "2px 6px", borderRadius: "3px", fontSize: "11px",
                            color: isLast ? "#eeeeee" : "#8ab4c8",
                            background: isLast ? "#2c2c2c" : "transparent",
                            cursor: isLast ? "default" : "pointer",
                            maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", flexShrink: "0"
                        });
                        if (!isLast) {
                            el.onmouseenter = () => { el.style.background = "#333333"; el.style.color = "#00ecff"; };
                            el.onmouseleave = () => { el.style.background = "transparent"; el.style.color = "#8ab4c8"; };
                            el.onclick = (e) => { e.stopPropagation(); applyFolder(folder); };
                        }
                        crumbBar.appendChild(el);
                    };
                    makeCrumb(getRootLabel(), ".", current === ".", base || "根目录");
                    if (current !== ".") {
                        const parts = current.split("/");
                        parts.forEach((part, i) => {
                            const sep = document.createElement("span");
                            sep.innerText = "›";
                            sep.style = "color:#555; font-size:10px; flex-shrink:0;";
                            crumbBar.appendChild(sep);
                            const folder = parts.slice(0, i + 1).join("/");
                            makeCrumb(part, folder, i === parts.length - 1, `${base}/${folder}`);
                        });
                    }
                    requestAnimationFrame(() => { crumbBar.scrollLeft = crumbBar.scrollWidth; });
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

                // 切换文件夹。historyMode: push=记入历史（点击导航），none=只跳转（前进/后退），reset=重建历史
                const applyFolder = (folder, historyMode = "push") => {
                    const target = normalizeFolder(folder);
                    if (target !== "." && !folderExists(target)) return false;
                    memoryWidget.value = target;
                    expandAncestors(target);
                    if (historyMode === "push") {
                        node.navHistory = node.navHistory.slice(0, node.navIndex + 1);
                        if (node.navHistory[node.navHistory.length - 1] !== target) node.navHistory.push(target);
                        node.navIndex = node.navHistory.length - 1;
                    } else if (historyMode === "reset" || !node.navHistory.length) {
                        node.navHistory = [target];
                        node.navIndex = 0;
                    }
                    renderSidebar();
                    renderBreadcrumb();
                    clearAndRefresh();
                    viewport.scrollTop = 0;
                    syncNavButtons();
                    return true;
                };

                backBtn.onclick = () => {
                    if (node.navIndex <= 0) return;
                    node.navIndex -= 1;
                    applyFolder(node.navHistory[node.navIndex], "none");
                };
                forwardBtn.onclick = () => {
                    if (node.navIndex >= node.navHistory.length - 1) return;
                    node.navIndex += 1;
                    applyFolder(node.navHistory[node.navIndex], "none");
                };
                upBtn.onclick = () => {
                    const current = getCurrentFolder();
                    if (current === ".") return;
                    applyFolder(getParentFolder(current));
                };
                crumbBar.onwheel = (e) => {
                    if (crumbBar.scrollWidth <= crumbBar.clientWidth) return;
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        crumbBar.scrollLeft += e.deltaY;
                        e.preventDefault();
                    }
                };

                const getSortedImages = () => {
                    const folder = memoryWidget.value || ".";
                    let list = node.galleryData?.tree?.[folder] || [];
                    const sorted = [...list];
                    if (node.sortMode === "name_asc") sorted.sort((a,b) => a.localeCompare(b));
                    if (node.sortMode === "name_desc") sorted.sort((a,b) => b.localeCompare(a));
                    if (node.sortMode === "date_desc") sorted.reverse();
                    return sorted;
                };

                // 该图是否有同名的非空 txt（后端 get_gallery 里顺手统计好，前端不用再多请求）
                const hasPrompt = (fullPath) => {
                    const folder = memoryWidget.value || ".";
                    const name = fullPath.split("/").pop();
                    const list = node.galleryData?.prompts?.[folder];
                    return Array.isArray(list) && list.includes(name);
                };
                const markPromptFlag = (fullPath, has) => {
                    const folder = memoryWidget.value || ".";
                    const name = fullPath.split("/").pop();
                    if (!node.galleryData.prompts) node.galleryData.prompts = {};
                    const list = node.galleryData.prompts[folder] || (node.galleryData.prompts[folder] = []);
                    const i = list.indexOf(name);
                    if (has && i === -1) list.push(name);
                    if (!has && i !== -1) list.splice(i, 1);
                    updateVirtualScroll();
                };

                const updateVirtualScroll = () => {
                    const images = getSortedImages();
                    const isList = node.viewMode === "list";
                    const cols = isList ? 1 : 3; 
                    const gap = isList ? 2 : 10; const padding = 10;
                    const viewWidth = viewport.clientWidth || 450;
                    const itemWidth = isList ? (viewWidth - 25) : (viewWidth - (padding * 2) - (gap * (cols - 1))) / cols;
                    const rowHeight = (isList ? 20 : itemWidth) + gap;
                    ghostContent.style.height = (Math.ceil(images.length / cols) * rowHeight + padding * 2) + "px";
                    const scrollTop = viewport.scrollTop;
                    const startRow = Math.max(0, Math.floor((scrollTop - padding) / rowHeight) - 1);
                    const endRow = Math.min(Math.ceil(images.length / cols), startRow + (Math.ceil((viewport.clientHeight || 600) / rowHeight) + 2));
                    const startIndex = startRow * cols;
                    const endIndex = Math.min(images.length, endRow * cols);
                    const currentVisibleKeys = new Set();
                    const currentPath = pathWidget.value.trim();
                    const folder = memoryWidget.value || ".";

                    for (let i = startIndex; i < endIndex; i++) {
                        const imgName = images[i];
                        const fullPath = `${currentPath}/${folder}/${imgName}`.replace(/\/+/g, '/');
                        currentVisibleKeys.add(fullPath);
                        const isSelected = imageWidget.value === fullPath;
                        const x = padding + (i % cols) * (itemWidth + gap);
                        const y = padding + Math.floor(i / cols) * rowHeight;
                        if (!node.renderedItems.has(fullPath)) {
                            const box = document.createElement("div");
                            box.style = `position:absolute; pointer-events:auto; overflow:hidden; box-sizing:border-box;`;
                            if (isList) {
                                box.style.lineHeight = "20px"; box.style.padding = "0 10px"; box.style.fontSize = "12px";
                                box.style.display = "flex"; box.style.alignItems = "center"; box.style.gap = "6px";
                                const nameEl = document.createElement("span");
                                nameEl.style = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                                const markEl = document.createElement("span");
                                markEl.innerText = "💬"; markEl.title = "有提示词(txt)";
                                markEl.style = "flex-shrink:0; font-size:10px; color:#81C784; opacity:0;";
                                box.appendChild(nameEl); box.appendChild(markEl);
                                box._nameEl = nameEl; box._markEl = markEl;
                            } else {
                                box.style.background = "#222"; box.style.borderRadius = "4px";
                                const img = document.createElement("img"); img.style = "width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity 0.3s;";
                                img.src = `/geniusewzq/view_image?path=${encodeURIComponent(fullPath)}&t=${node.refreshTimestamp}`; img.onload = () => img.style.opacity = "1";
                                box.appendChild(img);
                                const markEl = document.createElement("span");
                                markEl.innerText = "💬"; markEl.title = "有提示词(txt)";
                                markEl.style = "position:absolute; top:3px; left:3px; font-size:10px; line-height:14px; background:rgba(0,0,0,0.65); border-radius:3px; padding:0 3px; color:#81C784; opacity:0;";
                                box.appendChild(markEl);
                                box._markEl = markEl;
                            }
                            box.onclick = () => {
                                const currentIdx = images.indexOf(imgName);
                                if (imageWidget.value === fullPath) {
                                    openOverlayAt(currentIdx);
                                } else {
                                    imageWidget.value = fullPath; 
                                    if(imageWidget.callback) imageWidget.callback(fullPath);
                                    node.setDirtyCanvas(true, true);
                                    updateVirtualScroll();
                                }
                            };
                            itemContainer.appendChild(box); node.renderedItems.set(fullPath, box);
                        }
                        const box = node.renderedItems.get(fullPath);
                        box.style.width = `${itemWidth}px`; box.style.height = `${isList ? 20 : itemWidth}px`;
                        box.style.transform = `translate(${x}px, ${y}px)`;
                        const showMark = hasPrompt(fullPath);
                        box.title = imgName + (showMark ? "（有提示词）" : "");
                        if (box._nameEl) box._nameEl.innerText = imgName;
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
                    const currentPath = pathWidget.value?.trim();
                    if(!currentPath) return;
                    showLoading(`<div style="margin-bottom:10px; font-size:24px;">⌛</div><div>同步中...</div>`);
                    try {
                        // 更新时间戳，强制刷新图片缓存
                        node.refreshTimestamp = Date.now();
                        const res = await fetch(`/geniusewzq/get_gallery?path=${encodeURIComponent(currentPath)}&t=${Date.now()}`);
                        node.galleryData = await res.json();
                        // 当前文件夹已不存在（被外部删除/重命名）时回退到根目录，避免空白页
                        let current = getCurrentFolder();
                        if (current !== "." && !folderExists(current)) {
                            current = ".";
                            memoryWidget.value = ".";
                        }
                        expandAncestors(current);
                        if (!node.navHistory.length || node.navHistory[node.navIndex] !== current) {
                            node.navHistory = [current];
                            node.navIndex = 0;
                        }
                        renderSidebar();
                        renderBreadcrumb();
                        clearAndRefresh();
                        syncNavButtons();
                        // 首次打开时 DOM 可能尚未完成布局（viewport.clientHeight=0/偏小），
                        // 等下一帧及稍后布局稳定后各重算一次，避免列表只渲染前几行
                        requestAnimationFrame(() => updateVirtualScroll());
                        setTimeout(() => updateVirtualScroll(), 120);
                    } catch (e) { console.error(e); } finally { hideLoading(); }
                };

                btnLarge.onclick = () => { node.viewMode = "large"; btnLarge.style = btnStyle(true); btnList.style = btnStyle(false); clearAndRefresh(); };
                btnList.onclick = () => { node.viewMode = "list"; btnLarge.style = btnStyle(false); btnList.style = btnStyle(true); clearAndRefresh(); };
                sortSelect.onchange = (e) => { node.sortMode = e.target.value; clearAndRefresh(); };
                refreshBtn.onclick = () => refreshGallery();
                viewport.onscroll = updateVirtualScroll;

                this.addDOMWidget("gallery_ui", "HTML", mainWrapper);
                // 换库根目录时清空导航历史，避免在旧库的文件夹之间来回跳
                pathWidget.callback = () => {
                    node.navHistory = [];
                    node.navIndex = 0;
                    refreshGallery();
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
                        const rowHeight = (isList ? 20 : itemWidth) + gap;
                        const rowIndex = Math.floor(index / cols);
                        viewport.scrollTop = rowIndex * rowHeight;
                    }
                };

                setupDragAndDrop();
                setupPaste();

                setTimeout(refreshGallery, 500); this.setSize([650, 650]);
            };
        }
    }
});
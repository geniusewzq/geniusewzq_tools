import { app } from "../../../scripts/app.js";

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

                node.viewMode = node.viewMode || "large";
                node.sortMode = node.sortMode || "name_asc";
                node.sidebarWidth = node.sidebarWidth || 150;
                node.expandedFolders = node.expandedFolders || new Set(["."]);
                node.renderedItems = new Map();
                node.galleryData = { tree: {} };
                node.currentPreviewIndex = -1;

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
                
                const delBtn = document.createElement("button");
                delBtn.innerHTML = "🗑️ 删除图片";
                Object.assign(delBtn.style, {
                    position: "absolute", top: "20px", right: "20px", padding: "8px 16px",
                    background: "#b30000", color: "white", border: "none", borderRadius: "4px",
                    cursor: "pointer", fontSize: "12px", zIndex: 10003, fontWeight: "bold"
                });
                delBtn.onclick = (e) => { 
                    e.stopPropagation(); 
                    createConfirmModal("删除确认", `文件：${imageWidget.value.split('/').pop()}`, () => performDelete(imageWidget.value));
                };

                const titleTag = document.createElement("div");
                Object.assign(titleTag.style, { position:"absolute", top:"20px", left:"50%", transform:"translateX(-50%)", color:"#fff", fontSize:"14px", fontWeight:"bold", width:"50%", textAlign:"center", zIndex:10002, pointerEvents:"none" });
                
                const infoTag = document.createElement("div");
                Object.assign(infoTag.style, { position:"absolute", bottom:"20px", left:"50%", transform:"translateX(-50%)", background:"rgba(0,236,255,0.2)", color:"#00ecff", padding:"4px 15px", borderRadius:"15px", fontSize:"12px", border:"1px solid #00ecff44", zIndex:10002, pointerEvents:"none" });
                
                const navBtnStyle = "position:absolute; top:50%; transform:translateY(-50%); cursor:pointer; background:rgba(255,255,255,0.05); color:white; border:none; border-radius:50%; width:60px; height:60px; font-size:32px; display:flex; align-items:center; justify-content:center; z-index:10002; outline:none;";
                const prevBtn = document.createElement("button"); prevBtn.innerHTML = "‹"; prevBtn.style = navBtnStyle + "left:20px;";
                const nextBtn = document.createElement("button"); nextBtn.innerHTML = "›"; nextBtn.style = navBtnStyle + "right:20px;";
                
                const imgDisplay = document.createElement("img");
                Object.assign(imgDisplay.style, { position:"absolute", top:"50%", left:"50%", transform:"translate(-50%, -50%)", maxWidth:"75%", maxHeight:"75%", objectFit:"contain", cursor:"zoom-out", border:"1px solid #333", boxShadow:"0 0 50px rgba(0,0,0,1)", zIndex:10001 });
                
                overlay.appendChild(delBtn);
                overlay.appendChild(titleTag); 
                overlay.appendChild(infoTag); 
                overlay.appendChild(prevBtn); 
                overlay.appendChild(nextBtn); 
                overlay.appendChild(imgDisplay);
                mainWrapper.appendChild(overlay);

                // --- 键盘事件 ---
                const handleKeyDown = (e) => {
                    if (overlay.style.display === "block") {
                        if (["ArrowLeft", "ArrowRight", "Escape"].includes(e.key)) {
                            e.preventDefault(); e.stopPropagation();
                        }
                        if (e.key === "ArrowLeft") prevBtn.click();
                        if (e.key === "ArrowRight") nextBtn.click();
                        if (e.key === "Escape") imgDisplay.click();
                    }
                };
                window.addEventListener("keydown", handleKeyDown);
                const onRemoved = node.onRemoved;
                node.onRemoved = () => { window.removeEventListener("keydown", handleKeyDown); if (onRemoved) onRemoved.apply(node, arguments); };

                // --- 基础 UI 渲染 ---
                const updateOverlayImage = (index) => {
                    const images = getSortedImages();
                    if (index < 0 || index >= images.length) return;
                    node.currentPreviewIndex = index;
                    const imgName = images[index];
                    const folder = memoryWidget.value || ".";
                    const fullPath = `${pathWidget.value.trim()}/${folder}/${imgName}`.replace(/\/+/g, '/');
                    imageWidget.value = fullPath;
                    if (imageWidget.callback) imageWidget.callback(fullPath);
                    node.setDirtyCanvas(true, true);
                    updateVirtualScroll();
                    imgDisplay.style.opacity = "0.3";
                    const tImg = new Image();
                    tImg.src = `/geniusewzq/view_image?path=${encodeURIComponent(fullPath)}`;
                    tImg.onload = () => {
                        titleTag.innerText = imgName;
                        infoTag.innerText = `${tImg.naturalWidth} × ${tImg.naturalHeight}`;
                        imgDisplay.src = tImg.src;
                        imgDisplay.style.opacity = "1";
                    };
                };

                imgDisplay.onclick = () => { overlay.style.display="none"; imgDisplay.src=""; };
                overlay.onclick = (e) => { if(e.target === overlay) { overlay.style.display="none"; imgDisplay.src=""; } };
                prevBtn.onclick = (e) => { e.stopPropagation(); updateOverlayImage(node.currentPreviewIndex - 1); };
                nextBtn.onclick = (e) => { e.stopPropagation(); updateOverlayImage(node.currentPreviewIndex + 1); };

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

                const renderSidebar = () => {
                    sidebar.innerHTML = "";
                    if (!node.galleryData || node.galleryData.error) return;
                    const folders = Object.keys(node.galleryData.tree).sort();
                    const buildTreeElement = (path, depth) => {
                        const isSelected = (memoryWidget.value || ".") === path;
                        const isExpanded = node.expandedFolders.has(path);
                        const hasChildren = folders.some(f => {
                            const parts = f.split('/');
                            const parentPath = parts.slice(0, -1).join('/') || ".";
                            return parentPath === path && f !== path;
                        });
                        const item = document.createElement("div");
                        item.style = `padding:6px 8px; padding-left:${depth * 12 + 8}px; cursor:pointer; font-size:11px; display:flex; align-items:center; gap:5px; color:${isSelected?"#00ecff":"#ccc"}; background:${isSelected?"#2a2a2a":"transparent"}; border-radius:2px; margin:1px 4px; white-space:nowrap; overflow:hidden;`;
                        const arrow = document.createElement("span"); arrow.style = `font-size:8px; width:10px; display:inline-block; color:${isSelected ? "#00ecff" : "#555"};`;
                        if (hasChildren) arrow.innerText = isExpanded ? "▼" : "▶";
                        const icon = document.createElement("span"); icon.innerText = isExpanded && hasChildren ? "📂" : "📁";
                        const label = document.createElement("span"); label.innerText = path === "." ? "根目录" : path.split('/').pop();
                        item.appendChild(arrow); item.appendChild(icon); item.appendChild(label);
                        item.onclick = (e) => {
                            e.stopPropagation(); memoryWidget.value = path;
                            if (hasChildren) {
                                if (node.expandedFolders.has(path)) { if (path !== ".") node.expandedFolders.delete(path); }
                                else node.expandedFolders.add(path);
                            }
                            renderSidebar(); clearAndRefresh(); viewport.scrollTop = 0;
                        };
                        sidebar.appendChild(item);
                        if (isExpanded && hasChildren) {
                            folders.forEach(f => {
                                const parts = f.split('/');
                                const parentPath = parts.slice(0, -1).join('/') || ".";
                                if (parentPath === path && f !== path) buildTreeElement(f, depth + 1);
                            });
                        }
                    };
                    buildTreeElement(".", 0);
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

                const updateVirtualScroll = () => {
                    const images = getSortedImages();
                    const isList = node.viewMode === "list";
                    const cols = isList ? 1 : 3; 
                    const gap = 10; const padding = 10;
                    const viewWidth = viewport.clientWidth || 450;
                    const itemWidth = isList ? (viewWidth - 25) : (viewWidth - (padding * 2) - (gap * (cols - 1))) / cols;
                    const rowHeight = (isList ? 32 : itemWidth) + gap;
                    ghostContent.style.height = (Math.ceil(images.length / cols) * rowHeight + padding * 2) + "px";
                    const scrollTop = viewport.scrollTop;
                    const startRow = Math.max(0, Math.floor((scrollTop - padding) / rowHeight) - 1);
                    const endRow = Math.min(Math.ceil(images.length / cols), startRow + (Math.ceil(viewport.clientHeight / rowHeight) + 2));
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
                                box.style.lineHeight = "32px"; box.style.padding = "0 10px"; box.style.fontSize = "12px"; box.style.borderBottom = "1px solid #222"; box.innerText = imgName;
                            } else {
                                box.style.background = "#222"; box.style.borderRadius = "4px";
                                const img = document.createElement("img"); img.style = "width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity 0.3s;";
                                img.src = `/geniusewzq/view_image?path=${encodeURIComponent(fullPath)}`; img.onload = () => img.style.opacity = "1";
                                box.appendChild(img);
                            }
                            box.onclick = () => {
                                const currentIdx = images.indexOf(imgName);
                                if (imageWidget.value === fullPath) {
                                    node.currentPreviewIndex = currentIdx; updateOverlayImage(currentIdx); overlay.style.display = "block";
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
                        box.style.width = `${itemWidth}px`; box.style.height = `${isList ? 32 : itemWidth}px`;
                        box.style.transform = `translate(${x}px, ${y}px)`;
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
                        const res = await fetch(`/geniusewzq/get_gallery?path=${encodeURIComponent(currentPath)}&t=${Date.now()}`);
                        node.galleryData = await res.json();
                        renderSidebar();
                        clearAndRefresh();
                    } catch (e) { console.error(e); } finally { hideLoading(); }
                };

                btnLarge.onclick = () => { node.viewMode = "large"; btnLarge.style = btnStyle(true); btnList.style = btnStyle(false); clearAndRefresh(); };
                btnList.onclick = () => { node.viewMode = "list"; btnLarge.style = btnStyle(false); btnList.style = btnStyle(true); clearAndRefresh(); };
                sortSelect.onchange = (e) => { node.sortMode = e.target.value; clearAndRefresh(); };
                refreshBtn.onclick = () => refreshGallery();
                viewport.onscroll = updateVirtualScroll;

                this.addDOMWidget("gallery_ui", "HTML", mainWrapper);
                pathWidget.callback = refreshGallery;
                node.onResize = () => { if (node.resizeTimer) clearTimeout(node.resizeTimer); node.resizeTimer = setTimeout(() => updateVirtualScroll(), 60); };
                
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

                setTimeout(refreshGallery, 500); this.setSize([650, 650]);
            };
        }
    }
});
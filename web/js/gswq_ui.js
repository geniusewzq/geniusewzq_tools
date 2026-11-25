/* ComfyUI Nodes 2.0 会在节点卡片底部渲染一个 python 模块名药丸
   （geniusewzq_tools / promptforge_shim）。对使用者没有意义，这里只隐藏本插件自己的节点，
   不影响其它插件的调试信息。 */
const GSWQ_MODULES = new Set(["geniusewzq_tools", "promptforge_shim"]);

const hideOwnModuleBadge = () => {
    const footers = document.querySelectorAll('.lg-node div[class~="mt-auto"]');
    footers.forEach((foot) => {
        if (foot.dataset.gswqHidden === "1") return;
        const txt = (foot.textContent || "").trim();
        if (!txt) return;
        const first = txt.split(/\s+/)[0];
        if (!GSWQ_MODULES.has(first)) return;
        foot.style.display = "none";
        foot.dataset.gswqHidden = "1";
    });
};

const gswqBoot = () => {
    hideOwnModuleBadge();
    setInterval(hideOwnModuleBadge, 1000);
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", gswqBoot);
} else {
    gswqBoot();
}

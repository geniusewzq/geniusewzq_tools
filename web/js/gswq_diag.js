/* 前端报错诊断：未捕获异常 / Promise 拒绝的完整栈写到 geniusewzq_tools/diag.jsonl（本机文件） */
const DIAG_URL = "/geniusewzq/diag";
const seen = new Set();
let sent = 0;

function describe(err) {
    if (!err) return { message: String(err), stack: "" };
    return { message: String(err.message || err), stack: String(err.stack || "") };
}

function report(kind, extra) {
    try {
        const key = kind + "|" + String(extra.message || "").slice(0, 200) + "|" + String(extra.stack || "").slice(0, 200);
        if (seen.has(key)) return;
        seen.add(key);
        if (sent >= 20) return;
        sent += 1;
        fetch(DIAG_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.assign({ kind: kind, href: String(location.href) }, extra)),
        }).catch(() => {});
    } catch (e) { /* 诊断本身不能抛错 */ }
}

window.addEventListener("error", (e) => {
    const info = describe(e.error);
    report("error", {
        message: info.message || String(e.message || ""),
        stack: info.stack,
        file: String(e.filename || ""), line: e.lineno || 0, col: e.colno || 0,
    });
});

window.addEventListener("unhandledrejection", (e) => {
    const info = describe(e.reason);
    report("rejection", { message: info.message, stack: info.stack });
});

console.log("[geniusewzq] 报错诊断已开启：前端异常会写进 geniusewzq_tools/diag.jsonl");

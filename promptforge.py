"""PromptForge：翻译 + 按模型规范重写提示词 + 标签库 + 收藏。

设计约束（见 AGENTS.md）：不引新依赖（只用标准库）、不发无用网络请求、
数据放本目录 data/promptforge；API 地址/密钥/模型优先取节点上的输入框。
"""

import json
import os
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data", "promptforge")
SKILL_DIR = os.path.join(DATA, "skills")
TAGS_DB = os.path.join(DATA, "tags.db")
CONFIG_PATH = os.path.join(DATA, "config.json")
FAV_PATH = os.path.join(DATA, "favorites.json")

CATEGORY = "geniusewzq_tools"

# 站点管理词：不进提示词（用户拍板硬排除）
META_BLACK = {
    "bad_id", "bad_pixiv_id", "bad_twitter_id", "bad_link", "md5_mismatch",
    "commentary_request", "translation_request", "character_request",
    "artist_request", "copyright_request", "chinese_commentary",
    "korean_commentary", "partial_commentary", "commentary", "non-web_source",
    "translated", "animated", "scan", "commission", "skeb_commission",
    "for_side_image", "artist_name", "character_name", "highres_dummy",
}

# 随机拼串时额外排除：这些词写进提示词要么无意义，要么会拉低质量
RAND_BLACK = META_BLACK | {
    "character_profile", "absurdres", "highres", "lowres", "official_art",
    "photo_inset", "4koma", "jpeg_artifacts", "game_cg", "traditional_media",
    # 分级漏标的擦边词（等建库规则补上后可去掉）
    "saliva_trail", "grabbing", "spread_legs", "ahegao", "cum", "sex",
    "masturbation", "pubic_hair", "body_hair", "panties", "no_bra",
    "no_panties", "see-through", "wet_clothes", "thigh_gap",
    "expressions", "pantyshot", "ass", "anal", "hentai", "penis", "vagina",
    "pussy", "cock", "dick", "tits", "boobs", "butt",
}

# 分级漏标兜底：动作/部位类擦边词一律不进"普通串"的主池
SUSPECT_RE = re.compile(
    r"(^|_)(ass|anal|pussy|penis|cum|sex|nude|nipples?|boobs?|crotch|panties?"
    r"|lingerie|ahegao|masturbat\w*|orgasm|ejaculat\w*|grinding)(_|$)"
    r"|grabbing_another|pantyshot")

DEFAULT_CONFIG = {
    "local": {"base": "http://127.0.0.1:8080/v1", "model": "", "key": "", "timeout": 240},
    "deepseek": {"base": "https://api.deepseek.com/v1", "model": "deepseek-chat", "key": "", "timeout": 120},
}

# 「强度」已移除：它只改措辞强度，用户看不出差别；允许加多少内容改由「侧重」与「深度扩写」控制。


LANG_MODES = ["自动", "中文", "英文"]
SERVICE_MODES = ["本地 llama.cpp", "DeepSeek", "仅规则"]


# ---------------- 配置 ----------------

def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8-sig") as f:
                user = json.load(f)
            for k, v in (user or {}).items():
                if isinstance(v, dict):
                    cfg.setdefault(k, {}).update(v)
        except Exception as e:
            print(f"[PromptForge] config.json 读取失败：{e}")
    return cfg


def _http_err(service, base, model, e):
    try:
        body = e.read().decode("utf-8", "replace")
    except Exception:
        body = ""
    m = re.search(r'"message"\s*:\s*"([^"]{1,200})"', body)
    detail = m.group(1) if m else (body.strip()[:200] or str(e.reason))
    return RuntimeError(f"{service} 返回 HTTP {e.code}（地址 {base}，模型 {model}）：{detail}")


def _api_pick(api, service):
    """节点上填的 api 优先，没填才回落到 config.json。"""
    api = api or {}
    base = str(api.get("base") or "").strip().strip('"').strip("'").rstrip("/")
    key = re.sub(r"\s+", "", str(api.get("key") or "").strip().strip('"').strip("'"))
    model = str(api.get("model") or "").strip()
    # 粘贴位置填错的常见情形：地址填进了密钥框、密钥填进了模型名框
    if key.startswith(("http://", "https://")) and not base:
        base, key = key.rstrip("/"), ""
    if base.startswith("sk-") and not key:
        base, key = "", base
    if model.startswith("sk-") and not key.startswith("sk-"):
        key, model = model, ""
    cfg = load_config()
    prof = cfg.get("deepseek" if service == "DeepSeek" else "local", {})
    if not base:
        base = (prof.get("base") or "").rstrip("/")
    if not key:
        key = prof.get("key") or (os.environ.get("DEEPSEEK_API_KEY", "") if service == "DeepSeek" else "")
    if not model:
        model = prof.get("model") or ""
    if any(ord(c) > 127 for c in key):
        raise RuntimeError("API 密钥里有中文/全角字符，请复制纯英文密钥（sk-…）")
    for suf in ("/chat/completions", "/completions"):
        if base.endswith(suf):
            base = base[: -len(suf)]
    if base in ("https://api.deepseek.com", "http://api.deepseek.com"):
        base += "/v1"
    return base, key, model, int(prof.get("timeout", 240))


# ---------------- skill ----------------

def _parse_front(text):
    meta, body = {}, text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            head = text[3:end]
            body = text[end + 4:]
            for line in head.splitlines():
                if ":" not in line:
                    continue
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, body.strip()


PREFERRED_SKILLS = ["qwen-image-2.1", "minimax-h3", "illustrious-pony"]


def list_skills():
    out = []
    if not os.path.isdir(SKILL_DIR):
        return out
    for name in os.listdir(SKILL_DIR):
        if name.endswith(".md"):
            out.append(name[:-3])
    out.sort(key=lambda n: (PREFERRED_SKILLS.index(n) if n in PREFERRED_SKILLS else 99, n))
    return out or ["qwen-image-2.1"]


def _read_meta(name):
    path = os.path.join(SKILL_DIR, f"{name}.md")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            meta, _body = _parse_front(f.read())
        return meta
    except OSError:
        return {}


def resolve_skill(value):
    """下拉只剩『目标模型』：把模型名 / 标题 / 文件名统一换成 skills 里的文件名。"""
    names = list_skills()
    v = str(value or "").strip()
    if not v:
        return names[0]
    if v in names:
        return v
    key = re.sub(r"\s+", "", v).lower()
    for name in names:
        meta = _read_meta(name)
        for cand in (meta.get("target"), meta.get("title"), name):
            if cand and re.sub(r"\s+", "", str(cand)).lower() == key:
                return name
    return names[0]


_SKILL_CACHE = {}


def load_skill(name):
    name = resolve_skill(name)
    if name in _SKILL_CACHE:
        return _SKILL_CACHE[name]
    path = os.path.join(SKILL_DIR, f"{name}.md")
    if not os.path.isfile(path):
        for cand in list_skills():
            p = os.path.join(SKILL_DIR, f"{cand}.md")
            if os.path.isfile(p):
                path = p
                break
    if not os.path.isfile(path):
        return {"name": name, "title": name, "body": "", "negative": "", "prefix": "",
                "suffix": "", "tag_format": "space", "negative_mode": ""}
    with open(path, "r", encoding="utf-8") as f:
        meta, body = _parse_front(f.read())
    skill = {
        "name": name,
        "title": meta.get("title", name),
        "target": meta.get("target", name),
        "negative": meta.get("negative", ""),
        "prefix": meta.get("prefix", ""),
        "suffix": meta.get("suffix", ""),
        "tag_format": meta.get("tag_format", "space"),
        "negative_mode": (meta.get("negative_mode") or "").strip(),
        "body": body,
    }
    _SKILL_CACHE[name] = skill
    return skill


# ---------------- LLM ----------------

def _post_json(url, payload, key=None, timeout=120):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _models(base, key=None, timeout=10):
    """问一下服务加载的是哪个模型，避免 model 名对不上。"""
    try:
        req = urllib.request.Request(f"{base}/models")
        if key:
            req.add_header("Authorization", f"Bearer {key}")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items = data.get("data") or []
        if items and items[0].get("id"):
            return items[0]["id"]
    except Exception:
        pass
    return ""


_MODEL_CACHE = {}


def list_models(base="", key="", service="本地 llama.cpp"):
    """给前端下拉用：问服务要模型列表。"""
    base = (base or "").strip().rstrip("/")
    key = re.sub(r"\s+", "", (key or "").strip())
    if not base:
        base = (load_config().get("deepseek" if service == "DeepSeek" else "local", {})
                .get("base") or "").rstrip("/")
    if not base:
        return []
    try:
        req = urllib.request.Request(f"{base}/models")
        if key:
            req.add_header("Authorization", f"Bearer {key}")
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []
    out = []
    for it in data.get("data") or data.get("models") or []:
        mid = it.get("id") or it.get("model") or it.get("name") or ""
        if mid and mid not in out:
            out.append(mid)
    return out


def save_key(service, key):
    """密钥只写本机 config.json，不进工作流。"""
    key = re.sub(r"\s+", "", (key or "").strip().strip('"').strip("'"))
    if any(ord(c) > 127 for c in key):
        raise RuntimeError("密钥里有非英文字符，请重新复制粘贴")
    cfg = load_config()
    prof = cfg.setdefault("deepseek" if service == "DeepSeek" else "local", {})
    prof["key"] = key
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)
    return {"ok": True, "service": service, "saved": bool(key)}


def ping_llm(service="本地 llama.cpp", api=None):
    """发一个 1 token 的请求，确认地址/密钥/模型名三件事都对。"""
    text, usage = llm_chat([{"role": "user", "content": "ping"}], service, 0.0, 1, api)
    base, _, model, _ = _api_pick(api, service)
    return {"ok": True, "service": service, "base": base, "model": model, "ms": usage.get("ms", 0)}


def llm_chat(messages, service="本地 llama.cpp", temperature=0.7, max_tokens=1400, api=None):
    base, key, model, timeout = _api_pick(api, service)
    if not base:
        raise RuntimeError(f"{service} 没填 API 地址")
    if service == "DeepSeek" and not key:
        raise RuntimeError("DeepSeek 没填 API 密钥：在节点的『API 密钥』里粘贴 sk-… 即可")
    if not model:
        ck = f"{base}|{key}"
        model = _MODEL_CACHE.get(ck) or _models(base, key) or "local-model"
        _MODEL_CACHE[ck] = model
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    t0 = time.time()
    try:
        data = _post_json(f"{base}/chat/completions", payload, key, timeout)
    except urllib.error.HTTPError as e:
        raise _http_err(service, base, model, e)
    except urllib.error.URLError as e:
        raise RuntimeError(f"连不上 {service}（{base}）：{e.reason}")
    except TimeoutError:
        raise RuntimeError(f"{service} 响应超时（{base}，模型 {model}）")
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    usage = data.get("usage") or {}
    return text.strip(), {
        "service": service,
        "ms": int((time.time() - t0) * 1000),
        "tokens": usage.get("completion_tokens") or usage.get("total_tokens") or 0,
    }


def _strip_fence(text):
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


# ---------------- 翻译 ----------------
# 顺序：免费的 MT 接口（0.3~1.5 秒，不占显存）→ 节点上配的 LLM 兜底。

MT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")


def _has_cjk(s):
    return bool(re.search(r"[\u4e00-\u9fff]", s or ""))


def _mt_get(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": MT_UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


# ---- 多引擎轮换（vendored translators 库，GPL-3.0，见 promptforge_vendor/NOTICE.txt）----
VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "promptforge_vendor")
ENGINE_ORDER = ("bing", "itranslate", "alibaba", "sogou", "google")
ENGINE_ZH = {"alibaba": "阿里", "sogou": "搜狗", "bing": "必应",
             "itranslate": "iTranslate", "google": "谷歌", "mymemory": "MyMemory"}
_TSS = None
_TSS_ERR = ""
_TCACHE = {}


def _tss():
    """惰性加载 translators 库；失败只记一次原因，不要每次点击都重试。"""
    global _TSS, _TSS_ERR
    if _TSS is not None or _TSS_ERR:
        return _TSS
    try:
        if VENDOR_DIR not in sys.path:
            sys.path.insert(0, VENDOR_DIR)
        os.environ["translators_default_region"] = "CN"
        from translators.server import translate_text as _tt, tss
        try:
            tss.server_region = "CN"
            for a in ("_bing", "_google", "_alibaba", "_sogou"):
                o = getattr(tss, a, None)
                if o is not None:
                    o.server_region = "CN"
        except Exception:
            pass
        _TSS = _tt
    except Exception as e:
        _TSS_ERR = "%s: %s" % (type(e).__name__, str(e)[:90])
    return _TSS


_TOKEN_RE = re.compile(r"^[a-z0-9]{12,48}$")


def _looks_bad(src, dst, sl, tl):
    """免费接口解析失败时会吐出混淆 token（如 i8990hhp3ur98kqlkftp）或原样回传，当垃圾丢掉。"""
    d = (dst or "").strip()
    src = (src or "").strip()
    if not d:
        return True
    if d == src:
        return True
    flat = d.lower().replace(" ", "").replace("-", "").replace("_", "")
    if _TOKEN_RE.match(flat):
        return True
    if tl == "zh" and not _has_cjk(d):
        return True
    if sl == "zh" and _has_cjk(d):
        return True
    return False


def _mt_vendor(text, sl, tl):
    tt = _tss()
    if tt is None:
        raise RuntimeError("翻译库没加载起来（%s）" % (_TSS_ERR or "未知"))
    errs = []
    for eng in ENGINE_ORDER:
        try:
            r = tt(text, from_language=sl, to_language=tl, translator=eng, timeout=8)
            r = str(r or "").strip()
            if r and not _looks_bad(text, r, sl, tl):
                return r, ENGINE_ZH.get(eng, eng)
            errs.append(eng + ("：结果像乱码" if r else "：空"))
        except Exception as e:
            errs.append("%s:%s" % (eng, type(e).__name__))
    raise RuntimeError("；".join(errs))


GOOGLE_HOSTS = ("translate.google.com", "translate.googleapis.com")


def _google_one(host, text, tl):
    outs = []
    for i in range(0, len(text), 1500):
        chunk = text[i:i + 1500]
        url = ("https://%s/translate_a/single?client=gtx&dt=t&sl=auto&tl=%s&q=%s"
               % (host, tl, urllib.parse.quote(chunk)))
        d = json.loads(_mt_get(url))
        segs = (d[0] or []) if isinstance(d, list) and d else []
        t = "".join((x[0] or "") for x in segs if x)
        if not t.strip():
            raise RuntimeError("空结果")
        outs.append(t.strip())
    return " ".join(outs)


def _mt_google(text, tl):
    last = None
    for host in GOOGLE_HOSTS:
        try:
            return _google_one(host, text, tl)
        except Exception as e:
            last = "%s:%s" % (host.split(".")[1], type(e).__name__)
    raise RuntimeError(last or "谷歌不可用")


def _mt_mymemory(text, pair):
    outs = []
    for i in range(0, len(text), 450):
        chunk = text[i:i + 450]
        url = ("https://api.mymemory.translated.net/get?q=" + urllib.parse.quote(chunk)
               + "&langpair=" + urllib.parse.quote(pair))
        d = json.loads(_mt_get(url, timeout=15))
        t = ((d.get("responseData") or {}).get("translatedText") or "").strip()
        if not t:
            raise RuntimeError("空结果")
        outs.append(t)
    return " ".join(outs)


def translate_mt(text, src, dst):
    key = (text, src, dst)
    if key in _TCACHE:
        return _TCACHE[key]
    sl = "zh" if src == "中文" else "en"
    gtl = "en" if dst == "英文" else "zh-CN"
    pair = "zh-CN|en" if dst == "英文" else "en|zh-CN"

    errs = []
    for label, fn in (("翻译库", lambda: _mt_vendor(text, sl, "en" if dst == "英文" else "zh")),
                      ("谷歌直连", lambda: (_mt_google(text, gtl), "谷歌")),
                      ("MyMemory", lambda: (_mt_mymemory(text, pair), "MyMemory"))):
        try:
            got = fn()
            if isinstance(got, tuple):
                t, engine = got
            else:
                t, engine = got, label
            if t and str(t).strip():
                out = (str(t).strip(), engine)
                _TCACHE[key] = out
                if len(_TCACHE) > 500:
                    _TCACHE.clear()
                    _TCACHE[key] = out
                return out
        except Exception as e:
            errs.append("%s(%s)" % (label, str(e)[:40]))
    raise RuntimeError("；".join(errs) or "无可用接口")


def translate_text(text, to_lang="自动", service="本地 llama.cpp", api=None):
    text = (text or "").strip()
    if not text:
        return "", {"ms": 0, "tokens": 0, "engine": ""}
    t0 = time.time()
    src = "中文" if _has_cjk(text) else "英文"
    dst = to_lang if to_lang in ("中文", "英文") else ("英文" if src == "中文" else "中文")
    if src == dst:
        return text, {"ms": 0, "tokens": 0, "engine": "无需翻译"}

    mt_err = ""
    try:
        out, engine = translate_mt(text, src, dst)
        return out, {"ms": int((time.time() - t0) * 1000), "tokens": 0,
                     "engine": engine, "src": src, "dst": dst}
    except Exception as e:
        mt_err = str(e)[:120]

    sysmsg = (
        "你是提示词翻译器。把用户给的提示词从%s翻成%s。\n"
        "规则：只输出译文本身，不要解释、不要加引号、不要改动专有名词（模型名、LoRA 名、tag 保持原样）。\n"
        "保留原有的逗号分隔与换行结构。"
    ) % (src, dst)
    try:
        out, usage = llm_chat(
            [{"role": "system", "content": sysmsg}, {"role": "user", "content": text}],
            service, temperature=0.1, max_tokens=1200, api=api,
        )
    except Exception as e:
        raise RuntimeError("免费翻译接口失败（%s），LLM 兜底也失败（%s）。" % (mt_err, str(e)[:80]))
    usage = dict(usage or {})
    usage.update({"engine": "LLM 兜底", "mt_error": mt_err, "src": src, "dst": dst})
    return _strip_fence(out) or text, usage


# ---------------- 优化 ----------------

def _lang_rule(lang, text):
    has_cn = bool(re.search(r"[\u4e00-\u9fff]", text or ""))
    if lang == "中文":
        return "输出中文。"
    if lang == "英文":
        return "输出英文。"
    return "输出语种跟随输入：输入是中文就输出中文，输入是英文就输出英文。"


APPEAR_RE = re.compile(
    r"(^|_)(hair|eyes|eyebrows|eyelashes|face|skin|body|breasts?|lips|nose|mouth|teeth|beard|"
    r"freckles|abs|muscles|thighs|legs|feet|hands|ears|tail|wings|horns)(_|$)"
    r"|^(blonde|blue|red|black|white|brown|pink|purple|green|grey|gray|silver|aqua|orange|"
    r"multicolor|multicolored|two-tone)_(hair|eyes)$",
    re.I)

CONTRACT_HEAD = (
    "改写合同（最重要，违反就算写错）：\n"
    "1. 每个对象都要在用户原文里有出处：不许新增原文没有的主体、人数、身份、道具、动物、服装款式、"
    "背景元素。\n"
    "2. 不许删掉原文提到的任何要素，也不许替换主体或场景。\n"
    "3. 允许的改动：把原文已有的元素写清楚、调整语序让它连贯、按目标模型规范组织格式；"
    "原文写得具体的地方照抄原词，不要换同义词。\n"
)


def change_rules(keys=None, expand=False):
    """改写合同：按「侧重」「深度扩写」动态放开对应维度，避免与禁用条款互相打架。"""
    keys = [k for k in EXTRA_ORDER if k in set(keys or [])]
    picked = "、".join(keys)
    if expand:
        rule4 = (
            "4. 这次是深度扩写：允许在原文已有的对象上把状态写深，也允许补全景别、机位、光线、材质、"
            "色彩、构图、氛围、质感这些非主体维度；但人物、道具、动物、场景仍然一律不许新增，"
            "主体与人数必须不变。"
        )
        if keys:
            rule4 += (
                "用户勾了侧重（" + picked + "），这几个维度要比其他维度写得更深更具体、"
                "占全篇篇幅最多，并尽量放在句子前段。"
            )
        else:
            rule4 += "没有勾侧重时就各维度平均写好，不偏科。"
        rule5 = (
            "5. 篇幅不设限制：每个已有元素都写成完整的一句，允许补的维度各写到能画出画面为止，"
            "写完该说的就停，不要为了显长堆形容词或加对象，也不要因为怕长就省掉已提到的要素。"
        )
    elif keys:
        rule4 = (
            "4. 用户勾了侧重，意思就是「这几个方面多写」：勾选的维度（" + picked + "）要写得最具体、"
            "篇幅占比最大、尽量放在句子前段；没勾的维度只保留原文已经写到的内容，不额外补充。"
            "人物、道具、动物、场景仍然一律不许新增。"
        )
        rule5 = (
            "5. 篇幅不设限制：勾得越多就写越细，多出来的描写必须落在那几个侧重维度上；"
            "没有可写的就停，不要为凑字数补空话。"
        )
    else:
        rule4 = "4. 没有勾侧重：只整理原文，不补任何原文没有的环境、光线、镜头、材质。"
        rule5 = "5. 篇幅不设限制：宁可比原文短，也不许编造原文没有的东西。"
    tail = ("改写步骤：先在心里列出原文的每个要素，再逐条落到输出里；写完自查——有没有一个名词在原文里"
            "找不到出处？有就删掉。")
    return CONTRACT_HEAD + rule4 + "\n" + rule5 + "\n" + tail

FORMAT_RULES = (
    "格式规则（只输出一段最终提示词，绝对不要「tag 行 + 段落」这种两段式）：\n"
    "- 原文是 tag、目标模型也吃 tag（如 Illustrious/Pony）：输出一行逗号分隔的 tag。\n"
    "- 原文是 tag、目标模型要自然语句（如 Qwen-Image）：改写成规范允许的自然语句，"
    "但能出现的对象仍然只能是原文里那些 tag。\n"
    "- 原文是自然语句：用同样的语言写成自然语句，不要另外加一行 tag。\n"
    "- 语言跟随原文：中文原文输出中文，英文原文输出英文。"
)

EXTRA_RULES = {
    "质感": (
        "质感：写清材质与表面状态（皮肤通透度、织物褶皱与垂坠、金属/玻璃/水面的反射），"
        "光源位置与光比、色温与色调、镜头与景深、胶片颗粒/暗角，每个细节都要能画出来。"
    ),
    "动作": (
        "动作：写清重心落在哪只脚、关节角度（不反关节）、与物体的接触点、衣服与头发因动作产生的形变、"
        "运动方向与惯性、动作与视线的一致性；一个画面只留一组主动作。"
    ),
    "镜头": (
        "镜头：明确景别、机位高度、视角、焦段与透视压缩、构图落点，并让这些与动作和场景自洽。"
    ),
    "人像摄影": (
        "人像摄影：按真实人像布光来写——主光方向与柔硬、辅光与轮廓光、眼神光、鼻影与面部明暗过渡，"
        "皮肤质感（毛孔/细纹/油光）而非磨皮，发丝边缘光，背景与主体分离的景深控制。"
    ),
    "景别": (
        "景别：先定死一个景别（大特写/特写/近景/中景/中全景/全景/远景），全篇不许漂移；"
        "景别决定可见范围——特写只写脸和手，全景才写环境和人物位置关系。"
    ),
    "镜头逻辑": (
        "镜头逻辑：让画面像一次真实拍摄——机位在哪、镜头朝哪、被摄体在画面哪一侧、景深从哪里开始虚，"
        "前景/中景/背景各承担什么信息；禁止同时出现互相矛盾的机位或视角（如既仰拍又俯拍）。"
    ),
    "人物关系": (
        "人物关系：写清人物之间的相对位置（前后/左右/朝向）、谁看谁、谁碰谁、身高差与互动方式，"
        "以及关系带来的姿态与表情差异；多人场景要交代每个人的身份与动作，不要只写一个主角。"
    ),
    "光影": (
        "光影：写清光从哪来（窗光/霓虹/路灯/闪光灯）、方向与角度、硬光还是柔光、明暗交界在哪、"
        "反光与投影落在哪、色温对比；同一画面不要出现两个互相矛盾的主光方向。"
    ),
    "构图": (
        "构图：说明主体在画面的位置与占比、视觉引导线、前景遮挡、留白方向、地平线高低、"
        "对称或对角结构；构图要与景别、动作方向一致。"
    ),
    "色彩": (
        "色彩：给出主色、辅色与点缀色的比例关系，说明是同类色还是对比色、饱和度高低、"
        "整体色温倾向与暗部偏色；不要写「色彩丰富」这类空话。"
    ),
    "情绪": (
        "情绪：用可画出来的身体信号表达情绪（肩颈松紧、手指动作、呼吸、视线停留、嘴角与眉眼的细微变化），"
        "不要直接写「悲伤」「开心」这类标签词。"
    ),
    "场景": (
        "场景：交代空间层次（前景/中景/背景各有什么）、地面与墙面材质、可辨识的地标细节、"
        "天气与时间、环境里正在发生的事，让场景可信。"
    ),
    "服装": (
        "服装：写清款式、版型与合身程度、面料与纹理、层次与配饰（领口/袖口/腰带/纽扣/缝线），"
        "以及服装随动作产生的褶皱与垂坠。"
    ),
    "材质": (
        "材质：把每种表面的物理属性写出来——粗糙或光滑、干或湿、新或旧、透明或哑光，"
        "以及它在这种光线下怎么反光、怎么吃阴影（皮肤/布/木/石/金属/玻璃/水分别对待）。"
    ),
    "表情": (
        "表情：写清眉眼与嘴部的具体状态（眉梢、眼睑、瞳孔高光、嘴角弧度、下颌松紧）、"
        "视线方向与焦点，情绪靠这些信号表达，不要只写「微笑」「悲伤」这种标签。"
    ),
    "天气": (
        "天气：写清是晴/阴/雨/雪/雾/风，空气里的湿气或尘埃，以及它如何改变光线与材质的观感"
        "（雨天的反光、雾天的层次衰减、风带来的头发与衣料动态）。"
    ),
    "时间": (
        "时间：写清一天中的时段与季节（清晨/正午/黄昏/夜晚、春夏秋冬），"
        "连带出光线角度、色温、影子长度与生活痕迹（灯光开关、店里是否营业）。"
    ),
    "背景": (
        "背景：写清主体背后的空间是什么、离主体多远、是实是虚、有什么可辨识的物件与线条，"
        "背景只做衬托，不要抢主体，也不要引入新的人物或情节。"
    ),
    "视角": (
        "视角：写清观看位置与高度（平视/俯视/仰视/过肩/背后/主观视角）、与主体的距离，"
        "以及这个视角带来的透视变化与情绪倾向，全篇只用一个视角。"
    ),
}

EXTRA_ORDER = (
    "人像摄影", "景别", "镜头逻辑", "人物关系", "光影", "构图", "色彩",
    "质感", "动作", "镜头", "服装", "场景", "情绪", "材质", "表情", "天气", "时间", "背景", "视角",
)


def extra_keys(extras):
    """把 ["质感", "动作"] 或 "质感+动作" 归一成已知的维度名列表（按固定顺序）。"""
    if not extras:
        return []
    if isinstance(extras, str):
        extras = [x for x in re.split(r"[+＋,，、\s]+", extras) if x]
    want = set(extras)
    return [k for k in EXTRA_ORDER if k in want]


def extra_rules(extras):
    """把选中的侧重维度转成规则文本。"""
    return [EXTRA_RULES[k] for k in extra_keys(extras)]


def strip_appearance(prompt):
    """去掉与人物外貌有关的 tag（发型/发色/瞳色/脸/体型…），其余照留。"""
    keep = []
    for part in re.split(r"[,，]", prompt or ""):
        t = part.strip()
        if t and not APPEAR_RE.search(t.lower().replace(" ", "_")):
            keep.append(t)
    return "，".join(keep)


# 「要负面词/要标签清单」这类要求不是在描述画面，直接用规则给出，不交给模型自由发挥
DIRECT_RE = re.compile(r"负面|反向|negative|提示词列表|标签列表|标签清单", re.I)

NEGATIVE_COMMON_ZH = [
    "低清晰度", "模糊", "噪点", "过曝", "欠曝", "低质量", "最差质量", "像素化",
    "JPEG 压缩痕迹", "水印", "文字", "签名", "Logo", "边框", "马赛克",
    "多余手指", "缺失手指", "畸形手", "手部结构错误", "额外肢体", "缺失肢体",
    "多余手臂", "多余腿", "人体比例失调", "透视变形", "面部扭曲", "五官不对称",
    "眼睛不对称", "斜视", "嘴部变形", "牙齿畸形", "双头", "重复身体",
    "塑料感皮肤", "过度磨皮", "油光", "脏皮肤", "皮肤纹理缺失", "衣服穿模",
    "衣物褶皱错误", "配饰错误", "头发糊成一团", "发丝断裂", "卡通化", "3D 渲染感",
    "线条毛刺", "重影", "反光过强", "杂乱背景", "主体被裁切", "构图失衡",
    "多余物体", "重复人物", "分辨率不足",
]
NEGATIVE_COMMON_EN = [
    "low quality", "worst quality", "lowres", "blurry", "noise", "jpeg artifacts",
    "overexposed", "underexposed", "watermark", "text", "signature", "logo", "border",
    "extra fingers", "missing fingers", "bad hands", "malformed hands", "extra limbs",
    "missing limbs", "extra arms", "extra legs", "bad anatomy", "bad proportions",
    "deformed face", "asymmetric eyes", "cross-eyed", "bad mouth", "bad teeth",
    "two heads", "duplicate body", "plastic skin", "over-smoothed skin", "greasy skin",
    "clothing clipping", "bad cloth folds", "messy hair", "cartoon", "3d render",
    "lineart artifacts", "ghosting", "harsh reflections", "cluttered background",
    "cropped subject", "bad composition", "duplicate object", "low resolution",
]


def direct_reply(requirement, skill):
    """要求本身是「给我一份文本」时（例如提供常用的负面提示词），按规范规则直接给结果。"""
    req = (requirement or "").strip()
    if not req or not DIRECT_RE.search(req):
        return None
    base = [x.strip() for x in re.split(r"[,，、\n]+", skill.get("negative", "") or "") if x.strip()]
    en = bool(re.search(r"英文|english", req, re.I)) or (
        bool(base) and all(ord(c) < 128 for c in "".join(base))
    )
    base = [t for t in base if all(ord(c) < 128 for c in t) == en]
    picks, seen = [], set()
    for t in base + (NEGATIVE_COMMON_EN if en else NEGATIVE_COMMON_ZH):
        k = t.lower()
        if t and k not in seen:
            seen.add(k)
            picks.append(t)
    m = re.search(r"(\d+)\s*(个|条|项)", req)
    if m:
        picks = picks[:max(8, min(200, int(m.group(1))))]
    return ", ".join(picks) if en else "，".join(picks)


def build_opt_messages(requirement, skill_name, strength="标准", lang="自动", mode="优化",
                       extras=None, draft=""):
    """组装优化用的 messages：严格按用户要求写，写法规则来自目标模型规范，流式与非流式共用。"""
    requirement = (requirement or "").strip()
    draft = (draft or "").strip()
    skill = load_skill(skill_name)
    rules = skill.get("body") or "按摄影/绘画提示词的通用结构补全：主体、属性、场景、光线、镜头、材质、氛围。"
    has_input = bool(requirement or draft)
    parts = [
        f"你在按「{skill['title']}」的提示词规则写提示词。",
        rules,
    ]
    if has_input:
        parts += [
            "上面规范里的 1-7 步只用来组织原文已经写到的内容，不是添加内容的许可：原文没写到的项留空，不要补。",
            FORMAT_RULES,
        ]
        keys = extra_keys(extras)
        expand = mode == "扩写"
        parts.append(change_rules(keys, expand))
        if keys:
            parts += [
                "用户勾选的侧重（这几类必须写到、写具体，只写这几类）：",
            ] + extra_rules(keys) + [
                "输出前数一遍：勾选的每个侧重维度是不是都有具体描写？漏了就只补这几类，别补别的。",
            ]
    if requirement:
        parts += [
            "用户的要求（原文，按上面的合同逐字对待）：",
            f"「{requirement}」",
            _lang_rule(lang, requirement),
            "用户要的是一份文本（负面提示词清单、标签清单、翻译、写法解释、对比）而不是画面时，"
            "直接按用户要的内容和格式给出那份文本，不要把它当成主题去构思画面。",
        ]
        if draft:
            parts += [
                "用户手上已有一版提示词，只作参考；它与用户要求冲突时以要求为准，不要照抄它的毛病：",
                f"「{draft}」",
            ]
    else:
        parts += [
            "用户没有填写要求：请自行构思一个主题，按上面的规则写出一条完整可用的提示词，"
            "主题明确、细节具体，不要套模板。",
        ]
    if not has_input:
        parts += [
            "结构要求：先一句话定住主体与画面基调，再按「主体与人物关系 → 景别/机位/焦段 → 动作链（起因-过程-结果，"
            "含重心与惯性） → 环境与空间层次 → 光线方向与色温 → 材质与细节 → 氛围与情绪」的顺序推进，"
            "全篇围绕同一个瞬间，不要写成四段互不相干的清单。",
            "写法要求：句子里要有具体名词和数量（「35mm 镜头」「三扇落地窗」「袖口翻了一折」）；"
            "每个细节都必须能画出来；禁止比喻句、禁止形容词堆砌（不要连着三个以上形容词）、禁止重复主体词、"
            "禁止「美丽的」「令人惊叹的」「氛围感」这类空话；不要出现「画面中」「这张图」这种元叙述。",
            "一致性要求：全篇不能自相矛盾——景别不能中途变化，机位与视角不能互相冲突，"
            "主光方向只能有一个，人物动作与服装状态要能同时成立；"
            "如果信息不足，就做出一个明确的选择并贯彻到底，不要同时给两种可能。",
        ]
    parts += [
        "不要输出 JSON，不要加标题、编号、解释或 markdown。只给提示词正文本身。",
    ]
    sys_ = "\n".join(parts)
    user_text = requirement or "（没有具体要求，请随机构思一个主题）"
    return [{"role": "system", "content": sys_}, {"role": "user", "content": user_text}], skill


STREAM_SEP = "\n\u0001\n"


def chat_stream(messages, service="本地 llama.cpp", temperature=0.7, max_tokens=1400, api=None):
    """流式读 llama.cpp / DeepSeek 的 SSE，逐块产出正文。"""
    base, key, model, timeout = _api_pick(api, service)
    if not base:
        raise RuntimeError(f"{service} 没填 API 地址")
    if service == "DeepSeek" and not key:
        raise RuntimeError("DeepSeek 没填 API 密钥：在节点的『API 密钥』里粘贴 sk-… 即可")
    if not model:
        ck = f"{base}|{key}"
        model = _MODEL_CACHE.get(ck) or _models(base, key) or "local-model"
        _MODEL_CACHE[ck] = model
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{base}/chat/completions", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise _http_err(service, base, model, e)
    except urllib.error.URLError as e:
        raise RuntimeError(f"连不上 {service}（{base}）：{e.reason}")
    with resp:
        for raw in resp:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if chunk == "[DONE]":
                break
            try:
                j = json.loads(chunk)
            except Exception:
                continue
            ch = (j.get("choices") or [{}])[0]
            piece = (ch.get("delta") or {}).get("content") or ""
            if piece:
                yield piece


def optimize_stream(requirement, skill_name, strength="标准", lang="自动",
                    service="本地 llama.cpp", count=1, api=None, mode="优化",
                    extras=None, draft=""):
    """流式优化：严格按 requirement 写，多个候选之间用 STREAM_SEP 分隔。"""
    direct = direct_reply(requirement, load_skill(skill_name))
    if direct:
        yield direct
        return
    messages, _skill = build_opt_messages(requirement, skill_name, strength, lang, mode, extras, draft)
    n = max(1, min(int(count or 1), 5))
    try:
        for i in range(n):
            if i:
                yield STREAM_SEP
            for piece in chat_stream(messages, service, 0.7 if i == 0 else 0.9, 0, api):
                yield piece
    finally:
        pass


def optimize_text(requirement, skill_name, strength="标准", lang="自动", service="本地 llama.cpp",
                  count=1, api=None, mode="优化", extras=None, draft=""):
    skill_pre = load_skill(skill_name)
    direct = direct_reply(requirement, skill_pre)
    if direct:
        return [direct], {"ms": 0, "tokens": 0, "direct": True}, skill_pre
    messages, skill = build_opt_messages(requirement, skill_name, strength, lang, mode, extras, draft)
    outs, usage = [], {"ms": 0, "tokens": 0}
    for i in range(max(1, min(int(count or 1), 5))):
        out, u = llm_chat(
            messages, service, temperature=0.7 if i == 0 else 0.9, max_tokens=0, api=api,
        )
        usage = u
        cleaned = _strip_fence(out)
        if cleaned and cleaned not in outs:
            outs.append(cleaned)
    if not outs:
        raise RuntimeError("模型没有返回内容")
    return outs, usage, skill


def compose(prompt, skill_name):
    """只组装正面提示词（负面提示词功能已移除），纯规则，不联网。"""
    skill = load_skill(skill_name)
    pos = (prompt or "").strip()
    if not pos:
        return ""
    prefix, suffix = skill.get("prefix", ""), skill.get("suffix", "")
    if prefix:
        pos = f"{prefix}, {pos}"
    if suffix:
        pos = f"{pos}, {suffix}"
    return pos


def skill_cards():
    """给前端联动用：目标模型 -> 规范文件。"""
    out = []
    for name in list_skills():
        sk = load_skill(name)
        out.append({
            "name": name,
            "title": sk.get("title", name),
            "target": sk.get("target", name),
            "negative_mode": sk.get("negative_mode") or "分开输出",
            "tag_format": sk.get("tag_format", "space"),
        })
    return out


# ---------------- 标签库 ----------------

def _db():
    return sqlite3.connect(f"file:{TAGS_DB}?mode=ro", uri=True)


def _db_rw():
    return sqlite3.connect(TAGS_DB, timeout=15)


def _has_extra(con):
    try:
        r = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='zh_extra'").fetchone()
        return bool(r)
    except sqlite3.Error:
        return False


def search_tags(query="", grp="", limit=60, hot_only=True, levels=(0, 1), offset=0):
    if not os.path.isfile(TAGS_DB):
        return []
    con = _db()
    try:
        extra = _has_extra(con)
        zh = "COALESCE(x.zh, t.zh)" if extra else "t.zh"
        join = " LEFT JOIN zh_extra x ON x.tag = t.tag" if extra else ""
        sql = ["SELECT t.tag, %s AS zh, t.cnt, t.grp, t.lvl FROM tags t%s WHERE t.lvl IN (%s)"
               % (zh, join, ",".join("?" * len(levels)))]
        args = list(levels)
        if grp:
            sql.append("AND t.grp = ?")
            args.append(grp)
        if hot_only:
            sql.append("AND t.cnt >= 100")
        q = (query or "").strip()
        if q:
            if re.search(r"[\u4e00-\u9fff]", q):
                sql.append("AND (%s LIKE ? OR t.tag LIKE ?)" % zh)
                args += [f"%{q}%", f"{q}%"]
            else:
                sql.append("AND t.tag LIKE ?")
                args.append(f"{q}%")
        if 2 in levels:
            sql.append("ORDER BY (t.lvl = 2) DESC, t.cnt DESC LIMIT ? OFFSET ?")
        else:
            sql.append("ORDER BY t.cnt DESC LIMIT ? OFFSET ?")
        args += [int(limit), int(offset)]
        rows = con.execute(" ".join(sql), args).fetchall()
    finally:
        con.close()
    return [r for r in rows if r[0] not in META_BLACK]


def count_tags(query="", grp="", hot_only=True, levels=(0, 1)):
    """给分页器用的总数。"""
    if not os.path.isfile(TAGS_DB):
        return 0
    con = _db()
    try:
        extra = _has_extra(con)
        zh = "COALESCE(x.zh, t.zh)" if extra else "t.zh"
        join = " LEFT JOIN zh_extra x ON x.tag = t.tag" if extra else ""
        sql = ["SELECT COUNT(*) FROM tags t%s WHERE t.lvl IN (%s)"
               % (join, ",".join("?" * len(levels)))]
        args = list(levels)
        if grp:
            sql.append("AND t.grp = ?")
            args.append(grp)
        if hot_only:
            sql.append("AND t.cnt >= 100")
        q = (query or "").strip()
        if q:
            if re.search(r"[\u4e00-\u9fff]", q):
                sql.append("AND (%s LIKE ? OR t.tag LIKE ?)" % zh)
                args += [f"%{q}%", f"{q}%"]
            else:
                sql.append("AND t.tag LIKE ?")
                args.append(f"{q}%")
        n = con.execute(" ".join(sql), args).fetchone()[0]
    except sqlite3.Error:
        n = 0
    finally:
        con.close()
    return int(n or 0)


def suggest_tags(token, limit=8, levels=(0, 1)):
    """写字时的候选：拿 token 的后缀去中文名里找，命中多的那个后缀优先。"""
    token = (token or "").strip()
    if not token or not os.path.isfile(TAGS_DB):
        return [], ""
    con = _db()
    try:
        extra = _has_extra(con)
        zh = "COALESCE(x.zh, t.zh)" if extra else "t.zh"
        join = " LEFT JOIN zh_extra x ON x.tag = t.tag" if extra else ""
        ph = ",".join("?" * len(levels))
        best, best_sub, best_n = [], "", 0
        for L in range(min(len(token), 8), 0, -1):
            sub = token[-L:]
            try:
                rows = con.execute(
                    f"SELECT t.tag, {zh} AS zh, t.cnt, t.grp FROM tags t{join} "
                    f"WHERE t.lvl IN ({ph}) AND {zh} LIKE ? ORDER BY t.cnt DESC LIMIT 12",
                    list(levels) + ["%" + sub + "%"]).fetchall()
            except sqlite3.Error:
                rows = []
            rows = [r for r in rows if r[0] not in META_BLACK]
            if len(rows) > best_n:
                best, best_sub, best_n = rows, sub, len(rows)
        if best_n >= 3:
            return best[:limit], best_sub
    finally:
        con.close()
    return [], ""


def lookup_tags(tags):
    """把已有提示词里的英文 tag 翻成中文（渲染标签块用）。"""
    tags = [t for t in (tags or []) if t][:300]
    if not tags or not os.path.isfile(TAGS_DB):
        return {}
    con = _db()
    try:
        extra = _has_extra(con)
        zh = "COALESCE(x.zh, t.zh)" if extra else "t.zh"
        join = " LEFT JOIN zh_extra x ON x.tag = t.tag" if extra else ""
        ph = ",".join("?" * len(tags))
        rows = con.execute(
            f"SELECT t.tag, {zh} AS zh FROM tags t{join} WHERE t.tag IN ({ph})",
            tags).fetchall()
    except sqlite3.Error:
        rows = []
    finally:
        con.close()
    return {r[0]: (r[1] or "") for r in rows}


def lvl_of(tags):
    """返回 tag -> 分级（0 安全 / 1 擦边 / 2 成人）。"""
    tags = [t for t in (tags or []) if t][:300]
    if not tags or not os.path.isfile(TAGS_DB):
        return {}
    con = _db()
    try:
        ph = ",".join("?" * len(tags))
        rows = con.execute("SELECT tag, lvl FROM tags WHERE tag IN (%s)" % ph, tags).fetchall()
    except sqlite3.Error:
        rows = []
    finally:
        con.close()
    return {r[0]: int(r[1] or 0) for r in rows}


def zh_fill(tags):
    """现场补中文：库里没有的，机翻一次并写进 zh_extra（最多 24 条）。"""
    tags = [t for t in (tags or []) if t][:24]
    if not tags or not os.path.isfile(TAGS_DB):
        return {}
    con = _db_rw()
    out = {}
    try:
        con.execute("CREATE TABLE IF NOT EXISTS zh_extra(tag TEXT PRIMARY KEY, zh TEXT)")
        ph = ",".join("?" * len(tags))
        have = {r[0]: r[1] for r in con.execute(
            f"SELECT tag, zh FROM zh_extra WHERE tag IN ({ph})", tags).fetchall() if r[1]}
        out.update(have)
        want = [t for t in tags if t not in have and not re.search(r"[\u4e00-\u9fff]", t)]
        if not want:
            return out
        words = [t.replace("_", " ") for t in want]
        lines = []
        try:
            txt, _eng = _mt_vendor("\n".join(words), "en", "zh")
            lines = [x.strip() for x in (txt or "").split("\n") if x.strip()]
        except Exception:
            lines = []
        if len(lines) == len(want):
            for tag, zh in zip(want, lines):
                zh = zh.strip("。.，,、\"'“”")[:40]
                if zh and zh.lower() != tag.replace("_", " ").lower():
                    con.execute("INSERT OR REPLACE INTO zh_extra(tag, zh) VALUES(?,?)", (tag, zh))
                    out[tag] = zh
            con.commit()
    except sqlite3.Error:
        pass
    finally:
        con.close()
    return out


HAIR_RE = re.compile(
    r"^(long_hair|short_hair|medium_hair|very_long_hair|absurdly_long_hair"
    r"|(blonde|black|brown|red|blue|white|pink|purple|green|silver|grey|gray"
    r"|aqua|orange|multicolored|two_tone)_hair)$")
EYES_RE = re.compile(
    r"^(blue|red|green|brown|purple|yellow|black|pink|orange|grey|gray"
    r"|silver|white|multicolored|heterochromia)_eyes$")
COUNT_RE = re.compile(r"^(1girl|1boy|2girls|multiple_girls)$")


def _pool(con, grp, min_cnt, pat=None, levels=(0,)):
    ph = ",".join("?" * len(levels))
    try:
        rows = con.execute(
            f"SELECT tag, zh, cnt, grp FROM tags WHERE lvl IN ({ph}) AND grp = ? AND cnt >= ? "
            f"ORDER BY cnt DESC LIMIT 400",
            list(levels) + [grp, int(min_cnt)]).fetchall()
    except sqlite3.Error:
        return []
    out = [r for r in rows if r[0] not in RAND_BLACK and not SUSPECT_RE.search(r[0])]
    if pat is not None:
        out = [r for r in out if pat.match(r[0])]
    return out


def random_tags(nsfw=False, count=10):
    """随机拼一串：每个小类只出一个，同类不打架（1girl 不会和 1boy 同时出现）。"""
    if not os.path.isfile(TAGS_DB):
        return []
    levels = (0, 1) if nsfw else (0,)
    con = _db()
    try:
        picks, seen = [], set()

        def take(rows, ratio=1.0):
            if not rows:
                return
            if ratio < 1.0 and random.random() > ratio:
                return
            r = random.choice(rows)
            if r[0] in seen:
                return
            seen.add(r[0])
            picks.append(list(r))

        take(_pool(con, "人物", 10000, COUNT_RE, levels))
        if not nsfw and picks and picks[0][0] == "1girl" and random.random() < 0.35:
            for r in _pool(con, "人物", 10000, None, levels):
                if r[0] == "solo":
                    if "solo" not in seen:
                        seen.add("solo")
                        picks.append(list(r))
                    break
        take(_pool(con, "人物", 5000, HAIR_RE, levels))
        take(_pool(con, "人物", 3000, EYES_RE, levels), 0.8)
        take(_pool(con, "表情", 3000, None, levels))
        take(_pool(con, "服装", 5000, None, levels))

        if nsfw:
            extra = con.execute(
                "SELECT tag, zh, cnt, grp FROM tags WHERE lvl = 2 AND cnt >= 800 "
                "AND grp IN ('服装','动作','表情','场景','其他') ORDER BY cnt DESC LIMIT 300"
            ).fetchall()
            extra = [r for r in extra if r[0] not in RAND_BLACK]
            take(extra[:120])
            take(extra[120:260], 0.7)

        take(_pool(con, "动作", 5000, None, levels))
        take(_pool(con, "场景", 3000, None, levels))
        take(_pool(con, "镜头", 3000, None, levels))
        take(_pool(con, "光线", 2000, None, levels))
        take(_pool(con, "风格", 2000, None, levels), 0.55)
        take(_pool(con, "特效", 1000, None, levels), 0.3)
    finally:
        con.close()
    return picks[:max(1, min(int(count or 10), 20))]


def tag_stats():
    if not os.path.isfile(TAGS_DB):
        return {}
    con = _db()
    try:
        extra = _has_extra(con)
        total = con.execute("SELECT COUNT(*) FROM tags").fetchone()[0]
        hot = con.execute("SELECT COUNT(*) FROM tags WHERE cnt>=100").fetchone()[0]
        if extra:
            zh = con.execute(
                "SELECT COUNT(*) FROM tags t LEFT JOIN zh_extra x ON x.tag = t.tag "
                "WHERE COALESCE(NULLIF(x.zh,''), t.zh, '') <> ''").fetchone()[0]
        else:
            zh = con.execute("SELECT COUNT(*) FROM tags WHERE COALESCE(zh,'')<>''").fetchone()[0]
    finally:
        con.close()
    return {"total": total, "hot": hot, "zh": zh}


# ---------------- 收藏 ----------------

def fav_list():
    if not os.path.isfile(FAV_PATH):
        return []
    try:
        with open(FAV_PATH, "r", encoding="utf-8-sig") as f:
            items = json.load(f)
        return items if isinstance(items, list) else []
    except Exception:
        return []


def _fav_write(items):
    os.makedirs(DATA, exist_ok=True)
    tmp = FAV_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FAV_PATH)


def fav_add(text, name=""):
    text = (text or "").strip()
    if not text:
        raise RuntimeError("没有内容可收藏")
    items = fav_list()
    for it in items:
        if (it.get("text") or "").strip() == text:
            items.remove(it)
            break
    items.insert(0, {"text": text, "name": (name or text[:24]), "ts": int(time.time())})
    _fav_write(items[:200])
    return items[:200]


def fav_del(index=None, text=None):
    items = fav_list()
    if text:
        items = [it for it in items if (it.get("text") or "").strip() != text.strip()]
    elif index is not None:
        try:
            items.pop(int(index))
        except (ValueError, IndexError):
            pass
    _fav_write(items)
    return items


# ---------------- 节点 ----------------

def _targets():
    seen = []
    for name in list_skills():
        t = load_skill(name).get("target") or name
        if t not in seen:
            seen.append(t)
    return seen or ["Qwen-Image 2.1"]


class PromptForge:
    """提示词工坊：翻译 / 优化 / tag 面板都在前端 JS 里，这里只负责产出一根提示词 STRING。"""

    CATEGORY = CATEGORY
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("提示词",)
    FUNCTION = "forge"

    @classmethod
    def INPUT_TYPES(cls):
        targets = _targets()
        return {
            "required": {
                "目标模型": (targets, {"default": targets[0]}),
                "语言": (LANG_MODES, {"default": "自动"}),
                "服务": (SERVICE_MODES, {"default": "本地 llama.cpp"}),
                "提示词": ("STRING", {"multiline": True, "default": "", "dynamicPrompts": False}),
            },
        }

    def forge(self, 提示词="", 目标模型=None, **kw):
        # 兼容旧工作流：老版本还有个『规范』输入，取不到就退回默认规范
        skill = resolve_skill(目标模型 or kw.get("规范"))
        return (compose(提示词, skill),)

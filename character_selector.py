import os
import io
import time
import hashlib
import torch
import numpy as np
from PIL import Image
from server import PromptServer
from aiohttp import web
import folder_paths

class VisualCharacterSelector:
    @classmethod
    def INPUT_TYPES(s):
        try:
            base_out = folder_paths.get_output_directory()
        except:
            base_out = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "output")
        
        default_path = os.path.normpath(os.path.join(base_out, "Characters"))
        return {
            "required": {
                "base_directory": ("STRING", {"default": default_path}),
                "image_path": ("STRING", {"default": ""}),
            }
        }

    # 输出顺序：图像 → 提示词
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "提示词")
    FUNCTION = "load_image"
    CATEGORY = "geniusewzq_tools"

    @classmethod
    def IS_CHANGED(cls, base_directory, image_path):
        """
        确保节点每次都会重新执行，以读取可能已更新的提示词文件。
        返回当前时间戳，使ComfyUI认为节点状态已变化。
        """
        import time
        return time.time()

    def load_image(self, base_directory, image_path):
        # 默认空返回
        if not image_path or not os.path.exists(image_path):
            return (torch.zeros([1, 64, 64, 3]), "")

        # 1. 加载图像并转换为 Tensor
        img_tensor = torch.zeros([1, 64, 64, 3])
        try:
            img = Image.open(image_path)
            width, height = img.size
            print(f"[VisualCharacterSelector] 图像尺寸: {width}x{height}, 模式: {img.mode}")
            img = img.convert("RGB")
            img_np = np.array(img).astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(img_np)[None,]
        except Exception as e:
            print(f"图片加载失败: {e}")

        # 2. 逻辑新增：读取同名 txt 内容
        prompt_text = ""
        txt_path = os.path.splitext(image_path)[0] + ".txt"
        if os.path.exists(txt_path):
            try:
                with open(txt_path, "r", encoding="utf-8") as f:
                    prompt_text = f.read()
            except Exception as e:
                print(f"读取提示词文件失败: {e}")

        return (img_tensor, prompt_text)

# --- 路由部分：供前端画廊调用 ---

@PromptServer.instance.routes.get("/geniusewzq/get_gallery")
async def get_gallery(request):
    path = request.query.get("path", "").strip()
    if not path:
        return web.json_response({"error": "路径为空", "tree": {}, "prompts": {}, "mtimes": {}})
    
    path = os.path.normpath(path)
    if not os.path.exists(path):
        try:
            os.makedirs(path, exist_ok=True)
        except Exception as e:
            return web.json_response({"error": str(e), "tree": {}, "prompts": {}, "mtimes": {}})
    
    tree = {}
    prompts = {}
    mtimes = {}
    try:
        for root, dirs, files in os.walk(path):
            # 跳过隐藏目录（含删除回收站 .gswq_trash），它们不该出现在资源库里
            dirs[:] = sorted(d for d in dirs if not d.startswith("."))
            rel_path = os.path.relpath(root, path)
            # 筛选图片文件
            images = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
            # 所有目录都进树（包括空文件夹，便于上传图片时找到它）；无图则为空列表
            safe_rel_path = rel_path.replace("\\", "/")
            tree[safe_rel_path] = sorted(images)
            # 顺带标记哪些图片有非空同名 txt：前端列表直接显示 💬，不用逐张点开才知道
            with_prompt = []
            for f in images:
                txt_path = os.path.splitext(os.path.join(root, f))[0] + ".txt"
                try:
                    with open(txt_path, "r", encoding="utf-8", errors="ignore") as fh:
                        if fh.read().strip():
                            with_prompt.append(f)
                except OSError:
                    pass
            if with_prompt:
                prompts[safe_rel_path] = sorted(with_prompt)
            # 顺带带回修改时间，让“最新在前”是真的按时间而不是按文件名反转
            folder_mtimes = {}
            for f in images:
                try:
                    folder_mtimes[f] = os.path.getmtime(os.path.join(root, f))
                except OSError:
                    pass
            mtimes[safe_rel_path] = folder_mtimes
    except Exception as e:
        return web.json_response({"error": str(e), "tree": {}, "prompts": {}, "mtimes": {}})

    return web.json_response({"tree": tree, "prompts": prompts, "mtimes": mtimes, "error": None})

@PromptServer.instance.routes.get("/geniusewzq/list_folder")
async def list_folder(request):
    """只列一层：当前文件夹的图片 + 直接子文件夹（带各自图片数量）。
    资源库很大时，全库 os.walk 会让根目录卡住，所以前端改成按需展开。"""
    base = os.path.normpath((request.query.get("path", "") or "").strip())
    folder = (request.query.get("folder", ".") or ".").strip() or "."
    empty = {"folder": folder.replace("\\", "/"), "files": [], "mtimes": {},
             "prompts": [], "childCounts": {}, "error": None}
    if not base or not os.path.isdir(base):
        empty["error"] = "路径不存在"
        return web.json_response(empty)
    target = os.path.normpath(os.path.join(base, folder))
    try:
        base_abs = os.path.abspath(base).lower()
        if os.path.commonpath([base_abs, os.path.abspath(target).lower()]) != base_abs:
            empty["error"] = "路径越界"
            return web.json_response(empty)
    except ValueError:
        empty["error"] = "路径无效"
        return web.json_response(empty)

    exts = ('.png', '.jpg', '.jpeg', '.webp', '.bmp')
    files, mtimes, prompts, child_counts = [], {}, [], {}
    try:
        with os.scandir(target) as it:
            entries = list(it)
        for e in entries:
            if e.is_dir():
                # 跳过隐藏目录（含删除回收站 .gswq_trash）
                if e.name.startswith(".") or e.name == "__pycache__":
                    continue
                count = 0
                try:
                    with os.scandir(e.path) as sub:
                        for s in sub:
                            if s.is_file() and s.name.lower().endswith(exts):
                                count += 1
                except OSError:
                    pass
                child_counts[os.path.relpath(e.path, base).replace("\\", "/")] = count
            elif e.is_file() and e.name.lower().endswith(exts):
                files.append(e.name)
                try:
                    mtimes[e.name] = e.stat().st_mtime
                except OSError:
                    pass
    except Exception as e:
        empty["error"] = str(e)
        return web.json_response(empty)

    files.sort()
    for f in files:
        txt_path = os.path.splitext(os.path.join(target, f))[0] + ".txt"
        try:
            with open(txt_path, "r", encoding="utf-8", errors="ignore") as fh:
                if fh.read().strip():
                    prompts.append(f)
        except OSError:
            pass
    return web.json_response({
        "folder": folder.replace("\\", "/"),
        "files": files,
        "mtimes": mtimes,
        "prompts": sorted(prompts),
        "childCounts": child_counts,
        "error": None,
    })

@PromptServer.instance.routes.get("/geniusewzq/check_path")
async def check_path(request):
    """给路径栏用：判断输入的绝对路径是否存在、是不是文件夹（不创建任何东西）。"""
    p = (request.query.get("path", "") or "").strip()
    if not p:
        return web.json_response({"exists": False, "is_dir": False})
    p = os.path.normpath(p)
    return web.json_response({
        "exists": os.path.exists(p),
        "is_dir": os.path.isdir(p),
        "path": p,
    })


def _fnv1a_hex(text: str) -> str:
    """和前端 visual_browser.js 里的 fnv1a 完全一致（UTF-8 字节、32 位）。"""
    h = 0x811C9DC5
    for b in text.encode("utf-8", "ignore"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


@PromptServer.instance.routes.post("/geniusewzq/preview_cache")
async def preview_cache(request):
    """
    把选中图片生成一张 input/gswq_previews 下的缩略图。
    目的：MiniMax H3 Director 之类的下游节点用 /view?type=input 找缩略图，
    只能读到 input 目录下的文件；图库通常在 output 目录，所以要镜像一份。

    文件名只用路径的 FNV-1a 哈希（不含 mtime/size），这样前端在选中的瞬间
    就能算出文件名并立刻写给下游，不用等这个请求返回（否则下游会慢一张图）。
    """
    try:
        data = await request.json()
        src = data.get("path")
        if not src or not os.path.isfile(src):
            return web.json_response({"success": False, "error": "文件不存在"})

        abs_src = os.path.abspath(src)
        name = f"p_{_fnv1a_hex(os.path.normcase(abs_src).replace(os.sep, '/'))}.png"

        in_dir = os.path.join(folder_paths.get_input_directory(), "gswq_previews")
        os.makedirs(in_dir, exist_ok=True)
        dst = os.path.join(in_dir, name)

        # 每次都重新生成：同名路径图片被改过时也能立刻刷新
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((640, 640), Image.LANCZOS)
            im.save(dst, "PNG")

        # 顺手清掉 7 天前的旧缩略图
        now = time.time()
        for f in os.listdir(in_dir):
            fp = os.path.join(in_dir, f)
            try:
                if now - os.path.getmtime(fp) > 7 * 24 * 3600:
                    os.remove(fp)
            except OSError:
                pass

        return web.json_response({
            "success": True,
            "subfolder": "gswq_previews",
            "filename": name,
            "rel": f"gswq_previews/{name}",
        })
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


# 缩略图内存缓存：(绝对路径, mtime, 大小, 边长) -> JPEG 字节
_thumb_cache = {}
_THUMB_CACHE_MAX = 600


@PromptServer.instance.routes.get("/geniusewzq/view_image")
async def view_image(request):
    img_path = request.query.get("path", "")
    if not os.path.exists(img_path):
        return web.Response(status=404)

    thumb = request.query.get("thumb")
    if thumb:
        try:
            size = max(16, min(1024, int(thumb)))
        except (TypeError, ValueError):
            size = 64
        try:
            st = os.stat(img_path)
            key = (os.path.abspath(img_path), st.st_mtime, st.st_size, size)
            data = _thumb_cache.get(key)
            if data is None:
                with Image.open(img_path) as im:
                    im = im.convert("RGB")
                    im.thumbnail((size, size), Image.LANCZOS)
                    buf = io.BytesIO()
                    im.save(buf, "JPEG", quality=82)
                    data = buf.getvalue()
                if len(_thumb_cache) > _THUMB_CACHE_MAX:
                    _thumb_cache.clear()
                _thumb_cache[key] = data
            return web.Response(
                body=data,
                content_type="image/jpeg",
                headers={"Cache-Control": "max-age=86400"},
            )
        except Exception:
            pass  # 缩略图生成失败就退回原图，不影响显示

    return web.FileResponse(img_path)

# --- 新增路由：上传图片 ---
@PromptServer.instance.routes.post("/geniusewzq/upload_image")
async def upload_image(request):
    try:
        reader = await request.multipart()
        
        target_dir = None
        image_data = None
        filename = None
        
        async for part in reader:
            if part.name == 'targetDir':
                target_dir = (await part.text()).strip()
            elif part.name == 'image':
                filename = part.filename
                image_data = await part.read()
        
        if not target_dir or not image_data or not filename:
            return web.json_response({"success": False, "error": "缺少必要参数"})
        
        # 检查目标目录是否存在，不自动创建
        if not os.path.exists(target_dir):
            return web.json_response({"success": False, "error": f"目录不存在: {target_dir}"})
        
        # 生成安全的文件名
        safe_filename = os.path.basename(filename)
        target_path = os.path.join(target_dir, safe_filename)
        
        # 如果文件已存在，添加数字后缀自动重命名
        base, ext = os.path.splitext(safe_filename)
        counter = 1
        while os.path.exists(target_path):
            target_path = os.path.join(target_dir, f"{base}_{counter}{ext}")
            counter += 1
        
        # 保存图片
        with open(target_path, 'wb') as f:
            f.write(image_data)
        
        final_filename = os.path.basename(target_path)
        print(f"图片已上传: {target_path}")
        return web.json_response({"success": True, "filename": final_filename})
    except Exception as e:
        print(f"上传图片出错: {str(e)}")
        return web.json_response({"success": False, "error": str(e)})

# --- 新增路由：保存/编辑提示词内容 ---
@PromptServer.instance.routes.post("/geniusewzq/save_prompt")
async def save_prompt(request):
    try:
        data = await request.json()
        img_path = data.get("path")
        content = data.get("content", "")
        
        if not img_path:
            return web.json_response({"success": False, "error": "未提供路径"})

        # 生成同名 txt 路径
        txt_path = os.path.splitext(img_path)[0] + ".txt"
        
        # 写入内容（覆盖或新建）
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        print(f"提示词已更新: {txt_path}")
        return web.json_response({"success": True})
    except Exception as e:
        print(f"保存提示词出错: {str(e)}")
        return web.json_response({"success": False, "error": str(e)})

# --- 新增路由：读取提示词（供前端大图预览时载入） ---
@PromptServer.instance.routes.get("/geniusewzq/get_prompt")
async def get_prompt(request):
    img_path = request.query.get("path", "")
    if not img_path:
        return web.json_response({"content": ""})
        
    txt_path = os.path.splitext(img_path)[0] + ".txt"
    if os.path.exists(txt_path):
        with open(txt_path, "r", encoding="utf-8") as f:
            return web.json_response({"content": f.read()})
    
    return web.json_response({"content": ""})


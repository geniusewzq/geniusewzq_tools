import os
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
                "invert_mask": ("BOOLEAN", {"default": False}),
                "no_alpha_mode": (["opaque", "transparent"], {"default": "opaque"}),
            }
        }

    # 输出顺序：图像 → 提示词 → 透明通道
    # 注意：调整顺序会让旧工作流里已连好的“透明通道/提示词”两根线错位，需要重新连接。
    RETURN_TYPES = ("IMAGE", "STRING", "MASK")
    RETURN_NAMES = ("图像", "提示词", "透明通道")
    FUNCTION = "load_image"
    CATEGORY = "geniusewzq_tools"

    @classmethod
    def IS_CHANGED(cls, base_directory, image_path, invert_mask=False, no_alpha_mode="opaque"):
        """
        确保节点每次都会重新执行，以读取可能已更新的提示词文件。
        返回当前时间戳，使ComfyUI认为节点状态已变化。
        """
        import time
        return time.time()

    def load_image(self, base_directory, image_path, invert_mask=False, no_alpha_mode=None):
        # 处理空值情况（兼容旧工作流）
        if no_alpha_mode is None or no_alpha_mode == "":
            no_alpha_mode = "opaque"
        # 默认空返回
        if not image_path or not os.path.exists(image_path):
            return (torch.zeros([1, 64, 64, 3]), "", torch.zeros([1, 64, 64]))

        # 1. 加载图像并转换为 Tensor
        img_tensor = torch.zeros([1, 64, 64, 3])
        alpha_tensor = torch.zeros([1, 64, 64])
        try:
            img = Image.open(image_path)
            width, height = img.size
            print(f"[VisualCharacterSelector] 图像尺寸: {width}x{height}, 模式: {img.mode}")
            # 获取透明通道（如果有的话）
            if img.mode == 'RGBA':
                img_np = np.array(img).astype(np.float32) / 255.0
                rgb_np = img_np[:, :, :3]
                # 反转alpha：原alpha=1(不透明)变为0，alpha=0(透明)变为1
                # 这样mask中白色表示透明区域，黑色表示不透明区域
                alpha_np = 1.0 - img_np[:, :, 3]
                img_tensor = torch.from_numpy(rgb_np)[None,]
                alpha_tensor = torch.from_numpy(alpha_np)[None,]
                print(f"[VisualCharacterSelector] RGBA图像 Alpha范围: {alpha_np.min():.3f} - {alpha_np.max():.3f}, 透明像素数: {np.sum(alpha_np > 0)}")
            else:
                img = img.convert("RGB")
                img_np = np.array(img).astype(np.float32) / 255.0
                img_tensor = torch.from_numpy(img_np)[None,]
                # 无透明通道，根据no_alpha_mode决定返回全0（opaque，黑色）还是全1（transparent，白色）
                # 注意：mask已反转，0=黑色=不透明，1=白色=透明
                if no_alpha_mode == "opaque":
                    alpha_tensor = torch.zeros([1, height, width])
                    print(f"[VisualCharacterSelector] RGB图像 无Alpha通道，返回全0 mask (opaque/黑色), 尺寸: {height}x{width}")
                else:
                    alpha_tensor = torch.ones([1, height, width])
                    print(f"[VisualCharacterSelector] RGB图像 无Alpha通道，返回全1 mask (transparent/白色), 尺寸: {height}x{width}")
            
            # 如果需要反转mask
            if invert_mask:
                alpha_tensor = 1.0 - alpha_tensor
                print(f"[VisualCharacterSelector] Mask已反转")
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

        return (img_tensor, prompt_text, alpha_tensor)

# --- 路由部分：供前端画廊调用 ---

@PromptServer.instance.routes.get("/geniusewzq/get_gallery")
async def get_gallery(request):
    path = request.query.get("path", "").strip()
    if not path:
        return web.json_response({"error": "路径为空", "tree": {}})
    
    path = os.path.normpath(path)
    if not os.path.exists(path):
        try:
            os.makedirs(path, exist_ok=True)
        except Exception as e:
            return web.json_response({"error": str(e), "tree": {}})
    
    tree = {}
    prompts = {}
    try:
        for root, dirs, files in os.walk(path):
            # 目录排序，保证前端树顺序稳定
            dirs.sort()
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
                    if os.path.getsize(txt_path) > 0:
                        with_prompt.append(f)
                except OSError:
                    pass
            if with_prompt:
                prompts[safe_rel_path] = sorted(with_prompt)
    except Exception as e:
        return web.json_response({"error": str(e), "tree": {}, "prompts": {}})

    return web.json_response({"tree": tree, "prompts": prompts, "error": None})

@PromptServer.instance.routes.get("/geniusewzq/view_image")
async def view_image(request):
    img_path = request.query.get("path", "")
    if os.path.exists(img_path):
        return web.FileResponse(img_path)
    return web.Response(status=404)

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
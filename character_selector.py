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
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("IMAGE", "FILE_PATH")
    FUNCTION = "load_image"
    CATEGORY = "geniusewzq_tools"

    def load_image(self, base_directory, image_path):
        if not image_path or not os.path.exists(image_path):
            return (torch.zeros([1, 64, 64, 3]), "")
        try:
            img = Image.open(image_path).convert("RGB")
            img_np = np.array(img).astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(img_np)[None,]
            return (img_tensor, image_path)
        except Exception:
            return (torch.zeros([1, 64, 64, 3]), "")

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
    try:
        for root, dirs, files in os.walk(path):
            # ✅ 正确写法：使用 os.path.relpath
            rel_path = os.path.relpath(root, path)
            images = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
            if images:
                # 统一为正斜杠，方便前端处理
                safe_rel_path = rel_path.replace("\\", "/")
                tree[safe_rel_path] = sorted(images)
    except Exception as e:
        return web.json_response({"error": str(e), "tree": {}})
            
    return web.json_response({"tree": tree, "error": None})

@PromptServer.instance.routes.get("/geniusewzq/view_image")
async def view_image(request):
    img_path = request.query.get("path", "")
    if os.path.exists(img_path):
        return web.FileResponse(img_path)
    return web.Response(status=404)
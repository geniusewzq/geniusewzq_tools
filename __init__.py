import os
import subprocess
import sys
from aiohttp import web
from server import PromptServer
from .aspect_ratio_switcher import AspectRatioSwitcher
from .webp_bridge import WebpLongVideoBridgeFinal 
from .character_selector import VisualCharacterSelector

# --- 自动处理 send2trash 依赖 ---
def install_send2trash():
    try:
        import send2trash
    except ImportError:
        print("VisualBrowser: 正在安装删除功能所需的依赖 send2trash...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "send2trash"])

install_send2trash()
import send2trash

# --- 注册删除图片后端路由 ---
@PromptServer.instance.routes.post("/geniusewzq/delete_image")
async def delete_image(request):
    try:
        data = await request.json()
        file_path = data.get("path")

        if not file_path:
            return web.json_response({"success": False, "error": "未提供文件路径"})
        
        # 将路径转为绝对路径并检查是否存在
        full_path = os.path.abspath(file_path)
        
        if os.path.exists(full_path):
            # 使用 send2trash 将文件移至回收站
            send2trash.send2trash(full_path)
            print(f"VisualBrowser: 已将文件移至回收站: {full_path}")
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": f"文件不存在: {full_path}"})

    except Exception as e:
        print(f"VisualBrowser 删除出错: {str(e)}")
        return web.json_response({"success": False, "error": str(e)})

# --- 原有的节点映射 ---
NODE_CLASS_MAPPINGS = {
    "AspectRatioSwitcher": AspectRatioSwitcher,
    "WebpLongVideoBridgeFinal": WebpLongVideoBridgeFinal,
    "VisualCharacterSelector": VisualCharacterSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AspectRatioSwitcher": "比例切换器",
    "WebpLongVideoBridgeFinal": "截取关键帧",
    "VisualCharacterSelector": "视觉资源库选择器", 
}

# ！！！极其重要：必须指定这个目录，前端 JS 才会生效
WEB_DIRECTORY = "./web"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
import os
import shutil
import time
from aiohttp import web
from server import PromptServer
from .aspect_ratio_switcher import AspectRatioSwitcher
from .aspect_ratio_switcher_pro import AspectRatioSwitcherPro
from .webp_bridge import WebpLongVideoBridgeFinal 
from .character_selector import VisualCharacterSelector
from .dynamic_node import DynamicPromptChain
from .fast_groups import FastGroupsBypasser

# --- 删除图片后端路由 ---
# 删除不再直接进系统回收站，而是移到当前文件夹下的 .gswq_trash（画廊会跳过隐藏目录），
# 这样前端能做“5 秒内撤销”，撤销就是把文件移回原位。
TRASH_DIR_NAME = ".gswq_trash"
TRASH_KEEP_SECONDS = 7 * 24 * 3600  # 回收站里的东西超过 7 天自动清掉


def _trash_dir_for(file_path):
    return os.path.join(os.path.dirname(os.path.abspath(file_path)), TRASH_DIR_NAME)


def _purge_old_trash(trash_dir):
    try:
        now = time.time()
        for name in os.listdir(trash_dir):
            item = os.path.join(trash_dir, name)
            try:
                if os.path.isfile(item) and now - os.path.getmtime(item) > TRASH_KEEP_SECONDS:
                    os.remove(item)
            except OSError:
                pass
    except OSError:
        pass


@PromptServer.instance.routes.post("/geniusewzq/delete_image")
async def delete_image(request):
    try:
        data = await request.json()
        file_path = data.get("path")
        if not file_path:
            return web.json_response({"success": False, "error": "未提供文件路径"})

        full_path = os.path.abspath(file_path)
        if not os.path.exists(full_path):
            return web.json_response({"success": False, "error": f"文件不存在: {full_path}"})

        trash_dir = _trash_dir_for(full_path)
        os.makedirs(trash_dir, exist_ok=True)
        _purge_old_trash(trash_dir)

        stamp = time.strftime("%Y%m%d_%H%M%S") + "_" + str(int(time.time() * 1000) % 1000)
        moved = []
        # 图片本体 + 同名 txt 一起进回收站，撤销时一起回来
        for src in [full_path, os.path.splitext(full_path)[0] + ".txt"]:
            if not os.path.exists(src):
                continue
            dst = os.path.join(trash_dir, f"{stamp}_{os.path.basename(src)}")
            shutil.move(src, dst)
            moved.append({"trash": dst, "original": src})

        print(f"VisualBrowser: 已删除（可从回收站撤销）: {full_path}")
        return web.json_response({"success": True, "items": moved})
    except Exception as e:
        print(f"VisualBrowser 删除出错: {str(e)}")
        return web.json_response({"success": False, "error": str(e)})


@PromptServer.instance.routes.post("/geniusewzq/restore_image")
async def restore_image(request):
    try:
        data = await request.json()
        items = data.get("items") or []
        restored = []
        for item in items:
            trash_path = item.get("trash")
            original = item.get("original")
            if not trash_path or not original or not os.path.exists(trash_path):
                continue
            os.makedirs(os.path.dirname(original), exist_ok=True)
            if os.path.exists(original):
                continue  # 原位已有同名文件，不覆盖
            shutil.move(trash_path, original)
            restored.append(original)
        return web.json_response({"success": True, "restored": restored})
    except Exception as e:
        print(f"VisualBrowser 撤销删除出错: {str(e)}")
        return web.json_response({"success": False, "error": str(e)})


# --- 原有的节点映射 ---
NODE_CLASS_MAPPINGS = {
    "AspectRatioSwitcher": AspectRatioSwitcher,
    "AspectRatioSwitcherPro": AspectRatioSwitcherPro,
    "WebpLongVideoBridgeFinal": WebpLongVideoBridgeFinal,
    "VisualCharacterSelector": VisualCharacterSelector,
    "DynamicPromptChain": DynamicPromptChain,
    "FastGroupsBypasser": FastGroupsBypasser,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AspectRatioSwitcher": "比例切换器",
    "AspectRatioSwitcherPro": "比例切换器 Pro",
    "WebpLongVideoBridgeFinal": "截取关键帧",
    "VisualCharacterSelector": "视觉资源库选择器",
    "DynamicPromptChain": "动态提示词链",
    "FastGroupsBypasser": "快速分组开关",
}

# ！！！极其重要：必须指定这个目录，前端 JS 才会生效
WEB_DIRECTORY = "./web"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']

# 版本标记：ComfyUI 启动日志中看到此行即确认加载的是最后一版
print("[geniusewzq_tools] v1.8.8 已加载：6 个节点（视觉资源库选择器/比例切换器/比例切换器 Pro/截取关键帧/动态提示词链/快速分组开关）")















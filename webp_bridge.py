import os
import torch
import numpy as np
from PIL import Image, ImageSequence

class WebpLongVideoBridgeFinal:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "文件夹路径": ("STRING", {"default": "D:/Output/MyVideo"}),
                "提取第几帧": ("INT", {"default": 81, "min": 1, "max": 10000, "step": 1}),
                "运行模式": (["自动续画_读取上个视频", "手动模式_仅首轮使用"],),
            },
            "optional": {
                "手动初始首帧": ("IMAGE",), 
                "新视频尾帧": ("IMAGE",),   
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("本段起始帧", "本段结束帧", "运行状态")
    FUNCTION = "execute_bridge"
    CATEGORY = "geniusewzq_tools"

    def execute_bridge(self, 文件夹路径, 提取第几帧, 运行模式, 手动初始首帧=None, 新视频尾帧=None):
        # 路径纠错
        clean_path = 文件夹路径.strip().replace("\\", "/")
        final_path = os.path.normpath(clean_path)

        if 运行模式 == "手动模式_仅首轮使用":
            return (手动初始首帧, 新视频尾帧, "【手动模式】使用输入的起始图片")

        if not os.path.exists(final_path):
            return (手动初始首帧, 新视频尾帧, f"【错误】找不到路径: {final_path}")

        try:
            files = [f for f in os.listdir(final_path) if f.lower().endswith('.webp')]
        except Exception as e:
            return (手动初始首帧, 新视频尾帧, f"【权限错误】: {str(e)}")

        if not files:
            return (手动初始首帧, 新视频尾帧, "【提示】文件夹为空，请先用手动模式生成第一个片段")

        # 按修改时间排序
        files.sort(key=lambda x: os.path.getmtime(os.path.join(final_path, x)))
        latest_file = files[-1]
        file_path = os.path.join(final_path, latest_file)

        try:
            with Image.open(file_path) as img:
                frames = [f.copy() for f in ImageSequence.Iterator(img)]
                total = len(frames)
                idx = max(0, min(提取第几帧 - 1, total - 1))
                selected = frames[idx].convert("RGB")
                frame_np = np.array(selected).astype(np.float32) / 255.0
                start_frame_tensor = torch.from_numpy(frame_np).unsqueeze(0)
                
                status = f"成功！已从 [{latest_file}] 提取第 {idx+1} 帧"
                return (start_frame_tensor, 新视频尾帧, status)
        except Exception as e:
            return (手动初始首帧, 新视频尾帧, f"【读取失败】: {str(e)}")
from .video_last_frame import VideoLastFrame
from .load_last_output import LoadLastOutput
from .aspect_ratio_switcher import AspectRatioSwitcher

NODE_CLASS_MAPPINGS = {
    "VideoLastFrame": VideoLastFrame,
    "LoadLastOutput": LoadLastOutput,
    "AspectRatioSwitcher": AspectRatioSwitcher,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VideoLastFrame": "提取最后一帧",
    "LoadLastOutput": "加载最后输出",
    "AspectRatioSwitcher": "长宽比切换器",
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
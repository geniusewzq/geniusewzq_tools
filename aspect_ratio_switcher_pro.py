# -*- coding: utf-8 -*-
"""比例切换器 Pro —— 融合「比例切换器」+「分辨率选择器」

设计定稿见桌面《融合节点模拟.html》（决策 1~10），本文件严格执行：
  决策1  新增独立节点，旧「比例切换器」原样保留
  决策2  空 Latent 写死 16 通道（Flux2 口径），不提供通道选项
  决策3  宽高比 = 内置 8 种（下拉菜单）
  决策4  取整 = 就近取整（四舍五入到最近的「倍数」，非向下取整）
  决策5  节点显示名「比例切换器 Pro」
  决策6  无 batch_size（固定 1 张；多张用下游 Latent 重复节点）
  决策7  控件名/选项/输出口全部中文
  决策8  只输出 Latent（2026-10-06 用户决定：移除「真实宽/真实高」两个 INT 输出口
         及行内显示标签）；透传 +「对调宽高」= 真实转置输入 Latent
  决策9  「Latent来源」控件置顶；未连输入锁定为自建；连入自动开启（前端驱动）；
         后端兜底：开关开着但输入为空 → 自动按自建处理，不报错
  决策10 「尺寸模式」= 开关（开=手动自定义）；「宽高比」= 下拉菜单
"""

import math
import torch

# 宽高比选项（决策 3）：显示名, 宽比, 高比
RATIO_OPTIONS = [
    ("1:1 方形", 1, 1),
    ("2:3 竖版照片", 2, 3),
    ("3:2 横版照片", 3, 2),
    ("3:4 竖版标准", 3, 4),
    ("4:3 标准", 4, 3),
    ("9:16 竖屏", 9, 16),
    ("16:9 宽屏", 16, 9),
    ("21:9 超宽", 21, 9),
]

# 尺寸上限：与百万像素 16MP 量级匹配，防止 API 调用传入离谱值
MAX_SIDE = 16384


class AspectRatioSwitcherPro:
    """按 百万像素+宽高比+倍数 计算尺寸并生成空 Latent；或透传输入 Latent（可真实转置）"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 决策 9：置顶第一行；默认自建；连入输入后由前端自动开启
                "Latent来源": ("BOOLEAN", {
                    "default": False,
                    "label_on": "使用输入Latent",
                    "label_off": "节点自建空白Latent",
                }),
                # 决策 10：开关形态。开 = 手动自定义，关 = 百万像素比例
                "尺寸模式": ("BOOLEAN", {
                    "default": False,
                    "label_on": "手动自定义",
                    "label_off": "百万像素比例",
                }),
                # 决策 10：下拉菜单形态
                "宽高比": ([name for name, _, _ in RATIO_OPTIONS], {"default": "16:9 宽屏"}),
                "百万像素": ("FLOAT", {"default": 4.0, "min": 0.1, "max": 16.0, "step": 0.1}),
                "倍数": ("INT", {"default": 32, "min": 8, "max": 128, "step": 8}),
                "自定义宽度": ("INT", {"default": 1024, "min": 64, "max": MAX_SIDE, "step": 8}),
                "自定义高度": ("INT", {"default": 1024, "min": 64, "max": MAX_SIDE, "step": 8}),
                "输出方向": ("BOOLEAN", {
                    "default": False,
                    "label_on": "对调宽高",
                    "label_off": "默认方向",
                }),
            },
            "optional": {
                # 可选输入：不连线也能跑（自建模式）——ComfyUI 原生支持
                "Latent": ("LATENT",),
            },
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("Latent",)
    FUNCTION = "switch"
    CATEGORY = "geniusewzq_tools"
    DESCRIPTION = "比例切换器 Pro：百万像素+宽高比+倍数 一步算出尺寸并生成 Flux2 口径 16 通道空 Latent；或透传输入 Latent（对调宽高会真实转置）。"

    def switch(self, **kwargs):
        latent_source = bool(kwargs.get("Latent来源", False))
        size_mode = bool(kwargs.get("尺寸模式", False))
        ratio_name = kwargs.get("宽高比", "16:9 宽屏")
        megapixels = float(kwargs.get("百万像素", 4.0))
        multiple = int(kwargs.get("倍数", 32))
        custom_w = int(kwargs.get("自定义宽度", 1024))
        custom_h = int(kwargs.get("自定义高度", 1024))
        swap = bool(kwargs.get("输出方向", False))
        input_latent = kwargs.get("Latent", None)

        # ---------- 透传模式（决策 8/9） ----------
        if latent_source and input_latent is not None:
            samples = input_latent["samples"]
            if swap:
                # 真实转置：画面横竖对调
                samples = torch.transpose(samples, -2, -1).contiguous()
            return ({"samples": samples},)

        # ---------- 自建空白 Latent ----------
        # 兜底（决策 9）：透传开着但输入为空（断链等边缘情况）→ 自动落到这里，不报错

        # 「倍数」防御：至少 8（Latent 尺寸 = 像素 ÷8 的底线）
        multiple = max(8, multiple)

        if size_mode:
            # 手动自定义：就近取整到「倍数」（决策 4）
            w = round(custom_w / multiple) * multiple
            h = round(custom_h / multiple) * multiple
        else:
            # 百万像素比例：与 ComfyUI 内置分辨率选择器同口径
            rw = rh = None
            for name, r_w, r_h in RATIO_OPTIONS:
                if name == ratio_name:
                    rw, rh = r_w, r_h
                    break
            if rw is None:
                rw, rh = 16, 9
            total = megapixels * 1024 * 1024
            scale = math.sqrt(total / float(rw * rh))
            w = round(rw * scale / multiple) * multiple
            h = round(rh * scale / multiple) * multiple

        # 边界保护
        w = max(multiple, min(MAX_SIDE, w))
        h = max(multiple, min(MAX_SIDE, h))

        # 对调宽高（决策 8）：交换的是两个已各自对齐的数，结果依然对齐
        if swap:
            w, h = h, w

        # 决策 2：写死 16 通道；决策 6：固定 1 张
        latent = torch.zeros([1, 16, h // 8, w // 8])
        return ({"samples": latent},)

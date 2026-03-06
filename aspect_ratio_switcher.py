import torch

class AspectRatioSwitcher:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "use_default_size": ("BOOLEAN", {"default": True, "label_on": "预设尺寸", "label_off": "自定义"}),
                "model_type": (
                    ["Flux2-klein", "Qwen-Image-Edit-2512", "Z-ImageTurbo", "WAN 2.1", "WAN 2.2"],
                    {"default": "Flux2-klein", "label": "模型类型"}
                ),
                "use_input_latent": ("BOOLEAN", {"default": False, "label_on": "使用外部输入", "label_off": "使用自建空Latent"}),
            },
            "optional": {
                "default_size": ([
                    # ===== 图像生成/编辑模型 =====
                    # Flux2-klein（官方原生最优）
                    "Flux2-klein 1:1 原生最优 (1024x1024)",
                    # Qwen-Image-Edit-2512（官方全比例原生16倍数）
                    "Qwen-Edit 1:1 原生训练 (1328x1328)",
                    "Qwen-Edit 1:1 平衡最优 (1024x1024)",
                    "Qwen-Edit 16:9 原生 (1664x928)",
                    "Qwen-Edit 9:16 原生 (928x1664)",
                    "Qwen-Edit 4:3 原生 (1472x1104)",
                    "Qwen-Edit 3:4 原生 (1104x1472)",
                    # Z-ImageTurbo（官方64倍数规范）
                    "Z-ImageTurbo 1:1 标准 (1024x1024)",
                    "Z-ImageTurbo 16:9 横屏 (1024x576)",
                    "Z-ImageTurbo 9:16 竖屏 (576x1024)",
                    "Z-ImageTurbo 1:1 最大原生 (2048x2048)",
                    # ===== 视频生成模型 =====
                    # WAN 2.1（官方480P/720P档位）
                    "WAN 2.1 14B 720P (1280x720)",
                    "WAN 2.1 1.3B 480P (640x480)",
                    "WAN 2.1 16:9 480P (832x480)",
                    # WAN 2.2（官方预设64倍数档位）
                    "WAN 2.2 1:1 快速测试 (512x512)",
                    "WAN 2.2 16:9 默认最优 (768x432)",
                    "WAN 2.2 16:9 高清 (1024x576)",
                    "WAN 2.2 9:16 竖屏1080P (1080x1920)",
                ], {"default": "Flux2-klein 1:1 原生最优 (1024x1024)"}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "switch_orientation": ("BOOLEAN", {"default": False, "label_on": "对调宽高", "label_off": "默认宽高"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64}),
                "samples": ("LATENT",), 
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    FUNCTION = "switch_aspect_ratio"
    CATEGORY = "geniusewzq_tools"

    def switch_aspect_ratio(self, use_default_size, model_type, use_input_latent, 
                            default_size="Flux2-klein 1:1 原生最优 (1024x1024)", 
                            custom_width=1024, custom_height=1024, 
                            switch_orientation=False, batch_size=1, samples=None):
        
        # 核心：各模型官方/原生分辨率映射表（严格按你提供的规范）
        preset_sizes = {
            # 1. Flux2-klein（Black Forest Labs）
            "Flux2-klein 1:1 原生最优 (1024x1024)": (1024, 1024),
            # 2. Qwen-Image-Edit-2512（阿里云/通义）
            "Qwen-Edit 1:1 原生训练 (1328x1328)": (1328, 1328),
            "Qwen-Edit 1:1 平衡最优 (1024x1024)": (1024, 1024),
            "Qwen-Edit 16:9 原生 (1664x928)": (1664, 928),
            "Qwen-Edit 9:16 原生 (928x1664)": (928, 1664),
            "Qwen-Edit 4:3 原生 (1472x1104)": (1472, 1104),
            "Qwen-Edit 3:4 原生 (1104x1472)": (1104, 1472),
            # 3. Z-ImageTurbo（通义-MAI）
            "Z-ImageTurbo 1:1 标准 (1024x1024)": (1024, 1024),
            "Z-ImageTurbo 16:9 横屏 (1024x576)": (1024, 576),
            "Z-ImageTurbo 9:16 竖屏 (576x1024)": (576, 1024),
            "Z-ImageTurbo 1:1 最大原生 (2048x2048)": (2048, 2048),
            # 4. WAN 2.1（阿里云/通义万相）
            "WAN 2.1 14B 720P (1280x720)": (1280, 720),
            "WAN 2.1 1.3B 480P (640x480)": (640, 480),
            "WAN 2.1 16:9 480P (832x480)": (832, 480),
            # 5. WAN 2.2（阿里云/通义万相）
            "WAN 2.2 1:1 快速测试 (512x512)": (512, 512),
            "WAN 2.2 16:9 默认最优 (768x432)": (768, 432),
            "WAN 2.2 16:9 高清 (1024x576)": (1024, 576),
            "WAN 2.2 9:16 竖屏1080P (1080x1920)": (1080, 1920),
        }

        # 1. 确定原始宽高（优先预设，其次自定义）
        if use_default_size:
            w, h = preset_sizes.get(default_size, (1024, 1024))
        else:
            # 自定义时强制适配模型的倍数要求
            if model_type == "Qwen-Image-Edit-2512":
                # Qwen要求16倍数
                w = (custom_width // 16) * 16
                h = (custom_height // 16) * 16
            elif model_type in ["Z-ImageTurbo", "WAN 2.1", "WAN 2.2"]:
                # Z-Turbo/WAN要求64倍数
                w = (custom_width // 64) * 64
                h = (custom_height // 64) * 64
            else:
                # Flux要求8倍数（基础）
                w = (custom_width // 8) * 8
                h = (custom_height // 8) * 8

        # 2. 宽高对调逻辑
        if switch_orientation:
            w, h = h, w

        # 3. 最终宽高（二次校验倍数，避免对调后违规）
        if model_type == "Qwen-Image-Edit-2512":
            final_width = (w // 16) * 16
            final_height = (h // 16) * 16
        elif model_type in ["Z-ImageTurbo", "WAN 2.1", "WAN 2.2"]:
            final_width = (w // 64) * 64
            final_height = (h // 64) * 64
        else:
            final_width = (w // 8) * 8
            final_height = (h // 8) * 8
        
        # 4. Latent生成（适配不同模型通道数）
        if use_input_latent and samples is not None:
            final_latent = samples
        else:
            # 通道数：Flux系列16通道，其余模型4通道
            channels = 16 if model_type == "Flux2-klein" else 4
            # Latent维度计算（像素尺寸/8）
            latent_w = final_width // 8
            latent_h = final_height // 8
            # 创建空Latent（全零Tensor）
            latent_batch = torch.zeros((batch_size, channels, latent_h, latent_w))
            final_latent = {"samples": latent_batch}

        return (final_width, final_height, final_latent)

NODE_CLASS_MAPPINGS = {
    "AspectRatioSwitcher": AspectRatioSwitcher
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AspectRatioSwitcher": "智能宽高比切换器 (官方分辨率规范版)"
}
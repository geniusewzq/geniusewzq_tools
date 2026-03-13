import torch

class AspectRatioSwitcher:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "size_mode": (["预设甜点位", "手动自定义"], {"default": "预设甜点位"}),
                "default_size": ([
                    "--- Flux2-klein (16ch / 16-align) ---",
                    "Flux 1:1 原生 (1024x1024)",
                    "Flux 4:3 经典 (1152x864)",
                    "Flux 3:2 摄影 (1216x832)",
                    "Flux 16:9 电影 (1360x768)",
                    "Flux 2.35:1 宽屏 (1536x640)",
                    "Flux 3:4 艺术 (864x1152)",
                    "Flux 2:3 人像 (832x1248)",
                    "Flux 9:16 竖屏 (768x1360)",

                    "--- Qwen-Edit-2512 (4ch / 16-align) ---",
                    "Qwen 1:1 官方最优 (1328x1328)",
                    "Qwen 1:1 平衡位 (1024x1024)",
                    "Qwen 4:3 原生 (1472x1104)",
                    "Qwen 3:2 摄影 (1584x1056)",
                    "Qwen 16:9 横屏 (1664x928)",
                    "Qwen 3:4 原生 (1104x1472)",
                    "Qwen 2:3 人像 (1056x1584)",
                    "Qwen 9:16 竖屏 (928x1664)",

                    "--- Z-ImageTurbo (4ch / 64-align) ---",
                    "Z-Turbo 1:1 标准 (1024x1024)",
                    "Z-Turbo 4:3 横屏 (1152x832)",
                    "Z-Turbo 16:9 横屏 (1344x768)",
                    "Z-Turbo 3:4 竖屏 (832x1152)",
                    "Z-Turbo 9:16 竖屏 (768x1344)",

                    "--- WAN 2.1/2.2 (4ch / 64-align) ---",
                    "WAN 1:1 预览 (1024x1024)",
                    "WAN 4:3 经典 (1024x768)",
                    "WAN 16:9 720P (1280x720)",
                    "WAN 3:4 竖屏 (768x1024)",
                    "WAN 9:16 720P (720x1280)",
                ], {"default": "Flux 1:1 原生 (1024x1024)"}),

                "model_type": (
                    ["Flux2-klein", "Qwen-Image-Edit-2512", "Z-ImageTurbo", "WAN 2.1", "WAN 2.2"],
                    {"default": "Flux2-klein", "label": "底层对齐模型"}
                ),
            },
            "optional": {
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "switch_orientation": ("BOOLEAN", {"default": False, "label_on": "对调宽高", "label_off": "默认方向"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64}),
                "use_input_latent": ("BOOLEAN", {"default": False, "label_on": "使用输入Samples", "label_off": "节点自建空Latent"}),
                "samples": ("LATENT",),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    FUNCTION = "switch_aspect_ratio"
    CATEGORY = "geniusewzq_tools"

    def switch_aspect_ratio(self, size_mode, default_size, model_type, 
                            custom_width=1024, custom_height=1024, 
                            switch_orientation=False, batch_size=1, 
                            use_input_latent=False, samples=None):
        
        # 预设映射表
        preset_sizes = {
            "Flux 1:1 原生 (1024x1024)": (1024, 1024),
            "Flux 4:3 经典 (1152x864)": (1152, 864),
            "Flux 3:2 摄影 (1216x832)": (1216, 832),
            "Flux 16:9 电影 (1360x768)": (1360, 768),
            "Flux 2.35:1 宽屏 (1536x640)": (1536, 640),
            "Flux 3:4 艺术 (864x1152)": (864, 1152),
            "Flux 2:3 人像 (832x1248)": (832, 1248),
            "Flux 9:16 竖屏 (768x1360)": (768, 1360),
            "Qwen 1:1 官方最优 (1328x1328)": (1328, 1328),
            "Qwen 1:1 平衡位 (1024x1024)": (1024, 1024),
            "Qwen 4:3 原生 (1472x1104)": (1472, 1104),
            "Qwen 3:2 摄影 (1584x1056)": (1584, 1056),
            "Qwen 16:9 横屏 (1664x928)": (1664, 928),
            "Qwen 3:4 原生 (1104x1472)": (1104, 1472),
            "Qwen 2:3 人像 (1056x1584)": (1056, 1584),
            "Qwen 9:16 竖屏 (928x1664)": (928, 1664),
            "Z-Turbo 1:1 标准 (1024x1024)": (1024, 1024),
            "Z-Turbo 4:3 横屏 (1152x832)": (1152, 832),
            "Z-Turbo 16:9 横屏 (1344x768)": (1344, 768),
            "Z-Turbo 3:4 竖屏 (832x1152)": (832, 1152),
            "Z-Turbo 9:16 竖屏 (768x1344)": (768, 1344),
            "WAN 1:1 预览 (1024x1024)": (1024, 1024),
            "WAN 4:3 经典 (1024x768)": (1024, 768),
            "WAN 16:9 720P (1280x720)": (1280, 720),
            "WAN 3:4 竖屏 (768x1024)": (768, 1024),
            "WAN 9:16 720P (720x1280)": (720, 1280),
        }

        # 1. 初始宽高处理
        if size_mode == "预设甜点位":
            # 增加防御性判断，防止选到分隔符
            if default_size.startswith("---") or default_size not in preset_sizes:
                w, h = 1024, 1024
            else:
                w, h = preset_sizes[default_size]
        else:
            w, h = custom_width, custom_height

        # 2. 方向对调
        if switch_orientation:
            w, h = h, w

        # 3. 核心对齐逻辑（由模型架构决定）
        # Z-Turbo/WAN 的 DiT 结构对 64 对齐极度敏感
        align_value = 64 if model_type in ["Z-ImageTurbo", "WAN 2.1", "WAN 2.2"] else 16
        final_width = (w // align_value) * align_value
        final_height = (h // align_value) * align_value
        
        # 4. Latent 输出处理
        if use_input_latent and samples is not None:
            final_latent = samples
        else:
            # Flux 16通道，其余4通道
            channels = 16 if model_type == "Flux2-klein" else 4
            # 常量：像素到潜空间的压缩倍率为 8
            VAE_SCALE = 8
            latent_batch = torch.zeros((batch_size, channels, final_height // VAE_SCALE, final_width // VAE_SCALE))
            final_latent = {"samples": latent_batch}

        return (final_width, final_height, final_latent)
class DynamicPromptChain:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # forceInput: 强制作为连接端口，不生成文本输入框(widget)，配合前端动态增减端口
                "input_1": ("STRING", {"forceInput": True}),
            },
            "optional": {
                # clip 可选输入：直通到输出，方便一次性连接到 CLIPTextEncode
                "clip": ("CLIP",),
            },
        }

    # 输出顺序：上方 clip，下方 text
    RETURN_TYPES = ("CLIP", "STRING")
    RETURN_NAMES = ("clip", "text")
    FUNCTION = "combine_prompts"
    CATEGORY = "geniusewzq_tools"

    def combine_prompts(self, input_1=None, clip=None, **kwargs):
        # 把 input_1 和动态添加的 input_* 合并
        all_inputs = {"input_1": input_1}
        all_inputs.update(kwargs)

        # 过滤空值和None并合并
        prompts = []
        for k in sorted(all_inputs.keys(), key=lambda x: int(x.split('_')[1])):
            val = all_inputs.get(k)
            if val is not None and str(val).strip():
                prompts.append(str(val).strip())

        # 返回：clip 直通 + 合并文本
        return (clip, ", ".join(prompts))

class DynamicPromptChain:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "input_1": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "combine_prompts"
    CATEGORY = "geniusewzq_tools" 

    def combine_prompts(self, **kwargs):
        # 提取并按序号排序：input_1, input_2...
        keys = sorted([k for k in kwargs.keys() if k.startswith("input_")], 
                      key=lambda x: int(x.split('_')[1]))
        
        # 过滤空值和None并合并
        prompts = []
        for k in keys:
            val = kwargs.get(k)
            if val is not None and str(val).strip():
                prompts.append(str(val).strip())
        
        return (", ".join(prompts),)
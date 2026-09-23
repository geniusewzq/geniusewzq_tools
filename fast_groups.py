class FastGroupsBypasser:
    @classmethod
    def INPUT_TYPES(s):
        # 这里返回空字典，彻底去掉 UI 上的 control_panel 输入框
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "geniusewzq_tools"
    OUTPUT_NODE = True

    def noop(self, **kwargs):
        return {}
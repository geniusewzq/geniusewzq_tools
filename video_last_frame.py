import torch

class VideoLastFrame:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_frames": ("IMAGE", {
                    "tooltip": "Input video frames (sequence of images)"
                }),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("last_frame",)
    FUNCTION = "extract_last_frame"
    CATEGORY = "geniusewzq_tools"

    def extract_last_frame(self, video_frames):
        """
        Extract the last frame from a sequence of video frames.
        
        Args:
            video_frames (torch.Tensor): Sequence of video frames with shape (batch_size, height, width, channels)
            
        Returns:
            tuple: (last_frame,) where last_frame is a tensor with shape (1, height, width, channels)
        """
        if video_frames is None:
            raise ValueError("Video frames are required")
        
        # Get the last frame from the frames tensor
        # video_frames shape: (batch_size, height, width, channels)
        # last_frame shape: (1, height, width, channels)
        last_frame = video_frames[-1:]
        
        return (last_frame,)

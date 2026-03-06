import os
import torch
from PIL import Image, ImageSequence
import numpy as np
import glob
import time

class LoadLastOutput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "output_dir": ("STRING", {
                    "default": "E:\\ComfyUI_windows_portable\\ComfyUI\\output",
                    "multiline": False,
                    "placeholder": "ComfyUI output directory",
                    "tooltip": "Directory where ComfyUI saves output files"
                }),
                "seed": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 1000000000,
                    "step": 1,
                    "tooltip": "Random seed for execution control"
                }),
            },
            "optional": {
                "file_type": (["auto", "gif", "webp", "png", "jpg", "jpeg", "bmp", "tiff", "mp4", "avi", "mov"], {
                    "default": "auto",
                    "label": "File Type",
                    "tooltip": "Type of file to load. 'auto' will load the most recent file."
                }),
                "sort_by": (["modified_time", "name"], {
                    "default": "modified_time",
                    "label": "Sort By",
                    "tooltip": "Sort files by modified time or name"
                }),
                "force_refresh": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Force re-scanning directory even if inputs are unchanged"
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("frames", "last_frame", "file_path")
    FUNCTION = "load_last_file"
    CATEGORY = "geniusewzq_tools"
    OUTPUT_NODE = False
    # 禁用缓存，每次都重新执行
    CACHE = False

    def load_last_file(self, output_dir, seed, file_type="auto", sort_by="modified_time", force_refresh=True):
        """
        Load the last output file from the specified directory.
        
        Args:
            output_dir (str): Directory to search for files
            seed (int): Random seed for execution control
            file_type (str): Type of file to load
            sort_by (str): Sort criterion
            force_refresh (bool): Whether to force re-scanning the directory
            
        Returns:
            tuple: (frames, last_frame, file_path) where frames is a tensor of video frames, 
                   last_frame is the last frame, and file_path is the loaded file path
        """
        # Seed is used to force ComfyUI to re-execute the node when the seed changes
        # Force refresh ensures we always get the latest file
        if force_refresh or seed != 0:
            # Use current timestamp to ensure fresh search
            # This helps bypass any potential caching mechanisms
            current_time = time.time()
        
        if not os.path.exists(output_dir):
            raise FileNotFoundError(f"Output directory not found: {output_dir}")
        
        # Clear any possible system cache by statting the directory first
        os.stat(output_dir)
        
        # Define supported formats
        image_formats = ["png", "jpg", "jpeg", "bmp", "tiff", "webp", "gif"]
        video_formats = ["mp4", "avi", "mov"]
        
        # Determine which formats to search for
        if file_type == "auto":
            formats_to_search = image_formats + video_formats
        elif file_type in ["jpg", "jpeg"]:
            formats_to_search = ["jpg", "jpeg"]
        elif file_type in video_formats:
            formats_to_search = [file_type]
        else:
            formats_to_search = [file_type]
        
        # Get all matching files with fresh search (multiple attempts for reliability)
        all_files = []
        max_attempts = 3
        
        for attempt in range(max_attempts):
            # Small delay between attempts to ensure filesystem updates
            if attempt > 0:
                time.sleep(0.1)
            
            current_files = []
            for fmt in formats_to_search:
                # Construct pattern each time for fresh search
                pattern = os.path.join(output_dir, f"*.{fmt}")
                # Use recursive glob and fresh search
                found = glob.glob(pattern)
                current_files.extend([os.path.abspath(f) for f in found])
            
            # Only keep existing files (filter out deleted ones)
            current_files = [f for f in current_files if os.path.exists(f)]
            
            # If we found files, use them
            if current_files:
                all_files = current_files
                break
        
        if not all_files:
            raise FileNotFoundError(f"No {file_type} files found in {output_dir} after {max_attempts} attempts")
        
        # Sort files with fresh metadata
        if sort_by == "modified_time":
            # Re-check mtime for each file to ensure we get the latest
            all_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        else:  # name
            all_files.sort(reverse=True)
        
        # Get the most recent file
        last_file = all_files[0]
        
        # Load the file based on its type
        file_ext = os.path.splitext(last_file)[1].lower()
        
        if file_ext in [".gif", ".webp"]:
            # Check if it's an animated image
            try:
                with Image.open(last_file) as im:
                    # Check if it's animated (has multiple frames)
                    if getattr(im, "is_animated", False):
                        frames, file_path = self._load_animated_image(last_file)
                        # Get the last frame from the frames tensor
                        last_frame = frames[-1:]
                        return (frames, last_frame, file_path)
                    else:
                        # Treat as static image
                        frames, file_path = self._load_static_image(last_file)
                        return (frames, frames, file_path)  # Same for static image
            except Exception as e:
                # Fallback to static image if animation check fails
                frames, file_path = self._load_static_image(last_file)
                return (frames, frames, file_path)
        elif file_ext in [".png", ".jpg", ".jpeg", ".bmp", ".tiff"]:
            # Load static image
            frames, file_path = self._load_static_image(last_file)
            return (frames, frames, file_path)  # Same frame for both outputs
        elif file_ext in [".mp4", ".avi", ".mov"]:
            # For video files, we'll need to extract frames
            # This is a placeholder - in actual implementation, you'd use ffmpeg to extract frames
            raise NotImplementedError("Video file loading is not implemented yet. Please use images (PNG/JPG/GIF/WEBP) for now.")
        else:
            raise ValueError(f"Unsupported file type: {file_ext}")
    
    def _load_animated_image(self, file_path):
        """
        Load an animated image file and convert it to a tensor of frames.
        
        Args:
            file_path (str): Path to the animated image file
            
        Returns:
            tuple: (frames_tensor, file_path)
        """
        frames = []
        
        with Image.open(file_path) as im:
            for frame in ImageSequence.Iterator(im):
                # Convert to RGB
                if frame.mode != 'RGB':
                    frame = frame.convert('RGB')
                
                # Convert to numpy array and normalize
                frame_np = np.array(frame).astype(np.float32) / 255.0
                frames.append(frame_np)
        
        if not frames:
            raise ValueError(f"No frames found in {file_path}")
        
        # Convert to tensor with shape (batch_size, height, width, channels)
        frames_tensor = torch.from_numpy(np.stack(frames))
        
        return (frames_tensor, file_path)
    
    def _load_static_image(self, file_path):
        """
        Load a static image file and convert it to a tensor with a single frame.
        
        Args:
            file_path (str): Path to the static image file
            
        Returns:
            tuple: (frames_tensor, file_path) where frames_tensor has shape (1, height, width, channels)
        """
        # Open the image file
        with Image.open(file_path) as im:
            # Convert to RGB
            if im.mode != 'RGB':
                im = im.convert('RGB')
            
            # Convert to numpy array and normalize
            frame_np = np.array(im).astype(np.float32) / 255.0
            
            # Add batch dimension to make it compatible with video frames
            # Shape: (1, height, width, channels)
            frame_np = np.expand_dims(frame_np, axis=0)
            
            # Convert to tensor
            frames_tensor = torch.from_numpy(frame_np)
        
        return (frames_tensor, file_path)

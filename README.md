# geniusewzq_tools - ComfyUI 工具节点集

一个为 ComfyUI 提供实用工具节点的集合，包含视频处理、文件加载和宽高比管理等功能。

## 节点列表

### 1. 提取最后一帧 (VideoLastFrame)

从视频帧序列中提取最后一帧，输出为标准的 ComfyUI 图像张量格式。

#### 输入
- `video_frames` (IMAGE): 输入的视频帧序列（图像序列）

#### 输出
- `last_frame` (IMAGE): 视频的最后一帧，格式为 (1, height, width, channels)

#### 功能特点
- 简单高效地提取视频序列的最后一帧
- 输出格式与 ComfyUI 标准图像张量完全兼容
- 适用于需要处理视频帧序列的工作流

### 2. 加载最后输出 (LoadLastOutput)

加载 ComfyUI 输出目录中的最新文件，支持多种文件格式，包括静态图像、动图和视频。

#### 输入
- `output_dir` (STRING): ComfyUI 输出目录路径（默认：E:\ComfyUI_windows_portable\ComfyUI\output）
- `seed` (INT): 执行控制的随机种子
- `file_type` (可选): 文件类型选择，支持 "auto"、"gif"、"webp"、"png"、"jpg"、"jpeg"、"bmp"、"tiff"、"mp4"、"avi"、"mov"
- `sort_by` (可选): 文件排序方式，支持 "modified_time"（修改时间）或 "name"（文件名）
- `force_refresh` (可选): 强制刷新目录扫描，即使输入未更改

#### 输出
- `frames` (IMAGE): 加载的帧序列（对于动图）或单帧（对于静态图像）
- `last_frame` (IMAGE): 最后一帧（对于动图）或与 frames 相同（对于静态图像）
- `file_path` (STRING): 加载的文件路径

#### 功能特点
- 自动检测并加载目录中的最新文件
- 支持多种图像格式，包括静态图像和动图
- 智能处理不同类型的文件，返回统一的输出格式
- 可配置的排序和刷新选项

### 3. 智能宽高比切换器 (AspectRatioSwitcher)

根据不同模型的官方分辨率规范，智能切换宽高比并生成相应的 Latent 张量。

#### 输入
- `use_default_size` (BOOLEAN): 是否使用预设尺寸（预设尺寸/自定义）
- `model_type` (选项): 模型类型，支持 "Flux2-klein"、"Qwen-Image-Edit-2512"、"Z-ImageTurbo"、"WAN 2.1"、"WAN 2.2"
- `use_input_latent` (BOOLEAN): 是否使用外部输入的 Latent（使用外部输入/使用自建空 Latent）
- `default_size` (可选): 预设尺寸选项，包含各种模型的官方推荐分辨率
- `custom_width` (可选): 自定义宽度（默认：1024，范围：64-8192，步长：8）
- `custom_height` (可选): 自定义高度（默认：1024，范围：64-8192，步长：8）
- `switch_orientation` (可选): 是否对调宽高（对调宽高/默认宽高）
- `batch_size` (可选): 批处理大小（默认：1，范围：1-64）
- `samples` (可选): 外部输入的 Latent 张量

#### 输出
- `width` (INT): 最终宽度
- `height` (INT): 最终高度
- `latent` (LATENT): 生成的 Latent 张量

#### 功能特点
- 内置多种模型的官方分辨率规范
- 自动适配不同模型的分辨率倍数要求（如 8x、16x、64x）
- 支持宽高对调功能
- 可选择使用外部输入的 Latent 或生成新的空 Latent
- 为 Flux 系列模型自动使用 16 通道，其他模型使用 4 通道

## 安装方法

1. 将 `geniusewzq_tools` 文件夹复制到你的 ComfyUI `custom_nodes` 目录
2. 安装依赖项：
   ```bash
   pip install -r requirements.txt
   ```
3. 重启 ComfyUI
4. 所有节点将出现在 "geniusewzq_tools" 分类中

## 依赖项

- Pillow (用于图像处理)
- torch (PyTorch，ComfyUI 内置)
- numpy (用于图像转换，ComfyUI 内置)

## 使用示例

### 示例 1: 提取视频最后一帧

```
视频帧序列 → 提取最后一帧 → 图像显示
```

### 示例 2: 加载最新输出文件

```
加载最后输出 → 图像显示
```

### 示例 3: 使用智能宽高比切换器

```
智能宽高比切换器 → KSampler → VAE Decode → 图像显示
```

## 节点分类

所有节点都位于 "geniusewzq_tools" 分类下，方便快速找到和使用。

## 注意事项

- 对于 `LoadLastOutput` 节点，目前仅支持图像文件（PNG/JPG/GIF/WEBP），视频文件加载功能正在开发中
- 对于 `AspectRatioSwitcher` 节点，不同模型有不同的分辨率倍数要求，请确保选择合适的模型类型
- 使用绝对路径可以避免文件路径相关的问题

## 故障排除

- **文件未找到**: 检查文件路径是否正确且可访问
- **图像加载错误**: 确保图像文件有效且未损坏
- **宽高比问题**: 确保选择了与模型匹配的分辨率设置

## 许可证

MIT
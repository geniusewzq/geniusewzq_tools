# Geniusewzq Tools - ComfyUI 自定义节点集

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-Custom%20Nodes-blue)](https://github.com/comfyanonymous/ComfyUI)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)

一套专为 ComfyUI 设计的实用工具节点集合，专注于模型分辨率管理、视频帧提取和资源库可视化浏览。

---

## 📋 目录

- [功能特性](#-功能特性)
- [环境要求](#-环境要求)
- [安装指南](#-安装指南)
- [节点详解](#-节点详解)
- [使用教程](#-使用教程)
- [常见问题](#-常见问题)
- [更新日志](#-更新日志)

---

## ✨ 功能特性

- 📐 **分辨率管理** - 内置多模型官方分辨率规范，一键切换
- 🔄 **视频帧提取** - WebP 格式长视频分段生成桥接工具
- 🖼️ **视觉资源库** - 可视化图片浏览器，支持文件夹管理和图片选择
- ⚡ **智能适配** - 自动适配不同模型的分辨率倍数要求

---

## 🔧 环境要求

### 必需环境

| 软件 | 版本要求 | 说明 |
|------|---------|------|
| **Python** | >= 3.8 | ComfyUI 运行所需 |
| **ComfyUI** | 最新版 | 主程序 |
| **PyTorch** | >= 1.12 | 深度学习框架（ComfyUI 已内置） |

### 系统要求

- **操作系统**: Windows 10/11, Linux, macOS
- **内存**: 建议 8GB 以上
- **显存**: 根据使用的 AI 模型而定（建议 8GB+）

---

## 📦 安装指南

### 前置条件

确保你已经安装并正常运行 ComfyUI。如果还没有安装，请参考 [ComfyUI 官方安装指南](https://github.com/comfyanonymous/ComfyUI#installing)。

### 方法一：手动安装

1. **下载本仓库**
   ```bash
   # 使用 git 克隆（推荐）
   cd ComfyUI/custom_nodes
   git clone https://github.com/yourusername/geniusewzq_tools.git
   
   # 或者手动下载 ZIP 文件并解压到 custom_nodes 目录
   ```

2. **安装 Python 依赖**
   
   打开终端/命令提示符，执行：
   ```bash
   cd ComfyUI/custom_nodes/geniusewzq_tools
   
   # 使用 pip 安装依赖
   pip install -r requirements.txt
   
   # 或者使用 ComfyUI 的 Python 环境
   # Windows 示例：
   ..\..\python_embeded\python.exe -m pip install -r requirements.txt
   ```

3. **验证安装**
   
   检查文件结构是否正确：
   ```
   ComfyUI/
   └── custom_nodes/
       └── geniusewzq_tools/
           ├── __init__.py
           ├── aspect_ratio_switcher.py
           ├── webp_bridge.py
           ├── character_selector.py
           ├── requirements.txt
           ├── web/
           │   └── js/
           │       └── visual_browser.js
           └── README.md
   ```

4. **重启 ComfyUI**
   
   完全关闭 ComfyUI 后重新启动，节点将自动加载。

### 方法二：ComfyUI-Manager 安装（如可用）

如果你安装了 [ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager)：

1. 在 ComfyUI 界面中打开 Manager
2. 选择 "Install Custom Nodes"
3. 搜索 "geniusewzq_tools"
4. 点击安装并重启

### 依赖项说明

本节点集依赖以下 Python 包：

| 包名 | 用途 | 安装命令 |
|------|------|---------|
| **Pillow** | 图像处理（WebP 读取、格式转换） | `pip install Pillow` |
| **numpy** | 数值计算（张量操作） | `pip install numpy` |
| **send2trash** | 安全删除文件（移至回收站） | `pip install send2trash` |
| **aiohttp** | HTTP 服务器（ComfyUI 已内置） | - |

**注意**：
- `torch` 和 `torchvision` 由 ComfyUI 提供，无需单独安装
- `send2trash` 会在首次启动时自动安装
- 如果遇到权限问题，请在命令前加 `sudo`（Linux/macOS）或以管理员身份运行（Windows）

### 故障排除

#### 问题 1: `ModuleNotFoundError: No module named 'PIL'`

**解决方案**：
```bash
pip install Pillow --upgrade
```

#### 问题 2: `ImportError: cannot import name 'ImageSequence'`

**解决方案**：
```bash
# 升级 Pillow 到最新版
pip install Pillow --upgrade
```

#### 问题 3: 节点显示红色或无法加载

**排查步骤**：
1. 检查 ComfyUI 启动日志中的错误信息
2. 确认 `requirements.txt` 中的依赖都已安装：
   ```bash
   pip list | findstr Pillow
   pip list | findstr numpy
   pip list | findstr send2trash
   ```
3. 尝试重新安装依赖：
   ```bash
   pip install -r requirements.txt --force-reinstall
   ```

#### 问题 4: WebP 文件无法读取

**解决方案**：
```bash
# 确保 Pillow 支持 WebP 格式
pip install Pillow --upgrade

# 在 Python 中验证
python -c "from PIL import Image; print(Image.registered_extensions())"
# 应该能看到 '.webp' 在列表中
```

---

## 🔧 节点详解

### 1. 比例切换器 (AspectRatioSwitcher)

根据不同 AI 模型的官方分辨率规范，智能生成 Latent 张量。

#### 支持的模型

| 模型 | 分辨率倍数 | 预设选项 |
|------|-----------|---------|
| **Flux2-klein** | 16x | 1:1 原生 (1024×1024)、4:3 经典 (1152×864)、16:9 电影 (1360×768) 等 |
| **Qwen-Image-Edit-2512** | 16x | 1:1 官方最优 (1328×1328)、1:1 平衡位 (1024×1024)、16:9 横屏 (1664×928) 等 |
| **Z-ImageTurbo** | 64x | 1:1 标准 (1024×1024)、16:9 横屏 (1344×768)、9:16 竖屏 (768×1344) 等 |
| **WAN 2.1/2.2** | 64x | 1:1 预览 (1024×1024)、16:9 720P (1280×720)、9:16 720P (720×1280) 等 |

#### 输入参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `size_mode` | 枚举 | `预设甜点位` | 预设尺寸 / 手动自定义 |
| `default_size` | 枚举 | - | 预设分辨率选项 |
| `model_type` | 枚举 | `Flux2-klein` | 选择 AI 模型类型 |
| `custom_width` | INT | `1024` | 自定义宽度（64-8192，步长 8） |
| `custom_height` | INT | `1024` | 自定义高度（64-8192，步长 8） |
| `switch_orientation` | BOOLEAN | `False` | 对调宽高（横竖屏切换） |
| `batch_size` | INT | `1` | 批处理大小（1-64） |
| `use_input_latent` | BOOLEAN | `False` | 使用外部 Latent / 生成空 Latent |
| `samples` | LATENT | - | 外部输入的 Latent（可选） |

#### 输出参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `width` | INT | 最终宽度（已适配模型倍数要求） |
| `height` | INT | 最终高度（已适配模型倍数要求） |
| `latent` | LATENT | 生成的空 Latent 张量或传入的外部 Latent |

#### 通道数自动适配

- **Flux 系列**: 16 通道
- **其他模型**: 4 通道

---

### 2. 截取关键帧 (WebpLongVideoBridgeFinal)

专为长视频分段生成设计的桥接工具，从已生成的 WebP 文件中提取特定帧作为下一段的起始帧。

#### 输入参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `文件夹路径` | STRING | `D:/Output/MyVideo` | WebP 文件存放目录 |
| `提取第几帧` | INT | `81` | 从 WebP 中提取的帧序号（1-10000） |
| `运行模式` | 枚举 | - | `自动续画_读取上个视频` / `手动模式_仅首轮使用` |
| `手动初始首帧` | IMAGE | - | 手动模式下的起始帧输入（可选） |
| `新视频尾帧` | IMAGE | - | 当前段生成的尾帧（可选） |

#### 输出参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `本段起始帧` | IMAGE | 提取的帧或手动输入的起始帧 |
| `本段结束帧` | IMAGE | 传入的尾帧 |
| `运行状态` | STRING | 操作结果状态信息 |

#### 工作流程

```
第1轮: 手动模式 → 输入初始帧 → 生成第1段视频
第2轮+: 自动模式 → 读取第1段的WebP → 提取第N帧 → 作为第2段的起始帧
```

#### 使用场景

- 显存不足时的长视频分段生成
- 保持视频片段间的画面连贯性
- 16GB 显存环境下的视频接力生成

---

### 3. 视觉资源库选择器 (VisualCharacterSelector)

可视化图片资源管理器，支持文件夹树形浏览、图片预览和选择，适用于角色管理、素材库浏览等场景。

#### 输入参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `base_directory` | STRING | `output/Characters` | 图片资源根目录 |
| `image_path` | STRING | - | 选中的图片完整路径（自动填充） |

#### 输出参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `IMAGE` | IMAGE | 选中的图片张量 |
| `FILE_PATH` | STRING | 选中图片的完整文件路径 |

#### 界面功能

| 功能 | 说明 |
|------|------|
| **文件夹树** | 左侧边栏显示文件夹层级结构，支持展开/折叠 |
| **视图切换** | 大图模式 / 列表模式 |
| **排序方式** | 名称 A-Z / 名称 Z-A / 最新优先 / 最早优先 |
| **图片预览** | 点击图片打开全屏预览，支持键盘左右切换 |
| **图片删除** | 预览模式下可删除图片（移至回收站） |
| **拖拽调整** | 可拖拽调整侧边栏宽度 |

#### 支持的图片格式

- PNG (.png)
- JPEG (.jpg, .jpeg)
- WebP (.webp)
- BMP (.bmp)

#### 使用场景

- 角色立绘管理和选择
- 参考图库浏览
- 素材资源管理
- 批量图片筛选

---

## 📖 使用教程

### 教程 1: 模型分辨率快速切换

```
[比例切换器] → [KSampler] → [VAE Decode] → [保存图像]
        ↓
   [选择模型类型]
   - Flux2-klein
   - Qwen-Image-Edit-2512
   - Z-ImageTurbo
   - WAN 2.1 / 2.2
```

**提示**: 使用 `switch_orientation` 快速切换横竖屏。

---

### 教程 2: 长视频分段接力

```
第1段:
[空Latent] → [KSampler] → [VAE Decode] → [保存为WebP]
                ↓
           [尾帧输出]
                ↓
第2段:
[截取关键帧] → 提取第81帧 → [图生图] → [生成第2段]
      ↑
[读取第1段WebP]
```

**配置**:
- 第1轮: `运行模式` = `手动模式_仅首轮使用`
- 第2轮+: `运行模式` = `自动续画_读取上个视频`
- `提取第几帧`: 根据视频长度调整（建议 60-90 帧）

---

### 教程 3: 使用视觉资源库选择角色

```
[视觉资源库选择器] → [加载图像] → [KSampler] → [保存图像]
        ↓
   [浏览文件夹]
   [选择角色图片]
```

**配置**:
1. 设置 `base_directory` 为角色图片存放目录（如 `output/Characters`）
2. 在节点界面中浏览文件夹树
3. 点击想要的图片进行选择
4. 双击图片可全屏预览
5. 选中后图片会自动输出到后续节点

---

## ❓ 常见问题

### Q1: 比例切换器生成的图像变形？

**A**: 确保：
1. 选择了正确的 `model_type`
2. 自定义尺寸符合模型的倍数要求（Flux/Qwen 需 16x，Z-Turbo/WAN 需 64x）
3. VAE 模型与选择的模型类型匹配

### Q2: 截取关键帧提取的帧不正确？

**A**: 
- 检查 `提取第几帧` 是否超过 WebP 的总帧数
- 确保 `文件夹路径` 指向正确的 WebP 存放目录
- 首次运行请使用 `手动模式_仅首轮使用`

### Q3: 视觉资源库不显示图片？

**A**: 
- 检查 `base_directory` 路径是否正确
- 确认目录下有支持的图片格式（png, jpg, jpeg, webp, bmp）
- 点击节点顶部的 "🔄 刷新" 按钮
- 检查浏览器控制台是否有报错信息

### Q4: 节点显示为红色/无法加载？

**A**: 
1. 检查 `requirements.txt` 中的依赖是否已安装：
   ```bash
   pip list | findstr -i pillow
   pip list | findstr -i numpy
   pip list | findstr -i send2trash
   ```
2. 查看 ComfyUI 控制台是否有报错信息
3. 确认 Python 版本 >= 3.8
4. 尝试重新安装依赖：
   ```bash
   pip install -r requirements.txt --force-reinstall
   ```

### Q5: 安装依赖时提示权限不足？

**A**: 
- **Windows**: 以管理员身份运行命令提示符
- **Linux/macOS**: 使用 `sudo` 命令
  ```bash
  sudo pip install -r requirements.txt
  ```

### Q6: 如何验证 Pillow 是否支持 WebP？

**A**: 
```python
from PIL import Image
print('WEBP support:', 'WEBP' in Image.registered_extensions().values())
```

---

## 📝 更新日志

### v1.1.0 (2026-03-14)
- ✨ 新增 `视觉资源库选择器` 节点
- 🖼️ 支持可视化图片浏览和文件夹管理
- 🗑️ 支持图片删除（安全移至回收站）
- 🔄 支持多种排序和视图模式

### v1.0.0 (2026-03-06)
- ✨ 初始版本发布
- 📐 新增 `比例切换器` 节点
- 🔄 新增 `截取关键帧` 节点

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。

---

**Made with ❤️ by geniusewzq**

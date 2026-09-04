# Local Markdown Reader

[English](README.md)

一个面向 Markdown 项目的本地化文档阅读器。

将任意 Markdown 项目转换为一个可浏览的本地文档空间，无需部署网站，无需依赖在线文档平台。

## 为什么需要它？

Markdown 已经成为许多项目的主要文档格式：

* 科研项目笔记
* 技术文档
* 开源项目说明
* 项目设计文档
* 实验记录
* 个人知识库

Git 非常适合管理这些 Markdown 文件，但直接阅读一个 Markdown 项目通常并不方便：

* GitHub 更适合作为代码托管平台，而不是沉浸式阅读工具
* VS Code 更偏向编辑，而不是专注阅读
* MkDocs / GitBook 等方案需要额外的构建和部署流程

Local Markdown Reader 希望提供一种更简单的方式：

> 让 Git 管理 Markdown 源文件，让 Reader 提供接近文档网站的本地阅读体验。

```
Markdown 文件 + Git
        |
        v
Local Markdown Reader
        |
        v
本地化项目文档空间
```

## 功能特点

### 面向项目的阅读方式

* 浏览完整 Markdown 项目目录
* 通过文件树快速定位文档
* 自动打开 `README.md`、`index.md` 或首个 Markdown 文件
* 保持项目内部链接和本地资源正常工作

### 丰富的 Markdown 渲染

支持：

* GitHub 风格 Markdown
* 代码语法高亮
* 表格、任务列表、脚注
* Mermaid 流程图
* 使用 `$...$`、`$$...$$`、`\(...\)` 或 `\[...\]` 的 MathJax 数学公式
* 明确的粗体、斜体、删除线与行内代码样式
* 本地图片和 SVG 文件

### 舒适的阅读体验

提供：

* 三栏式文档布局
* 文件搜索和导航
* 面包屑导航
* 页面目录（TOC）
* 内部链接预览
* 阅读进度记录
* 预计阅读时间
* 分章节折叠
* 打印友好模式

### Markdown 富文本编辑

在同一个专注工作区中阅读和写作，同时始终以 Markdown 作为唯一文档格式：

* 直接编辑接近渲染效果的段落、标题、列表、链接、代码、表格和公式
* 使用斜杠命令与轻量级选区工具栏
* 拖动单个块，或连同完整内容一起移动标题章节
* 拖放、粘贴图片，并插入视频、音频、PDF 和其他本地文件
* 将资源保存在文档旁边，并写入可移植的相对路径
* 在富文本与 Markdown 源码之间切换而不触发保存
* 保守自动保存，同时保留 `Ctrl`/`Cmd` + `S`
* 检测外部文件修改，发生冲突时停止覆盖

## 使用场景

### 科研项目

Markdown 经常作为科研项目的工作格式：

```
project/
├── README.md
├── proposal.md
├── experiments/
│   ├── exp1.md
│   └── exp2.md
└── notes/
    └── ideas.md
```

将整个研究项目作为一个结构化文档进行浏览。

### 开源项目

对于包含：

```
repository/
├── README.md
├── docs/
├── tutorials/
└── examples/
```

的项目，无需搭建文档网站，即可获得更好的本地阅读体验。

### 个人知识管理

使用 Git 管理 Markdown 笔记，同时获得更加舒适的阅读界面。

## 环境配置

请根据使用目的选择对应的配置方式。

### 仅使用配置

如果只需要运行 Local Markdown Reader，请使用此方式。环境只需要 Python 3.10
或更高版本：

```bash
python -m pip install .
```

Python 安装包已经包含编译后的浏览器应用。安装和运行 `readmd` 不需要
Node.js、npm、Playwright，也不需要由 Playwright 管理的浏览器。

安装完成后，可用以下命令打开 Markdown 项目：

```bash
readmd <directory>
```

### 完整开发配置

如果需要修改 Python 服务端或浏览器应用，并运行完整的测试和构建流程，请使用
此方式。环境需要 Python 3.10 或更高版本、Node.js 和 npm。

以可编辑模式安装项目，同时安装 Python 测试和打包工具：

```bash
python -m pip install -e ".[dev]"
```

按照 `frontend/package-lock.json` 安装确定版本的前端依赖，然后安装
Playwright 使用的 Chromium：

```bash
cd frontend
npm ci
npx playwright install chromium
cd ..
```

Playwright 及其 Chromium 仅供浏览器端到端测试使用，不属于仅使用配置。

## 使用方式

打开一个 Markdown 项目：

```bash
readmd <directory>
```

或者启动后在浏览器中选择项目：

```bash
readmd
```

指定初始打开文件：

```bash
readmd <directory> --initial <markdown-file>
```

更多参数：

```bash
readmd <directory> --port 9000 --no-browser
```

### 浏览器启动

默认情况下，`readmd` 会请求操作系统使用默认浏览器打开 Reader URL。本地
服务本身并不依赖浏览器自动启动。如果系统没有安装图形浏览器，例如精简版
Linux、容器、SSH 或远程开发环境，请将 `readmd` 输出的 URL 复制到能够访问
该服务的浏览器中。

浏览器检测失败会被安静处理。如需完全跳过自动启动，请使用：

```bash
readmd <directory> --no-browser
```

## 设计理念

### Local-first

文档始终保存在本地，不依赖在线服务。

### Source-first

Markdown 文件是唯一真实来源，Reader 只负责提供更好的展示体验。

### Project-first

一个 Markdown 项目不仅是一篇文档，而是一组互相关联的知识空间。

## 隐私

* 默认运行在本地
* 默认绑定 `127.0.0.1`
* 只访问用户主动选择的 workspace
* 不上传任何文档内容

## 开发流程

以下命令默认已经完成上面的完整开发配置。

运行 Python 测试：

```bash
python -m pytest
```

检查 TypeScript 类型、运行前端测试并构建浏览器应用：

```bash
cd frontend
npm run typecheck
npm test
npm run build
cd ..
```

`npm run dev` 会监听前端源文件并持续重新生成 Python 包内的静态资源。
开发时可在另一个终端运行 `readmd . --no-browser`。

Playwright 浏览器冒烟测试：

```bash
cd frontend
npm run test:e2e
cd ..
```

前端构建完成后生成 Python 分发包：

```bash
python -m build
```

完整流程与架构说明见 `CONTRIBUTING.md`。

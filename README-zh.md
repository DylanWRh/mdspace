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
* MathJax 数学公式
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

## 安装

环境要求：

* Python 3.10+

从源码安装：

```bash
python -m pip install .
```

开发模式：

```bash
python -m pip install -e .
```

Python 安装包已经包含编译后的前端资源，普通安装和使用不需要 Node.js。

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

## 开发

Python 端要求 Python 3.10 或更高版本：

```bash
python -m pip install -e .
python -m pytest
```

浏览器端使用 TypeScript、Vite、Milkdown 和 Crepe：

```bash
cd frontend
npm install
npm run typecheck
npm test
npm run build
```

`npm run dev` 会监听前端源文件并持续重新生成 Python 包内的静态资源。
开发时可在另一个终端运行 `readmd . --no-browser`。

Playwright 浏览器冒烟测试：

```bash
cd frontend
npm run test:e2e
```

前端构建完成后生成 Python 分发包：

```bash
python -m build
```

完整流程与架构说明见 `CONTRIBUTING.md`。

---
description: "个人知识库工作台的浏览器半侧：设置页中的双栏工作台，含上传队列、文档库、带难度筛选的检索与变式生成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

本包以两个可加表面呈现知识库工作台：与内建设置分区并列的 `settings.section` 占位，以及由 `sidebar.footer.action` 按钮唤起的 `shell.overlay` 全屏浮动面板；两者共享同一控制器。布局为顶部上传栏 + 双栏主体（左文档库、右检索），窄屏折叠为上下堆叠。检索支持类型过滤与五档难度（简单/普通/困难/地狱/噩梦，本地化标签 + 内部稳定码），每张题模板卡片可按数量与目标难度生成变式题。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: ui-workbench
  name: '@deepseek-ai/dsh-client-ui-workbench'
```

宿主半侧必须提供 `/api/knowledge.*` 路由（`workbench-knowledge` 行）。探测运行中的服务器前先重建客户端 bundle：注册表提供的是 `lib/client.js` 而非源码。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 词典注册与 `settings.section` 槽位贡献 |
| [`src/client/api.ts`](src/client/api.ts) | 手写线格式调用；XHR 上传带进度 |
| [`src/client/store.ts`](src/client/store.ts) | 控制器：快照 store 与 API 动作 |
| [`src/client/WorkbenchSection.tsx`](src/client/WorkbenchSection.tsx) | 分区、上传栏、文档库、检索面板与结果卡片 |
| [`src/client/locales.ts`](src/client/locales.ts) | zh/en 词典；所有可见文案集中于此 |

<a id="further-exploration"></a>
## 进一步探索

- [Workbench 子系统](../../../docs/subsystems/workbench.zh.md) — 数据模型与管线语义。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

未发布 invariant 伴随包：控制器把上传文件保存在可观察快照之外，所有变更路径经同一 store 写入。

</details>

<a id="model-experience"></a>
## 模型体验

### 知识库工作台设置分区

#### 模型看到什么

什么都不看到。浏览器半侧不直接调用模型路由；变式生成经宿主路由执行，由其运行知识服务的模板管线。

#### Token 影响

零 `session` 事件。工作台 UI 不创建模型轮次。

#### KV Cache 影响

无。上传、检索与生成都在会话日志之外。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 文档状态在显式操作与刷新按钮时更新；后台轮询延后。
- 模板 payload 以 JSON 渲染；结构化变式模板渲染器延后。
- 样式表中的 token 名在验证阶段与主题表核对。

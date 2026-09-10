# Agent Note：workbench 知识能力接缝

Status: implemented

[English](2026-09-07-workbench-knowledge-seam.md) | 中文
## 问题

用户需要把 harness 变成个人知识库：文档上传分两种模式（分词知识库，以及带逐题变式模板、五档难度与提炼元数据的出题模板管线），存入本机 pgvector，从 Web GUI 检索，且全部不触碰 harness 核心。

harness 没有 embeddings 能力、没有 pgvector 存储、web 外壳也没有通用的"新增顶层页面"槽位。朴素的实现要么改核心包（被禁止），要么在 harness 旁边另起一个应用（失去组合、鉴权与 UI 管道）。

## 决策

以新组 `workbench/` 的四个包加一个浏览器包交付该能力，遵循 web 家族的 capability-seam 拆分：

- `dsh-workbench-knowledge` 声明 `knowledgeStore` 与 `knowledgeEmbedding` 两个接缝并发布 `ctx.knowledge`（摄取编排、检索、变式生成与 `/api/knowledge.*` 精确 Fetch 路由）。缺失提供方会经 inject 等待使挂载失败。
- `dsh-workbench-knowledge-pgvector` 与 `dsh-workbench-knowledge-embedding-openai` 注册两个提供方；连接参数经 `PGSQL_*` 环境表达式进入，凭证不落仓库；embedding 凭证使用 `env:` 引用。
- `dsh-client-ui-workbench` 把工作台渲染为 `settings.section` 占位——这是被认可的完整内容区扩展点——而非需要核心布局改动的新顶层视图。

传输采用精确 Fetch 路由而非 Typert Remote（`session-log-export` 先例）；路由方法集合为 `GET|HEAD|POST`，破坏性操作以 POST 体表达。模板管线的模型调用走 `ctx.llm.stream()`，路由是显式的组合配置项（`template.llm`），因为不存在默认路由服务；调用省略核心里封闭的 `purpose` 联合类型而不扩展核心。难度是结构化带索引列，在 JSON 边界按固定五档枚举校验；产物元数据编入向量文本，保证文档名与主题词可搜。

## 备选方案

- 经 `dsh plugin add` 安装的 out-of-tree bundle 保持 harness 树纯净，但失去仓库的客户端构建管道、覆盖率与 i18n 门禁；在分支工作流消除上游冲突顾虑后否决。
- 复用 `ctx.fileUpload` 回执做上传可复用流式接入，但其回执按会话作用域且绑定提示投递——对持久文档是错误的生命周期。
- Typert Remote 类型化 RPC 延后：精确 Fetch 路由以手写线格式覆盖传输，Remote 生成管道对单一功能面不成比例。

## 后果

- web profile 组合四个新行；上游升级只触碰这些组合行。
- 工作台要求 `PGSQL_*` 环境变量与 embeddings 凭证（默认 `SILICONFLOW_API_KEY`；ARK 在其凭证服务 `/embeddings` 后可用）。
- schema 版本 1 无迁移路径；更换维度需删除 `kb_*` 表（存储会指明）。
- 重新导入需要客户端再次提供文件；上传不做服务端持久化。

## 验证

- 存储、embedding、管线、服务与传输单元测试（32 项通过）覆盖引导幂等、维度不符拒绝、KNN 过滤、响应对齐、JSON 校验重试一次、单题失败隔离、去重与路由准入规则；真库集成 spec 由 `DSH_TEST_PGVECTOR_DSN` 门控。
- `dsh --profile web --dump-config` 组合全部四行；客户端 bundle 构建通过；`pnpm run typecheck` 与 export-JSDoc、config-catalog、tsconfig-paths 门通过。
- `dsh web` 实机端到端演练（上传 → 模板 → 过滤检索 → 变式生成）待部署重启后进行。

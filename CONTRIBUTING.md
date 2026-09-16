# 贡献指南

提交前先沟通问题与变更范围。当前客户端处于开发预览阶段；架构、路线图、协议变更和验收资料由 FlowArk 治理仓库维护。访问对应资料需使用项目授予的权限。

- 提交采用 `type(scope): description`，例如 `fix(editor): 修复节点排序`。
- 不提交 API Key、账号资料、浏览器 Profile、数据库、测试产物或安装包。
- 执行 `pnpm check`；涉及运行、取消、调度时补充 `pnpm test:runtime`。涉及桌面或浏览器时按改动执行 `pnpm test:desktop`、`pnpm test:browser` 或 `pnpm test:scenario`。
- 当前不增加 CI、Husky、commitlint 或自动发布工具。
- PR 说明具体行为、验证命令及未验证部分；真实外发测试需要明确授权。
- 本仓库 Markdown 仅保留 README、贡献指南等必要说明，不新增 AGENTS、设计文档、实施计划或验收报告；这些文档归治理仓库。

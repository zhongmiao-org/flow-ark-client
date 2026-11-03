# 贡献指南

提交前先沟通问题与变更范围。当前客户端处于开发预览阶段；架构、路线图、协议变更和验收资料由 FlowArk 治理仓库维护。访问对应资料需使用项目授予的权限。

- 提交采用 `type(scope): description`，例如 `fix(editor): 修复节点排序`。
- 工作分支使用 `type/简短英文描述`，类型与提交规范一致，例如 `feat/client-initial`、`fix/browser-recovery`、`docs/contributing`；不使用 `codex/` 等工具名前缀。CI 同时校验分支名和 PR 标题。默认分支 `main` 保持原名。
- 不提交 API Key、账号资料、浏览器 Profile、数据库、测试产物或安装包。
- 当前 UI 阶段执行 `pnpm typecheck` 和 `pnpm build`，不新增或运行单元测试，已有测试保留。恢复自动化测试的验收阶段再执行 `pnpm check`；涉及运行、取消、调度时补充 `pnpm test:runtime`，涉及桌面或浏览器时按改动执行对应测试。
- 修改凭据保护时执行 `pnpm test:vault`；它使用临时目录、虚构凭据与进程内故障注入，不应更改真实系统凭据。
- macOS 桌面测试统一使用 `scripts/desktop-session.mjs` 的启动器，已有 FlowArk/Electron 主程序时停止测试，不关闭用户实例。测试串行执行，清理自己的任务后等待主进程实际退出；退出超时即测试失败。遗留测试锁须先核对记录的进程及桌面主进程，不能直接抢占。
- 每次提交使用功能分支并创建或更新本仓库 PR，添加固定的 `automerge` PR 标签；不直接推送默认分支。当前最新提交的必需 CI 检查通过且满足合并规则后，由 CI 自动合并。
- 核对 PR 实际合并状态、CI 结果及合并提交，再从最新默认分支继续开发。CI 失败、冲突、权限不足或自动合并未配置时如实报告，不手工合并或绕过检查。
- `CI` 工作流在 PR、main 推送及手动触发时执行 `pnpm install --frozen-lockfile`、`pnpm typecheck` 和 `pnpm build`；`Validate` 检查名称保持。分支及 PR 标题检查仅在 PR 执行。主线与 PR 分别控制并发；同仓库非草稿 PR 带有 `automerge` 标签且满足分支规则时，`Auto Merge` 核对已验证的 head/base 后 squash 合并，主线和手动运行不触发合并。外部 fork 的 PR 只运行检查。
- CI 不下载自动化浏览器，不运行真实网站、AI 或桌面验收；这些验证仍按本地环境和具体变更单独执行。
- 不额外添加 Husky、commitlint。发布只由 Prepare Release 的版本 PR 触发，普通 PR 自动合并不发版；打包和发布不代表真实业务验收完成。
- 普通 PR 同时更新 CHANGELOG.md、CHANGELOG_en.md 的 Unreleased；空白/分类标题修改不算更新。已发布章节受保护，确需修正使用 changelog correction。Dependabot 或 skip changelog 仅豁免内容更新，结构/版本仍校验。应用版本只通过 prepare-release 更新；版本分支使用 build/release-v<version>，release 标签不豁免看门狗。
- Changelog 看门狗独立运行并被 CI 复用；版本 PR 另需四平台候选包通过。CI 核对当前 head/base 及全部检查后合并，并显式触发发布；已公开版本不得覆盖附件或移动 tag。
- PR 说明具体行为、验证命令及未验证部分；真实外发测试需要明确授权。
- 本仓库 Markdown 仅保留 README、贡献指南等必要说明，不新增 AGENTS、设计文档、实施计划或验收报告；这些文档归治理仓库。

## 模板开发边界（0.2.0）

站点选择器、业务 Schema、提示词、规则、完整 demo/example/模拟站点归 `flow-ark-templates` 独立仓库。此仓库仅实现通用 SDK、BrowserDriver、AI 传输、模板包校验安装、实例/版本/Run 管理及最小底层测试夹具。不建立相邻源码导入、跨仓库 workspace 或符号链接依赖。标准包及采用契约固定复制后即可独立构建。模板源码不参与应用打包。

破坏兼容的首次迁出不做业务兼容；本机工作记录仅通过明确调用的一次性维护工具清理，不加入应用启动、升级或 CI。凭据、数据密钥、浏览器 Profile、原始资料、外部输出、既有备份必须保留。

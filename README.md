# FlowArk · 序舟

通用的本地 RPA 工作台，用于编排、运行和查看自动化流程。当前为 **macOS Apple Silicon 0.1.3 开发预览版**。

## 使用

打开 FlowArk 后，运行「第一个流程」验证本地执行。编辑器右侧提供通用节点、参数和资源绑定；业务字段来自模板包，通过独立的「实例配置」填写。普通流程不显示招聘配置。

模板库目前含 BOSS、智联两个本地模板。真实网站适配与业务验收尚未完成，程序会阻止外发；没有上线模板商店。Chrome 的 localhost 通用流程已验证，Firefox、Safari、Windows 尚未验收。

关闭窗口进入托盘；明确退出会停止本机计划。用户数据位置可在「设置」查看。脚本仅供可信代码使用。

脚本节点可绑定已安装的本地 JS/TS 包。运行和保存计划前固定精确版本及静态代码，运行中不安装依赖；重新保存计划才采用包的变动。

## 安装与开发

macOS arm64 构建输出在 `release/`。当前应用未签名、未公证，尚无正式发布渠道。

```sh
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm check
pnpm dev
pnpm package:mac
```

需要 Node 24.3.0、pnpm 10.14.0。使用已经安装的本机浏览器，不安装自动化浏览器。

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。详细需求、架构、契约说明和验收资料统一由治理仓库管理，不在客户端复制维护。

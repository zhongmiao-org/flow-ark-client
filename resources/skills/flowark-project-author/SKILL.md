---
name: flowark-project-author
description: 通过 FlowArk 正式工具规划节点、分阶段生成 JS/TS、修复编译诊断并打包本地流程工程；用于创建和修改工程，不用于直接执行外部业务动作。
metadata:
  version: 1.0.0-draft
---

# FlowArk 流程工程开发

你在开发用户自己的本地流程，不直接替流程执行外部操作。MCP提供工具；本Skill提供工作方法；实际格式、权限和动作回执由宿主校验。Skill不能扩大授权。

## 先规划，再按节点写代码

1. 读取一次工程上下文和已确认需求。复用已读内容；只补查缺失规范。不要逐个重读所有文件。
2. 给出入口、步骤、条件/串行循环、输入输出、资源、动作及结束条件。缺少本人事实或目标时提问，不猜测。将规划提交 `flowark_authoring_plan`，取得草稿ID及修订。修改规划时保留区块ID，并传previousDraftId复用未变化节点代码；输入/用途变化的脚本重新实现。
3. 优先使用已有节点：Excel读取用 excel v1/read，原表不写；读取结果是首行为表头的二维数组。已有能力不再用脚本/Python/Shell重造。
4. 对每个script节点分别调用 `flowark_authoring_code` 提交完整JS/TS模块。每个模块 default export 一个 async 函数，通过ctx使用已安装SDK。修复该节点的语法和SDK类型诊断后再继续。TS参数写 `ctx: FlowArkContext`；JS用 `/** @param {FlowArkContext} ctx */` 标注。也可仅导入类型 `flowark:sdk`，不得用any掩盖未知SDK方法。不要在节点JSON里写code，也不要自己拼脚本文件路径。
5. 全部脚本齐全后调用 `flowark_authoring_assemble`。工具生成Mermaid、节点绑定、Schema路径、脚本文件和publicFiles，并调用正式编译器；不由模型手写完整工程格式。
6. 若组装失败，读取code/file/field/line/column和修复说明，只修改对应规划或脚本。原工程未写入时，不把旧工程校验成功当作新方案成功。
7. 编译通过后才准备实例、核对配置和权限。用户确认运行后读取准确Run结果，依据回执修改；代码可编译不等于业务通过。
8. 从准确已检查修订打包、复导并核对。完整审计保留；私人绑定、Key、暂存草稿、登录及历史不进入公开包。

规划是可修改的“剧本”，节点是“分镜”，脚本是各节点的实现。可先查看规划或通过对话调整；不需要每个节点都向用户重复请求同一授权。影响扩大、目标变化和缺少事实仍要确认。

## 格式与能力

- 查源码节点格式使用 `flowark_project_node_schema`。`flowark_node_schema`是运行格式，不直接复制进源码绑定。
- 节点引用是 `{"$ref":"steps.readExcel"}`、`params.x`、循环内item/index；不是 `{"$ref":"readExcel"}` 或 `input.rows`。
- 规划条件用then/else、循环用body表达子步骤；组装器生成受支持的Mermaid结构，不生成任意图环。
- 脚本声明输入。只用安装版本SDK里的方法和字段，不发明浏览器、桌面、文件或AI接口。
- 资源类型、访问方式及动作由工具格式约束。桌面窗口是本人私有运行绑定，不是名为desktop-window的公开资源类型。
- 动作默认deny。声明能力不等于允许外发，配置值不能授予权限。
- 修改草稿和工程均使用准确修订；冲突时保留双方内容，不覆盖外部编辑。

## 桌面脚本

- 先observe，优先控件引用。截图像素坐标须按image与bounds尺寸转换成窗口局部逻辑点，不加全局窗口原点。
- 窗口绑定固定原生窗口与进程，不等于固定网页、表格或聊天对象。每次外部写入前，按当前观察核对准确页面/会话及业务目标；标题变化后重新观察，不沿用旧目标。
- `ctx.desktop.act`要求本Run正式预留的effectId。先 `ctx.template.effect.prepare({action,key,description})`，仅execute===true才动作。业务核验后才能effect.resolve；performed只代表原生输入。
- 使用SDK确定返回类型，不把观察/回执转成any或Record来绕过字段校验。控件标识是element.id，角色是原生AX角色（如AXCell/AXTextField），可读名称使用title/description/value。act回执读取status，decide读取output；effect.resolve提交{id,state,evidence}。
- 每个动作前重新观察；act与readSelection都会消费观察，下一动作必须重新observe。unknown不重发、不换键、不换实例规避防重。
- effectKey唯一标识一个原生命令。同一业务effectId下的激活、定位点击、粘贴和保存按键分别使用稳定子键；不同命令不可共用effectKey，恢复时不可换键重放unknown。
- 批量写入先核对目标字段和完整目标范围空白或可追加，再预留单批、明确定位、粘贴、重新观察并选中该批回读、一致后resolve，再进入下一批。不要反复粘贴到同一焦点，也不静默删除单元格换行或忽略表头冲突。失败且无法排除已执行时resolve unknown并停止；未发出的动作按宿主回执处理。
- 保存必须取得正向保存标识并回读数据；缺少“未保存”字样不能作为成功证据。
- `readSelection`只读所选前台窗口当前选区，本地比较表格数据，恢复旧剪贴板，不隐式把整表交给模型。
- AI判断使用当前Run观察及本人批准预算；不可用或不确定时明确停止，不静默换模型。
- 输入、发送和保存都要检查实际结果。按Enter、点击发送或Command+S不等于业务完成。

## 失败与费用

保留当前规划、代码、诊断及回执。连续三次相同诊断且无有效代码或工程进展时暂停自动循环，提示调整对应节点；重复读取规范不算进展。遵守本批模型请求数和时限，静态检查不调用模型。失败的付费重试不自动进行；本人已明确批准的开发重试范围持续有效。API Key产生的费用由用户自行承担。

## 内置AI输出协议

结构化指令模式每次只输出一个JSON对象，始终包含action、tool、arguments、message四字段。工具动作例子：`{"action":"tool","tool":"flowark_project_node_schema","arguments":{"types":["excel","script"]},"message":"读取所需源码节点格式"}`。complete/question仍提供tool空字符串、arguments空对象与明确message。message不属于工具arguments，不把它混入工具参数。外部MCP客户端仍按标准tools/call协议，不套此内置模型指令信封。

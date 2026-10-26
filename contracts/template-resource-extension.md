# 目录资源声明扩展 v1（未发布候选）

2026-10-26。仅为已有模板实例接入标准包中追加的目录声明；原实例的包身份、业务文件、状态和结果来源保持。本草案将由独立构建器封存为 0.53.0 候选。发布、客户端采用、原生操作与业务缓存分别验收，生成回执值不代表宿主已经提交。

## 字段与身份

`wire.schema.json` 为语言无关格式来源。`Package` 使用 `id/version/digest`，本机 packageKey 必须由 `id + '@' + version` 唯一导出，不接受独立但可能冲突的字符串。

- `PreviewRequest`：version=1、instanceId、expectedRevision、basePackage、extensionPackage。只读核对准确来源和实例修订，返回同身份字段及 compatible（resources/entries）、incompatible 或 blocked（reason）、already-applied（receipt）。预览不持有锁、不保存、不执行；apply 必须重新核对。
- `ApplyRequest`：同预览字段，另加 requestId。期望修订是现有完整模板实例 revision，覆盖受影响当前流程及已接入声明，不是模板 state revision。只有服务端计算的声明增量可以进入回执，Renderer 不提交资源定义、路径、授权或流程。
- `Receipt`：version=1、requestId、requestSha256、instanceId、previousRevision、basePackage、extensionPackage、resources、entries、appliedAt、receiptSha256。resources 仅包含新增目录完整定义，entries 仅包含受影响入口及追加 resourceIds。requestSha256 为完整原请求规范摘要；receiptSha256 对排除自身的完整回执求规范 SHA256。规范 JSON 按对象键排序、保留数组顺序、UTF-8 编码。
- `ApplyResponse`：version=1、receipt。提交后的 detail 独立读取；已有成功回执但读取失败只能重新读取，不能重新接入。
- 当前实例侧挂 `templateResourceExtension` 为完整不可变 Receipt；仅受影响当前 `FlowRecord.templateResourceExtension` 保存相同完整值。新 `RunSnapshot.templateResourceExtension` / PreparedScripts 固定相同回执。字段缺失意味着没有扩展，不能从 live instance 补入旧 version、snapshot、plan、rerun 或已有连续会话。

回执不含本机路径、账号、凭据、配置、授权或业务证据。当前实例自身 revision 因回执接入改变；回执不保存最终 revision，避免 revision 包含回执而形成摘要自引用。完整回执及其所在快照继续计入现有存储/输出政策，不建立未计量的输出副本。

## 严格兼容

两个包先分别通过原有标准 ZIP 和摘要校验。模板 id 相同，版本及 contentDigest 不同；参考函数接收与现行 PackageData 一致的完整 Map：包含 manifest.json，数量为 manifest.files.length + 1，原始 manifest JSON 必须等于已校验对象；全部非 manifest 文件的路径、大小、声明 SHA256 和实际字节逐项一致。仅允许 manifest.version/contentDigest 改变、resources 末尾追加目录、原 entries 的 resources 末尾追加这些新目录 ID。其他所有字段、数组顺序、原 resource/action/capability、Schema、flow、脚本及提示词保持原值。

新增目录只允许 id/name/kind=directory/access=write|readwrite/required，不含默认来源或任何额外字段。新 ID 不得复用旧 ID；全部新增目录必须至少归属一个原有入口。受影响入口原先必须已声明 file capability，actions 非空且全部引用原 actions。原契约动作没有 kind 字段，不能按名称推断虚构的 file.write 类型；仍按现有 entry.actions 与 canWrite/writeGuard 校验原授权，不添加动作或提升 grant。既有 file 能力/动作范围不足时拒绝本路径。

MVP 每实例最多一份扩展回执；不叠加、不替换、不撤除，不提供移除或升级恢复 UI。相同 requestId 和相同 requestSha256 返回已提交的原回执；同 ID 不同请求拒绝。已经接入后不同 requestId 或另一扩展包拒绝，通过读取获取既有回执。资源绑定仍可经现有保存路径修改，目录访问前继续核对当前授权及绑定；这不改变声明回执。

## 原子接入与运行固定

保存前拒绝未保存 UI 草稿、同实例排队或活动 Run、暂停/等待/取消中 Run 及尚存活的连续会话。不能取消或抢占这些工作以完成接入。按模板写操作串行，重新读取固定包、严格兼容结果及当前完整实例修订；最后在同一 Store 事务中复核 expectedRevision、静止状态和 requestId，再写不可变回执、实例侧挂、目标当前流程字段。任一失败零部分写入。保留 instanceId、flowId、flow.sourceTemplate、bindings.template、configuration 及其 revision、本地步骤图、输入、原绑定/grants、数据 context、state 原值与 revision、effect/attention 记录。接入不启动 Run。

`Templates.context()` 始终返回原 PackageData。独立有效资源解析器基于固定回执，重新核对回执 hash、实例/入口归属、原/扩展包摘要及严格兼容关系；只组合原资源声明与已登记的新增目录成员。不得构造合成 manifest 再配原 contentDigest。save、writeFlows、preflight、writeGuard、SDK file 和原生 file 节点共用该规则；普通 detail 返回独立 effectiveResources 和回执，原 manifest 保持。

普通保存必须保留实例侧挂及已经接入的当前目标流程回执；未受影响入口不获得回执。Runtime.saveFlow 不允许 Renderer 注入、移除或替换回执。由该当前记录创建新版本/快照时才复制字段，并纳入 executionVersion 摘要与 rerun 捕获。执行时比对 fixed/live 回执相同、原 owner/package 仍准确、当前新增目录绑定与权限仍有效；旧快照没有字段，即使当前实例已接入也不得访问新增目录。固定 run-result proof/index 与 templateData owner 无需迁移、重写或放宽。

原包及扩展包均进入引用保护，检查实例回执、当前流程、版本和运行快照；不能删除仍需重验的扩展包。原模板导出仍导出原定义；导出带扩展依赖的本地图时，必须通过原生作者把逻辑声明纳入标准包后再导出，不能夹带私有回执/绑定，不能静默丢弃声明。

## 验证边界

本版没有新节点或 SDK 操作，没有通用缓存存储 API。模板按已有 file SDK 保存业务证据；该接口不承诺原子追加、多文件事务或自动创建子目录。目录声明接入与缓存文件写出、文件读回、业务判断、去重/送达及真实网站终点分别证明。当前不新增或运行单元测试；仅进行格式、类型、构建与治理检查，后续消费者需用有界实际宿主和原生 UI 核对事务、旧快照权限、缺绑定和错误恢复。

## 构建与采用

使用 `python3 contracts/drafts/template-resource-extension/build-schema.py` 生成独立格式源，再用 `python3 contracts/build_template_resource_extension.py` 从已核验 0.52.0 生成 0.53.0。构建器拒绝覆盖任何已有目标目录，`--output` 可用于临时独立重建。封存包含 189 份机器资料；原 183 份中仅 p1.schema.json 增加八个定义及一个可选 Run 字段，其他 182 份保持原字节。消费者必须从实际发布 tag 独立采用，不读取相邻治理目录；当前尚未发布。

# P1 0.45.1：选区文字循环调用身份

2026-10-19修订候选，尚未发布。继承实际已发布0.45.0，新增独立browser v9/collect、selection-text及browser-selection-text-v1；不改变旧正文v6/v7的规则、结果或固定历史。包2.0、SDK1.0、SQLite及现有IPC主格式保持。发布前客户端不得采用。[先行Figma、真实缺口及语言无关规则](../../docs/client/browser-selection-text.md)是本版语义的一部分，不能只实现schema。

## 循环身份修订

0.45.0对nodeInstance附加的字符模式误拒执行核心真实产生的`outer[0]/node`路径。本版只将调用身份格式恢复为有效Unicode的1–2048字符文本，沿用宿主真实活动集合及末段源id校验；不是由用户或模型提供任意执行路径。新增六项真实循环路径/末段/长度/Unicode资料。旧0.45.0封存不改，扫描政策、字段和结果语义完全不变。

## 独立来源与有限规则

本能力只读取选定DOM文字子树的候选。祖先元素自身仍沿原可见性、裁切/目标矩形、line-clamp、动画和不支持排版检查；目标自身/后代的生成内容、隐藏/裁切/嵌入内容保持拒绝。同步同源DOM、唯一根/字段、框架身份及2000元素/6000节点/64祖先/20字段预算保持；超限、导航/替换、取消或无法判断整次拒绝，不返回剩余文字片段，不回退textContent、AX或OCR。

祖先伪元素先按原v2无绘制普通空格谓词核准，计ignoredAncestorSpaces。不满足时，仅目标以外祖先或同源框架祖先的::before/::after，content严格为同号引号包裹的一或多个U+0020，无转义；position准确absolute/fixed、float=none、white-space为normal/nowrap、animation-name=none、transition-duration各项0s、元素无running/pending动画，才作为选区外装饰计excludedAncestorDecorations。缺失/未知均拒绝。文字、NBSP、转义、url/attr/counter等其他生成内容、正常流且不满足v2的空格仍拒绝。

选区外装饰可以绘制背景或覆盖页面，不称无绘制、不删除、不读取它的CSS原值或背景URL。结果externalAppearanceVerified必须false；complete只表示本次声明字段读取完整，不表示外部覆盖、站点删节/懒加载、岗位资格或业务完成。文字从通过检查的目标innerText取得。新结果不可混作旧正文结果；后续业务仍需准确来源、完整阅读/核对与既有动作授权，不因候选存在自动外发。

## 节点、调用和结果

BrowserSelectionTextFieldsNode的version=9、operation=collect、renderPolicy=bounded-selection-text-v1；字段只允许text/attribute/selection-text，至少一项selection-text，不允许rendered-text。根、字段定位和属性沿既有有限文字/严格单键Value引用；params/steps须子路径、item/index沿既有规则，禁止空段及__proto__/prototype/constructor，index只允许根本身，保持有效Unicode和各长度限制。

BrowserSelectionTextFieldsInvocation是准确解析后的节点加nodeInstance；根和字段定位必须是有限非空白文本，attribute按操作为null或有限属性名，不允许残留引用。宿主必须核对固定源全部节点字段、字段顺序/operation/required、固定字面量/null，只有已声明的引用槽允许解析；不能增加期限、换政策或换目标。nodeInstance末段对应源id，宿主还须核对真实活动登记、Run/入口资源及返回前取消；纯参考不声称重建任意脚本内部上下文。

BrowserSelectionTextFieldsResult为独立version4、同一固定政策及externalAppearanceVerified=false。来源网址/文档/框架/根和字段顺序须关联本次准确解析调用；无框架时url与documentUrl一致。每字段增加ignoredAncestorSpaces和excludedAncestorDecorations（各0–128，合计不超过128）；非selection-text或count不为1时均0，不抵销其他拒绝。

隐藏/裁切/不支持的文字value=null和有序唯一issues、状态及complete继续关联；原始text/attribute不得携带渲染原因，空字符串和属性缺失分别保留。selection-text最多65536 UTF-8字节，原始值8192、网址16384、总结果131072字节；有效Unicode，超限整次拒绝，不截断或部分采用。格式本身不证明浏览器真实来源。

## 声明与消费者

完整P1 Node新增独立分支。规范作者及正式包均检查flow.requiredCapabilities中的browser和browser-selection-text-v1，以及本入口自己的browser/use资源；作者入口额外能力与流程能力的并集构成有效入口集合，不能以额外能力代替流程声明。正式入口须包含两项能力。只读采集无需新增写动作；不获得文件、网络、招聘发送或模型权限。不支持的消费者拒绝，不改用旧节点或其他驱动。

普通客户端必须明确选择“选区文字候选”并说明外部覆盖未核验，只变当前草稿；字段配置、能力推导、变量/Run阅读、Main/Worker固定调用、两驱动正式扫描/临时诊断、取消/迟到结果和原始ZIP独立复导一并实现。诊断沿同一政策，不读取正文，两个计数分开；旧两政策字节形状保持，旧ancestor-space解释模式不与新政策混用。不能以仅增加下拉项或类型当能力已交付。

## 可复核资料与边界

browser-selection-text.ts仅核对格式、Unicode/引用、准确调用/结果关系、预算和声明；browser-selection-text.cases.json/check-browser-selection-text.ts是64项格式/关联资料。browser-selection-declarations.cases.json/check-browser-selection-declarations.ts通过合成作者及完整包分别核对21种配置，共42项，不访问浏览器、应用Store、个人记录或模型。它们不是应用单元测试或业务执行证据。

本修订从封存0.45.0生成159份机器资料；仅调用身份定义和新增六项格式资料变化，157份继承文件逐字节保持，Node、字段/结果和作者/包规则不变。正式发布须准确PR head、完整远端树/文件、实际合并和真实tag核对。随后客户端独立采用，再进行真实DOM/驱动、完整打包安装、普通UI/原始ZIP复导，最后接BOSS JD候选与完整业务；本人城市仍仅北京，公开模板不携带个人城市，150次网站上限仍未验收。

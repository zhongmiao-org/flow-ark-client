# P1 0.49.0：单次滚动网页区域

2026-10-20候选，尚未发布。继承完整已封存0.48.0；仅追加browser v12/scroll、BrowserScrollInvocation/Result和browser-scroll-v1声明校验。旧browser v1–v11、SDK1.0、包2.0和数据库保持。新节点不能由旧客户端回退执行。

[语言无关语义及固定关系](../drafts/browser-region-scroll/README.md)和[先行设计、分层验收](../../docs/client/browser-region-scroll.md)是规范组成部分。目标自身或最近纵向滚动区域，方向up/down，单次1–2000 CSS像素，无无限到底、自动重试或业务点击。结果只证明实际位移/区域边界，不能证明内容加载、候选完整或全天业务完成。

格式资料和构建封存不代表宿主/驱动/UI已实现。正式发布后客户端独立固定此准确版本，随后经普通UI制作、导出和复导模板，再进行真实续批与业务验收；没有单位测试或虚构招聘数据用于代替真实业务。

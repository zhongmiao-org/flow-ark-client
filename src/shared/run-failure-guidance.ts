export function runFailureGuidance(error: string) {
  if (/user-intervention/.test(error)) return {
    title:'检测到鼠标或键盘输入变化，流程已停止',
    explanation:'请先核对原窗口和已经发生的操作，再重新检查运行条件。这是桌面环境中断，不需要你修改代码；FlowArk不会自动重复提交。',
  };
  if (/window-context-changed|focus-changed|focus-or-selection-changed|目标页面.*匹配|窗口.*变化/.test(error)) return {
    title:'当前窗口或选区需要重新核对',
    explanation:'当前对象与上次观察不同。先检查目标网页和窗口绑定，保留已完成的操作及待核对结果。',
  };
  if (/input-posting-not-authorized|screen-recording-required|accessibility-required/.test(error)) return {
    title:'桌面操作所需的系统权限尚未满足',
    explanation:'请在客户端检查辅助功能和屏幕录制权限。系统授权由本人完成，不需要提供密码或修改代码。',
  };
  if (/回读选区尺寸不符|视觉未确认|网格.*未识别|列边界数量不符/.test(error)) return {
    title:'实际选区没有通过范围核对',
    explanation:'流程在核对失败处停止。可让AI根据当前运行证据检查目标和受影响节点；不能忽略行列校验或重复粘贴。',
  };
  if (/clipboard-snapshot-limit/.test(error)) return {
    title:'当前剪贴板超出可保护的大小限制',
    explanation:'流程没有清空原剪贴板。请保留原内容，并让AI检查客户端能力和当前操作条件。',
  };
  if (/结果未知|native-reply-lost|status.*unknown/.test(error)) return {
    title:'操作结果尚未确认',
    explanation:'先核对原窗口及操作回执。AI可以分析原因，但不能把分析当作结果确认，也不能自动重复操作。',
  };
  return null;
}

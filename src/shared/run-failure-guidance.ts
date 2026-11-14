export function clipboardFailureGuidance(error: string) {
  const code = /(?:^|[^a-z0-9_-])(clipboard-unavailable|clipboard-snapshot-limit|clipboard-changed)(?=$|[^a-z0-9_-])/.exec(error)?.[1];
  if (!code) return null;
  const recovery = '请先自行保存需要保留的剪贴板内容，或另行明确允许替换。不会自动清空、截断或忽略格式；这是系统前提，不应修改字段映射或绕过回读。其他步骤及待核对结果仍须保留。';
  if (code === 'clipboard-unavailable') return {
    title: '当前剪贴板无法完整备份',
    explanation: '某个已声明格式没有提供可读取的数据，该次复制或粘贴尚未开始。' + recovery,
  };
  if (code === 'clipboard-snapshot-limit') return {
    title: '当前剪贴板超出可完整保护的大小限制',
    explanation: '所有条目及格式的备份数据合计超过现有16MiB上限，该次复制或粘贴尚未开始；这不是Excel行列或字段代码错误。' + recovery,
  };
  return {
    title: '剪贴板备份期间发生变化',
    explanation: '尚不能确认完整备份，该次复制或粘贴尚未开始；这不证明由谁或哪个应用改变了剪贴板。' + recovery,
  };
}

export function runFailureGuidance(error: string) {
  const clipboard = clipboardFailureGuidance(error);
  if (clipboard) return clipboard;
  if (/user-intervention/.test(error)) return {
    title:'桌面输入状态未通过保护检查，流程已停止',
    explanation:'检测到相对指针差值或修饰键状态不符合当前观察，不证明由谁或哪个应用造成。先核对原窗口、输入条件和已经发生的操作；不会自动释放修饰键、忽略保护或重复提交，也不需要你修改代码。',
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
  if (/结果未知|native-reply-lost|status.*unknown/.test(error)) return {
    title:'操作结果尚未确认',
    explanation:'先核对原窗口及操作回执。AI可以分析原因，但不能把分析当作结果确认，也不能自动重复操作。',
  };
  return null;
}

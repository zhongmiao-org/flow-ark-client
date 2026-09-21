import {
  Workflow,
  Check,
  Globe,
  Code,
  FolderOpen,
  FileSpreadsheet,
  Hand,
  GitBranch,
  Repeat,
  type LucideIcon,
} from 'lucide-react';
export const kinds: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  value: { label: '数据', icon: Workflow, color: '#526b87' },
  assert: { label: '结果断言', icon: Check, color: '#428574' },
  http: { label: 'HTTP 请求', icon: Globe, color: '#456bd0' },
  script: { label: 'JS / TS 脚本', icon: Code, color: '#bc873d' },
  file: { label: '文件处理', icon: FolderOpen, color: '#6e7f85' },
  excel: { label: 'Excel 表格', icon: FileSpreadsheet, color: '#488064' },
  browser: { label: '浏览器', icon: Globe, color: '#4068c6' },
  human: { label: '等待人工', icon: Hand, color: '#bb843f' },
  condition: { label: '条件分支', icon: GitBranch, color: '#87669d' },
  loop: { label: '串行循环', icon: Repeat, color: '#a17857' },
};

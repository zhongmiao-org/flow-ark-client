import { Alert, Collapse } from 'antd';
import type { ReactNode } from 'react';
import { runFailureGuidance } from '../shared/run-failure-guidance';

export default function RunFailureNotice({error,action}:{error:string;action?:ReactNode}) {
  const guidance=runFailureGuidance(error);
  const technical=!!guidance||error.length>240||error.includes('\n')||/[{]["']/.test(error);
  return <><Alert type="error" showIcon action={action} title={guidance?.title??(technical?'运行没有完成，需要检查当前证据':error)} description={guidance?.explanation??(technical?'可以让AI检查失败步骤并提出局部修复；无需手改代码或复制技术参数。':undefined)}/>{technical&&<Collapse items={[{key:'error',label:'错误详情（高级诊断）',children:<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{error}</pre>}]}/>}</>;
}

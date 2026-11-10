import { Alert, Card, Descriptions, Tag } from 'antd';
import TechnicalDetails from './TechnicalDetails';
import type { DesktopActionRecord } from '../shared/desktop-action-record';
import { runFailureGuidance } from '../shared/run-failure-guidance';
const time=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN'):'未记录';
export default function DesktopActionReceipts({runId,receipts}:{runId:string;receipts?:DesktopActionRecord[]}){
  const items=(receipts??[]).filter(r=>r.runId===runId&&typeof r.effectId==='string');
  if(!items.length)return null;
  return <section aria-label="桌面动作回执"><Card className="desktop-run-receipt"><h2>桌面动作回执</h2><p>这些回执只记录原生输入是否投递；填写、发送和保存是否成功仍须通过业务回读核对。</p>{items.map((r,i)=>{
    const reason=r.receipt?.reason,guidance=reason?runFailureGuidance(reason):null;
    return <div key={r.actionId} data-desktop-action-status={r.status}>
      <Tag color={r.status==='unknown'?'warning':'default'}>{r.status==='performed'?'输入已投递，业务结果另行核对':r.status==='not-executed'?'本次动作未发出':'动作结果尚未确认'}</Tag>
      {guidance&&<Alert type={r.status==='unknown'?'warning':'info'} showIcon title={guidance.title} description={guidance.explanation}/>}
      <Descriptions column={1} size="small" items={[{key:'attempt',label:'尝试时间',children:time(r.at)},{key:'receipt',label:'回执时间',children:r.completedAt?time(r.completedAt):'尚未取得最终回执'}]}/>
      <TechnicalDetails items={[{label:'动作 ID',value:r.actionId},{label:'效果记录',value:r.effectId},{label:'原始状态',value:r.status},...(reason?[{label:'原始原因',value:reason}]:[])]}/>
    </div>;
  })}</Card></section>;
}

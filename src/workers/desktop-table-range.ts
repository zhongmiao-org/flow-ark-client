import Ajv from 'ajv/dist/2020.js';
import requestSchema from '../../contracts/desktop-table-range-request-v1.schema.json';
import type { DesktopTableRangeRequest, DesktopTableRangeResult } from '../shared/desktop-table-range.generated';
import type { desktopObservation, desktopCommand } from '../shared/desktop-automation';
import type { z } from 'zod';

type Observation = z.infer<typeof desktopObservation>;
type Command = z.infer<typeof desktopCommand>;
type Driver = {
  observe(options: {screenshot: false}): Promise<Observation>;
  act(request: {effectId: string; observationId: string; effectKey: string; command: Command}): Promise<{status: 'performed'|'not-executed'|'unknown'}>;
  readSelection(request: {observationId: string}): Promise<{text: string}>;
};
const validate = new Ajv({strict: false, logger: false}).compile(requestSchema);

// Clipboard TSV permits quoted tabs/newlines and doubled quotes. Never pad or
// truncate a malformed rectangle to make a range appear verified.
function parseSelection(text: string): string[][] {
  if (Buffer.byteLength(text)>256*1024) throw Error('table-range:selection-too-large');
  const rows: string[][] = []; let row: string[]=[], cell='', quoted=false, closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) {
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(c==='"'){quoted=false;closed=true;}
      else cell+=c;
      continue;
    }
    if(c==='"'&&!cell&&!closed){quoted=true;continue;}
    if(c==='\t'){row.push(cell);cell='';closed=false;}
    else if(c==='\r'||c==='\n') {
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);rows.push(row);row=[];cell='';closed=false;
    } else {if(closed)throw Error('table-range:invalid-quoted-selection');cell+=c;}
    if(rows.length>200||row.length>200)throw Error('table-range:selection-too-large');
  }
  if(quoted)throw Error('table-range:unclosed-quoted-selection');
  if(row.length||cell.length||closed||!text.length||!/[\r\n]$/.test(text)){row.push(cell);rows.push(row);}
  return rows;
}

export async function readTableRange(driver: Driver, raw: DesktopTableRangeRequest, signal: AbortSignal): Promise<DesktopTableRangeResult> {
  if(!validate(raw)||Buffer.byteLength(JSON.stringify(raw))>256*1024)throw Error('table-range:invalid-request');
  const q=raw;
  if(q.requireBlank&&q.expected?.some(row=>row.some(cell=>cell!=='')))throw Error('table-range:conflicting-expectations');
  if(q.rows*q.columns>20000||q.expected&&(q.expected.length!==q.rows||q.expected.some(row=>row.length!==q.columns)))throw Error('table-range:invalid-shape');
  if(q.to.x<q.from.x||q.to.y<q.from.y)throw Error('table-range:invalid-rectangle-direction');
  if((q.rows>1||q.columns>1)&&q.from.x===q.to.x&&q.from.y===q.to.y)throw Error('table-range:empty-rectangle');
  let size: {width:number;height:number}|undefined;
  const observe=async()=>{
    signal.throwIfAborted();const o=await driver.observe({screenshot:false});signal.throwIfAborted();
    if(o.application!==q.target.application||o.title!==q.target.title)throw Error('table-range:target-changed');
    if(size&&(size.width!==o.bounds.width||size.height!==o.bounds.height))throw Error('table-range:window-resized');
    size={width:o.bounds.width,height:o.bounds.height};
    for(const p of [q.from,q.to])if(p.x>=size.width||p.y>=size.height)throw Error('table-range:point-outside-window');
    return o;
  };
  const act=async(suffix:string,command:Command)=>{
    const o=await observe();
    const receipt=await driver.act({effectId:q.effectId,effectKey:q.effectKey+'/'+suffix,observationId:o.observationId,command});
    signal.throwIfAborted();if(receipt.status!=='performed')throw Error('table-range:action-'+receipt.status);
  };
  await act('activate',{kind:'activate'});
  if(q.selection==='drag'&&(q.rows>1||q.columns>1))await act('select',{kind:'drag',from:q.from,to:q.to});
  else {
    await act('anchor',{kind:'click',point:q.from});
    for(let row=1;row<q.rows;row++)await act('down-'+row,{kind:'key',key:'Down',modifiers:['shift']});
    for(let column=1;column<q.columns;column++)await act('right-'+column,{kind:'key',key:'Right',modifiers:['shift']});
  }
  const observation=await observe(), selection=await driver.readSelection({observationId:observation.observationId});
  signal.throwIfAborted();const cells=parseSelection(selection.text);
  if(cells.length!==q.rows||cells.some(row=>row.length!==q.columns))throw Error('table-range:selection-shape-mismatch expected='+q.rows+'x'+q.columns+' actualRows='+cells.length+' widths='+JSON.stringify([...new Set(cells.map(row=>row.length))]));
  const allBlank=cells.every(row=>row.every(cell=>cell===''));
  if(q.requireBlank&&!allBlank)throw Error('table-range:selection-not-blank');
  if(q.expected&&cells.some((row,r)=>row.some((cell,c)=>cell!==q.expected![r][c])))throw Error('table-range:content-mismatch');
  return {version:1,cells,shapeVerified:true,allBlank,matchesExpected:q.expected?true:null};
}

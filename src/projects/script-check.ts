import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scriptSdk } from './sdk';
import { ProjectDiagnostic } from './configuration';
import { digest } from '../shared/utils';
export type ScriptIssue = { code: string; message: string; file?: string; entryId?: string; nodeId?: string; line?: number; column?: number };
export class ScriptDiagnostics extends ProjectDiagnostic {
  constructor(readonly diagnostics: ScriptIssue[]) { const d=diagnostics[0]; super(d.code,d.message,d.file,d.nodeId,d.line,d.column); }
  override toJSON() { return {...super.toJSON(),diagnostics:this.diagnostics}; }
}
const cache=new Map<string,ScriptIssue[]>();
const requireHere=createRequire(typeof __filename==='string'?__filename:import.meta.url);
async function assets() {
  if(typeof __dirname==='string')return {binary:join(__dirname.replace('app.asar/','app.asar.unpacked/'),'native','flowark-typescript'+(process.platform==='win32'?'.exe':'')),types:__dirname.includes('app.asar')?join(dirname(dirname(__dirname)),'flowark-types'):join(__dirname,'types')};
  const packagePath=createRequire(requireHere.resolve('typescript/package.json')).resolve('@typescript/typescript-'+process.platform+'-'+process.arch+'/package.json');
  return {binary:join(dirname(packagePath),'lib',process.platform==='win32'?'tsc.exe':'tsc'),types:undefined};
}
async function copyTypes(destination:string,packaged?:string){
  const roots=packaged?{node:join(packaged,'node'),'undici-types':join(packaged,'undici-types')}:{node:dirname(requireHere.resolve('@types/node/package.json')),'undici-types':dirname(createRequire(requireHere.resolve('@types/node/package.json')).resolve('undici-types/package.json'))};
  for(const [name,root]of Object.entries(roots))for(const file of await readdir(root,{recursive:true})){if(!file.endsWith('.d.ts')&&file!=='package.json')continue;const target=join(destination,name,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(join(root,file)));}
}
/** Static compiler only: no plugins, project config, JS evaluation, emit or model calls. */
export async function checkProjectScripts(files:Map<string,Buffer|string>,entries:{path:string;entryId?:string;nodeId?:string}[]) {
  if(!entries.length)return [];
  const sources=[...files].filter(([path])=>/\.[cm]?[jt]s$/.test(path));
  if(sources.length>300||sources.reduce((n,[,s])=>n+Buffer.byteLength(s),0)>16*1024*1024)throw new ProjectDiagnostic('script-type-size','静态脚本检查最多300文件、16MiB');
  const key=digest({sdk:scriptSdk,sources:sources.map(([p,s])=>[p,String(s)]),entries});const saved=cache.get(key);if(saved)return structuredClone(saved);
  const dir=await mkdtemp(join(tmpdir(),'flowark-script-check-'));
  try{
    const runtime=await assets();await access(runtime.binary);await copyTypes(join(dir,'types'),runtime.types);
    for(const [path,source]of sources){if(path.startsWith('/')||path.split(/[\\/]/).some(p=>p==='..'))throw new ProjectDiagnostic('script-type-path','脚本路径无效',path);const target=join(dir,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,source);}
    await writeFile(join(dir,'flowark-sdk.d.ts'),scriptSdk);
    const checks:string[]=[];
    for(const [index,e]of entries.entries()){const path='__check_'+index+'.ts';checks.push(path);await writeFile(join(dir,path),'import main from '+JSON.stringify('./'+e.path.replace(/\.[jt]s$/,''))+';\nimport type {FlowArkContext,Json} from "./flowark-sdk";\nconst check: (ctx: FlowArkContext) => Promise<Json> = main;\nvoid check;\n');}
    await writeFile(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,allowJs:true,checkJs:true,skipLibCheck:true,types:['node'],typeRoots:['./types'],lib:['ES2022','DOM'],paths:{'flowark:sdk':['./flowark-sdk.d.ts']}},files:['flowark-sdk.d.ts',...checks,...sources.map(([p])=>p)]}));
    let output='';
    try{await promisify(execFile)(runtime.binary,['--project',join(dir,'tsconfig.json'),'--pretty','false'],{cwd:dir,timeout:30000,maxBuffer:2*1024*1024,env:{PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'}});}
    catch(error:any){if(error.killed||error.code===null||typeof error.code==='string')throw new ProjectDiagnostic('script-type-compiler','静态类型编译器不可用或超时，未执行脚本');output=String(error.stdout??'')+'\n'+String(error.stderr??'');}
    const issues:ScriptIssue[]=[];
    for(const line of output.split(/\r?\n/)){const m=/^(.*?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);if(m){let file=sources.find(([p])=>m[1].endsWith(p))?.[0]??m[1].replace(dir+'/',''),row=Number(m[2]),col=Number(m[3]);const check=/^__check_(\d+)\.ts$/.exec(file),e=check?entries[Number(check[1])]:entries.find(e=>e.path===file);if(check&&e){file=e.path;row=0;col=0;}issues.push({code:'script-type-TS'+m[4],message:m[5],file,entryId:e?.entryId,nodeId:e?.nodeId,...row?{line:row,column:col}:{}});}else if(line.trim()&&/error TS/.test(line))issues.push({code:'script-type-compiler',message:line.replaceAll(dir,'<static-project>')});}
    if(output.trim()&&!issues.length)throw new ProjectDiagnostic('script-type-compiler','无法解析静态编译器诊断，未执行脚本');
    if(cache.size>=24)cache.delete(cache.keys().next().value!);cache.set(key,issues);return structuredClone(issues);
  }finally{await rm(dir,{recursive:true,force:true});}
}

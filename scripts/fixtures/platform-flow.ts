import type { Flow } from '../../src/shared/types';
export const formText='fixture';export const formExpected={fullName:'fixture'};
export const formBrowser=(id:string,operation:any,selector='',value:any=null,timeoutMs=15000):any=>({id,type:'browser',version:3,operation,selector,value,framePath:[],timeoutMs});
export const formLabFlow=(url="http://127.0.0.1/"):Flow=>({formatVersion:'1.0',id:'platform-fixture',name:'Platform fixture',description:'',parameters:{},requiredCapabilities:['browser'],steps:[formBrowser('open','navigate','',url),formBrowser('fill','fill','#fullName','fixture'),formBrowser('submit','click','#submit')]});

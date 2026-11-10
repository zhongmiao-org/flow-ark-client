import {readFileSync,writeFileSync} from 'node:fs';
import {compile} from 'json-schema-to-typescript';
let types='';
for(const kind of ['request','result']){
  const schema=JSON.parse(readFileSync(new URL('../contracts/desktop-table-range-'+kind+'-v1.schema.json',import.meta.url),'utf8'));
  types+=await compile(schema,schema.title,{bannerComment:'',ignoreMinAndMaxItems:true,unknownAny:true})+'\n';
}
for(const [path,value]of [['../src/shared/desktop-table-range.generated.ts','// Generated from installed table-range helper contracts; do not edit.\n'+types],['../src/projects/desktop-table-range.generated.ts','// Generated from installed table-range helper contracts; do not edit.\nexport const desktopTableRangeTypes='+JSON.stringify(types)+';\n']]){
  const url=new URL(path,import.meta.url);let prior;try{prior=readFileSync(url,'utf8');}catch{}
  if(prior!==value)writeFileSync(url,value);
}

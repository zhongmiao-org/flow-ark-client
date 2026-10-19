/** Pure contract fixtures. No application, user record or browser execution. */
import { readFileSync } from 'node:fs';
import { assertBrowserTargetNode, assertBrowserTargetInvocation, assertBrowserTargetResult } from './browser-target-input';
const examples = JSON.parse(readFileSync(new URL('browser-target-input.cases.json', import.meta.url), 'utf8'));
let count = 0;
for (const example of examples) {
  let value = example.value;
  if (example.valueSource) {
    const source = example.valueSource;
    if (Object.keys(source).sort().join(',') !== 'count,repeat' ||
        typeof source.repeat !== 'string' || [...source.repeat].length !== 1 ||
        !Number.isSafeInteger(source.count) || source.count < 0 || source.count > 65536)
      throw Error('Invalid bounded fixture recipe');
    value = source.repeat.repeat(source.count);
  }
  let accepted = true;
  try {
    if (example.kind === 'node') assertBrowserTargetNode(value);
    else if (example.kind === 'invocation') assertBrowserTargetInvocation(example.source, value);
    else if (example.kind === 'result') assertBrowserTargetResult(example.operation, value);
    else throw Error('Unknown fixture kind');
  } catch { accepted = false; }
  if (accepted !== example.valid) throw Error('Contract fixture mismatch: ' + example.name);
  count++;
}
console.log(JSON.stringify({ scope: 'format/reference/fixed invocation/result only', count }));

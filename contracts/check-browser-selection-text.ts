/** Pure contract fixtures. No browser, application, user record or model execution. */
import { readFileSync } from 'node:fs';
import { assertBrowserSelectionTextNode, assertBrowserSelectionTextInvocation, assertBrowserSelectionTextResult, assertBrowserSelectionTextCapabilities } from './browser-selection-text';
const examples = JSON.parse(readFileSync(new URL('browser-selection-text.cases.json', import.meta.url), 'utf8'));
for (const example of examples) {
  let accepted = true;
  try {
    if (example.kind === 'node') assertBrowserSelectionTextNode(example.value);
    else if (example.kind === 'invocation') assertBrowserSelectionTextInvocation(example.source, example.value);
    else if (example.kind === 'result') assertBrowserSelectionTextResult(example.source, example.value);
    else if (example.kind === 'declaration') {
      const v = example.value;
      assertBrowserSelectionTextCapabilities(v.node, v.capabilities, { resources: v.resources }, { capabilities: v.capabilities, resources: v.entryResources });
    } else throw Error('Unknown fixture kind');
  } catch { accepted = false; }
  if (accepted !== example.valid) throw Error('Selection contract fixture mismatch: ' + example.name);
}
console.log(JSON.stringify({ scope: 'selection format/reference/fixed invocation/result only', count: examples.length }));

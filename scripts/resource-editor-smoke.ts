import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { startFormLab } from './fixtures/platform-page';
const data = await mkdtemp('/private/tmp/flowark-resources-');
const lab = await startFormLab();
const received: any[] = [];
const payload = {
  title: '虚构资源用户',
  rows: [
    ['来源', '数量'],
    ['local', 7],
  ],
};
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({
    method: req.method,
    path: req.url,
    header: req.headers['x-flowark'],
    contentType: req.headers['content-type'],
    body,
  });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/fail') {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'fixture' }));
  } else res.end(JSON.stringify(req.url === '/echo' ? { received: JSON.parse(body) } : payload));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
const book = new ExcelJS.Workbook(),
  sheet = book.addWorksheet('Report');
sheet.mergeCells('A1:C1');
sheet.getCell('A1').value = '保留模板标题';
sheet.getCell('A1').font = { bold: true };
sheet.getCell('B2').numFmt = '0.00';
book.addWorksheet('Untouched').getCell('A1').value = '保留第二张表';
await book.xlsx.writeFile(join(data, 'template.xlsx'));
const templateBefore = await readFile(join(data, 'template.xlsx'));
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
  timeout: 30000,
});
const evidence: any = { passed: false, data, checks: [] };
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).flowark);
  const call = (method: string, args: any = {}): Promise<any> =>
    page.evaluate(({ method, args }) => (window as any).flowark.request(method, args), {
      method,
      args,
    });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const label = (name: string) => page.getByLabel(name, { exact: true });
  const wait = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 20000;
    while (!(await check())) {
      if (Date.now() > end) throw new Error('资源表单验收等待超时');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const select = async (id: string) => {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await page.locator('.react-flow__controls-fitview').click();
    // At the minimum zoom, long flows extend beyond a small canvas. Pan as a user would.
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = (await page.locator('.canvas').boundingBox())!;
      const target = (await node.boundingBox())!;
      const center = target.y + target.height / 2;
      if (center >= canvas.y + 80 && center <= canvas.y + canvas.height - 60) break;
      const distance = Math.max(
        -canvas.height / 3,
        Math.min(canvas.height / 3, canvas.y + canvas.height / 2 - center),
      );
      await page.mouse.move(canvas.x + 8, canvas.y + canvas.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 8, canvas.y + canvas.height / 2 + distance, { steps: 8 });
      await page.mouse.up();
    }
    await node.click();
  };
  const add = async (name: string, title?: string) => {
    await label('搜索动作').fill(name);
    await button('添加 ' + name).click();
    if (title) await label('步骤名称').fill(title);
    return (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  };
  const ref = async (field: string, source: string, suffix = '') => {
    await button('选择变量 · ' + field).click();
    await label(field + '变量来源').selectOption(source);
    if (suffix) {
      await page
        .getByRole('group', { name: field + '变量选择', exact: true })
        .locator('summary')
        .click();
      await label(field + '变量子路径').fill(suffix);
    }
    await button('使用变量 · ' + field).click();
  };
  const literal = async (field: string, type: string, text: string) => {
    await label(field + '类型').selectOption(type);
    if (type === 'boolean') await label(field).selectOption(text);
    else if (type !== 'null') await label(field).fill(text);
  };
  const raw = () => page.locator('.node-advanced textarea').inputValue().then(JSON.parse);
  const header = async (name: string, text: string) => {
    await label('新增请求头名称').fill(name);
    await button('添加请求头条目').click();
    await literal('请求头值 ' + name, 'string', text);
  };
  const run = async (debug = false) => {
    const before = new Set((await call('bootstrap')).runs.map((r: any) => r.id));
    await button(debug ? '逐步调试' : '运行').click();
    let current: any;
    await wait(async () => {
      current = (await call('bootstrap')).runs.find((r: any) => !before.has(r.id));
      return !!current;
    });
    if (debug) {
      await wait(async () => (await call('run.detail', { id: current.id })).run.state === 'PAUSED');
      await button('执行下一步').click();
      await wait(async () => {
        const d = await call('run.detail', { id: current.id });
        return d.run.state === 'PAUSED' && d.events.some((e: any) => e.type === 'node-end');
      });
      await button('继续').click();
    }
    let detail: any;
    await wait(async () => {
      detail = await call('run.detail', { id: current.id });
      return ['SUCCEEDED', 'FAILED'].includes(detail.run.state);
    });
    return detail;
  };
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  await button('本地设置').click();
  await button('启用内置浏览器').click();
  await button('启用内置浏览器').waitFor({ state: 'hidden' });
  await button('我的流程').click();
  await button('新建流程').click();
  await page.locator('.title-input').fill('资源节点表单验收');
  await select('verify');
  await button('删除节点').click();
  await select('greeting');
  await button('删除节点').click();
  await button('参数与绑定').click();
  await label('本机浏览器').selectOption('embedded');
  await label('新参数名称').fill('payload');
  await button('添加参数').click();
  await label('参数 payload').fill('fixture');
  await label('新参数名称').fill('uploadSource');
  await button('添加参数').click();
  await literal('参数 uploadSource', 'json', '{"binding":"uploads","name":"source.txt"}');
  const get = await add('HTTP 请求', '获取本地数据');
  await label('请求地址').fill(url + '/data');
  await header('X-FlowArk', 'fixture');
  await label('新增请求头名称').fill('x-flowark');
  await button('添加请求头条目').click();
  assert.match(await page.getByRole('alert').innerText(), /重复/);
  assert.deepEqual((await raw()).headers, { 'X-FlowArk': 'fixture' });
  await label('当前请求头名称').fill('X-Trace');
  await button('更改请求头名称').click();
  assert.equal((await raw()).headers['X-Trace'], 'fixture');
  await button('撤销编辑').click();
  assert.deepEqual((await raw()).headers, { 'X-FlowArk': 'fixture' });
  const post = await add('HTTP 请求', '回传本地数据');
  await label('请求方法').selectOption('POST');
  await label('请求地址').fill(url + '/echo');
  await header('Content-Type', 'application/json');
  await ref('请求体', 'params.payload');
  await button('参数与绑定').click();
  await button('删除参数 payload').click();
  assert.match(await page.getByRole('alert').innerText(), /仍引用 params.payload/);
  assert.equal(await label('参数 payload').inputValue(), 'fixture');
  await button('节点').click();
  await ref('请求体', 'steps.' + get);
  await select(get);
  await button('删除节点').click();
  assert.match(await page.getByRole('alert').innerText(), new RegExp(post + '.*steps.' + get));
  assert.equal(await page.locator('.flow-shape[data-step-id]').count(), 2);
  await select(post);
  await button('节点上移').click();
  assert.match(await page.getByRole('alert').innerText(), new RegExp(post + '.*steps.' + get));
  assert.deepEqual((await raw()).body, { $ref: 'steps.' + get });
  evidence.checks.push('http-body-source-move-delete-and-parameter-delete-guards');
  await label('请求方法').selectOption('GET');
  assert.equal(await button('选择变量 · 请求体').count(), 0);
  assert.deepEqual((await raw()).body, { $ref: 'steps.' + get });
  await label('请求方法').selectOption('POST');
  assert.match(
    await page.getByRole('region', { name: '请求体配置', exact: true }).innerText(),
    new RegExp(get),
  );
  const write = await add('文件处理');
  await label('文件目录绑定').fill('work');
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [path] };
    }) as any;
  }, data);
  await button('选择节点文件目录').click();
  await page.getByText(data, { exact: true }).waitFor();
  await label('输出文件名').fill('source.txt');
  await ref('写入内容', 'steps.' + get, 'title');
  const read = await add('文件处理');
  await label('操作').selectOption('read');
  await label('文件目录绑定').fill('work');
  await label('读取文件名').fill('source.txt');
  assert.equal(await button('选择变量 · 写入内容').count(), 0);
  const copy = await add('文件处理');
  await label('操作').selectOption('copy');
  await label('文件目录绑定').fill('work');
  await label('目标文件名').fill('copy.txt');
  await label('源文件名').fill('source.txt');
  const archive = await add('文件处理');
  await label('操作').selectOption('archive');
  await label('文件目录绑定').fill('work');
  await label('归档文件名').fill('bundle.zip');
  await label('归档文件列表').fill('source.txt');
  await label('归档文件列表').press('End');
  await label('归档文件列表').press('Enter');
  await label('归档文件列表').pressSequentially('copy.txt');
  assert.deepEqual((await raw()).files, ['source.txt', 'copy.txt']);
  const matrix = await add('Excel 表格');
  await label('文件目录绑定').fill('work');
  await label('输出文件名').fill('matrix.xlsx');
  for (let i = 0; i < 12; i++) await button('添加数据行').click();
  for (let i = 0; i < 6; i++) await button('添加数据列').click();
  await button('下一页数据行').click();
  await button('编辑单元格 H12').click();
  await literal('单元格值', 'string', '末页保留');
  await button('上一页数据行').click();
  await button('上一组数据列').click();
  await button('编辑单元格 A1').click();
  await literal('单元格值', 'null', '');
  await button('编辑单元格 B1').click();
  await literal('单元格值', 'null', '');
  await button('编辑单元格 A2').click();
  await ref('单元格值', 'steps.' + get, 'title');
  await button('编辑单元格 B2').click();
  await literal('单元格值', 'number', '42');
  await button('编辑单元格 A3').click();
  await literal('单元格值', 'boolean', 'false');
  const matrixBefore = (await raw()).rows;
  assert.equal(matrixBefore[11][7], '末页保留');
  assert.equal(matrixBefore[2][0], false);
  await button('删除当前数据行').click();
  await button('撤销编辑').click();
  assert.deepEqual((await raw()).rows, matrixBefore);
  await button('编辑单元格 B2').click();
  await button('删除当前数据列').click();
  await button('撤销编辑').click();
  assert.deepEqual((await raw()).rows, matrixBefore);
  const readMatrix = await add('Excel 表格');
  await label('操作').selectOption('read');
  await label('文件目录绑定').fill('work');
  await label('读取文件名').fill('matrix.xlsx');
  await add('Excel 表格');
  await label('文件目录绑定').fill('work');
  await label('输出文件名').fill('matrix-copy.xlsx');
  await ref('行列数据', 'steps.' + readMatrix);
  const rereadMatrix = await add('Excel 表格');
  await label('操作').selectOption('read');
  await label('文件目录绑定').fill('work');
  await label('读取文件名').fill('matrix-copy.xlsx');
  await add('结果断言', '核对 H12 原始位置');
  await ref('判断值', 'steps.' + readMatrix, '11.7');
  await literal('比较值', 'string', '末页保留');
  await add('结果断言', '核对另存的全部行列');
  await ref('判断值', 'steps.' + rereadMatrix);
  await ref('比较值', 'steps.' + readMatrix);
  const fetched = await add('Excel 表格');
  await label('文件目录绑定').fill('work');
  await label('输出文件名').fill('http.xlsx');
  await ref('行列数据', 'steps.' + get, 'rows');
  assert.equal(await page.getByRole('table', { name: 'Excel 数据表格' }).count(), 0);
  const readExcel = await add('Excel 表格');
  await label('操作').selectOption('read');
  await label('文件目录绑定').fill('work');
  await label('读取文件名').fill('http.xlsx');
  const verify = await add('结果断言', '核对读取行列');
  await ref('判断值', 'steps.' + readExcel);
  await ref('比较值', 'steps.' + get, 'rows');
  const fill = await add('Excel 表格');
  await label('操作').selectOption('fill');
  await label('文件目录绑定').fill('work');
  await label('输出文件名').fill('filled.xlsx');
  await label('模板文件名').fill('template.xlsx');
  await label('工作表名称').fill('Report');
  await label('当前单元格映射名称').fill('A2');
  await button('更改单元格映射名称').click();
  await ref('单元格映射值 A2', 'steps.' + get, 'title');
  await label('新增单元格映射名称').fill('a2');
  await button('添加单元格映射条目').click();
  assert.match(await page.getByRole('alert').innerText(), /重复/);
  await label('新增单元格映射名称').fill('XFE1');
  await button('添加单元格映射条目').click();
  assert.match(await page.getByRole('alert').innerText(), /边界/);
  await label('新增单元格映射名称').fill('B2');
  await button('添加单元格映射条目').click();
  await literal('单元格映射值 B2', 'number', '42');
  await label('新增单元格映射名称').fill('C2');
  await button('添加单元格映射条目').click();
  await literal('单元格映射值 C2', 'json', '{"formula":"B2*2","result":84}');
  const fillBefore = await raw();
  await label('操作').selectOption('read');
  assert.equal((await raw()).version, 1);
  assert.ok(!('cells' in (await raw())));
  await button('撤销编辑').click();
  assert.deepEqual(await raw(), fillBefore);
  await add('打开网页', '打开上传表单');
  await label('网页地址').fill(lab.url);
  await add('选择上传文件', '上传生成文本');
  await label('目标元素选择器').fill('#attachment');
  await ref('上传文件', 'params.uploadSource');
  await button('运行').click();
  await page.getByRole('alert').filter({ hasText: '未绑定文件目录：uploads' }).waitFor();
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(received.length, 0);
  await assert.rejects(access(join(data, 'source.txt')), { code: 'ENOENT' });
  await button('参数与绑定').click();
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [path] };
    }) as any;
  }, data);
  await button('选择 uploads 目录').click();
  evidence.checks.push('parameter-upload-binding-discovery-and-admission-before-side-effects');
  assert.equal((await call('bootstrap')).runs.length, 0);
  assert.equal(received.length, 0);
  assert.equal(lab.state.attempts, 0);
  await button('保存').click();
  let saved: any;
  await wait(async () => {
    saved = (await call('bootstrap')).flows.find((f: any) => f.flow.name === '资源节点表单验收');
    return saved?.flow.steps.length === 18 && saved?.bindings.files.uploads === data;
  });
  assert.equal(saved.bindings.files.work, data);
  assert.equal(saved.bindings.files.uploads, data);
  assert.deepEqual(saved.flow.steps.find((n: any) => n.id === matrix).rows, matrixBefore);
  evidence.checks.push('form-only-setup-directory-binding-maps-matrix-paging-and-history');
  await button('我的流程').click();
  await button('编辑 资源节点表单验收').click();
  await select(matrix);
  assert.deepEqual((await raw()).rows, matrixBefore);
  await button('打开网页面板').click();
  await label('网页地址').fill(lab.url);
  await button('访问网页').click();
  await wait(async () => (await call('browser.embedded.status')).url === new URL(lab.url).href);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 700));
  assert.ok(
    await page.evaluate(() =>
      ['main', '.inspector', '.matrix-values'].every((s) => {
        const e = document.querySelector(s)!;
        return e.scrollWidth <= e.clientWidth + 1;
      }),
    ),
  );
  await mkdir('test-results', { recursive: true });
  await page.getByRole('table', { name: 'Excel 数据表格' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/resource-editor.png' });
  const detail = await run(true);
  assert.equal(detail.run.state, 'SUCCEEDED', detail.run.error);
  assert.equal(received.length, 2);
  assert.equal(received[0].method, 'GET');
  assert.equal(received[0].header, 'fixture');
  assert.equal(received[0].body, '');
  assert.equal(received[1].method, 'POST');
  assert.equal(received[1].contentType, 'application/json');
  assert.deepEqual(JSON.parse(received[1].body), payload);
  assert.deepEqual(detail.output[post], { received: payload });
  assert.equal(detail.output[read], payload.title);
  assert.equal(await readFile(join(data, 'source.txt'), 'utf8'), payload.title);
  assert.equal(await readFile(join(data, 'copy.txt'), 'utf8'), payload.title);
  const zip = await JSZip.loadAsync(await readFile(join(data, 'bundle.zip')));
  assert.deepEqual(Object.keys(zip.files).sort(), ['copy.txt', 'source.txt']);
  assert.equal(await zip.file('copy.txt')!.async('string'), payload.title);
  const matrixBook = new ExcelJS.Workbook();
  await matrixBook.xlsx.readFile(join(data, 'matrix.xlsx'));
  const written = matrixBook.worksheets[0];
  assert.equal(written.getCell('A2').value, payload.title);
  assert.equal(written.getCell('B2').value, 42);
  assert.equal(written.getCell('A3').value, false);
  assert.equal(written.getCell('H12').value, '末页保留');
  const expectedMatrix: unknown[][] = Array.from({ length: 14 }, () => []);
  expectedMatrix[1] = [payload.title, 42];
  expectedMatrix[2] = [false];
  expectedMatrix[11] = [null, null, null, null, null, null, null, '末页保留'];
  assert.deepEqual(detail.output[readMatrix], expectedMatrix);
  assert.deepEqual(detail.output[rereadMatrix], expectedMatrix);
  const copiedMatrix = new ExcelJS.Workbook();
  await copiedMatrix.xlsx.readFile(join(data, 'matrix-copy.xlsx'));
  const copiedSheet = copiedMatrix.worksheets[0];
  assert.equal(copiedSheet.rowCount, 14, 'explicit trailing blank rows remain in the file');
  assert.equal(copiedSheet.getCell('A1').value, null);
  assert.equal(copiedSheet.getCell('A2').value, payload.title);
  assert.equal(copiedSheet.getCell('A3').value, false);
  assert.equal(copiedSheet.getCell('A11').value, null);
  assert.equal(copiedSheet.getCell('H12').value, '末页保留');
  assert.equal(copiedSheet.getCell('G12').value, null, 'empty leading columns do not shift H12');
  assert.ok(detail.artifacts.some((item: any) => item.name === 'matrix-copy.xlsx'));
  evidence.checks.push(
    'blank-leading-middle-trailing-rows-and-h12-retained-through-read-reference-write',
  );
  const filled = new ExcelJS.Workbook();
  await filled.xlsx.readFile(join(data, 'filled.xlsx'));
  const report = filled.getWorksheet('Report')!;
  assert.equal(report.getCell('A1').value, '保留模板标题');
  assert.equal(report.getCell('A1').font.bold, true);
  assert.equal(report.getCell('A2').value, payload.title);
  assert.equal(report.getCell('B2').value, 42);
  assert.equal(report.getCell('B2').numFmt, '0.00');
  assert.deepEqual(report.getCell('C2').value, { formula: 'B2*2', result: 84 });
  assert.equal(filled.getWorksheet('Untouched')!.getCell('A1').value, '保留第二张表');
  assert.deepEqual(await readFile(join(data, 'template.xlsx')), templateBefore);
  const uploaded = await app.evaluate(async ({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.executeJavaScript(
      "document.querySelector('#attachment').files[0].text()",
    ),
  );
  assert.equal(uploaded, payload.title);
  assert.equal(
    await app.evaluate(async ({ BrowserWindow }) =>
      (
        BrowserWindow.getAllWindows()[0].contentView.children[0] as any
      ).webContents.executeJavaScript('innerWidth'),
    ),
    1920,
  );
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('real-http-bytes-zip-excel-template-and-embedded-upload');
  await button('我的流程').click();
  await button('编辑 资源节点表单验收').click();
  await select(get);
  await label('请求地址').fill(url + '/fail');
  const failed = await run();
  assert.equal(failed.run.state, 'FAILED');
  assert.match(failed.run.error, /HTTP 503/);
  assert.equal(received.filter((r) => r.path === '/fail').length, 1);
  assert.equal(failed.events.filter((e: any) => e.type === 'node-start').length, 1);
  await button('我的流程').click();
  await button('编辑 资源节点表单验收').click();
  await select(get);
  await label('请求地址').fill(url + '/data');
  await select(write);
  const outside = 'escape-' + basename(data) + '.txt';
  await label('输出文件名').fill('../' + outside);
  const escaped = await run();
  assert.equal(escaped.run.state, 'FAILED');
  assert.match(escaped.run.error, /绑定目录内/);
  assert.equal(escaped.events.filter((e: any) => e.type === 'node-start').length, 3);
  await assert.rejects(access(join(data, '..', outside)));
  assert.equal(lab.state.attempts, 0);
  evidence.checks.push('http-failure-no-retry-and-path-scope-stop');
  evidence.passed = true;
  evidence.runId = detail.run.id;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/resource-editor.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  console.log(JSON.stringify(evidence));
}

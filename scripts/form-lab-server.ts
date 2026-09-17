import { startFormLab } from './fixtures/form-lab';
const port = Number(process.env.FLOWARK_FORM_LAB_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('测试端口必须为 1024～65535');
const lab = await startFormLab(port);
console.log(`FlowArk 表单实验室: ${lab.url}`);
console.log(`练习流程: ${lab.url}/example.template.json`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void lab.close().then(() => process.exit(0));
  });

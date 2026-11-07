import { readAuthoringSkill, authoringSkill } from '../projects/authoring-skill';
import { getAuthoring } from '../projects/authoring';
import { projectAIContext } from './project-ai-context';
import { randomUUID } from 'node:crypto';
import { resolve, relative, dirname, basename } from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import Ajv from 'ajv/dist/2020.js';
import { generate } from '../ai/providers';
import { callProjectTool, projectGuide, projectAITools as projectTools } from '../projects/tools';
import { ProjectDiagnostic } from '../projects/configuration';
import type { Store } from './store';
import { projectInfo, buildProject } from '../projects/project';
import { redactedErrorText, digest } from '../shared/utils';
export const projectAIConnection = z.discriminatedUnion('provider', [
  z.object({ provider: z.enum(['deepseek', 'openai-codex']) }).strict(),
  z.object({ provider: z.literal('compatible'), baseUrl: z.string().url().max(2048),
    protocol: z.enum(['responses', 'chat-completions']), model: z.string().min(1).max(100),
    credentialId: z.union([z.string().regex(/^local-[a-f0-9-]{36}$/), z.enum(['deepseek', 'openai-codex'])]) }).strict(),
]);
type Connection = z.infer<typeof projectAIConnection>;
type Task = { id: string; projectId: string; root: string; task: string; state: 'running' | 'complete' | 'question' | 'failed' | 'cancelled' | 'budget-exhausted' | 'interrupted';
  stage?: string; authoring?: any; connection: Connection; maxRequests: number; durationMs: number; requests: number; at: string; updatedAt: string;
  stall?: { fingerprint: string; count: number; tool?: string }; nextStep?: string; diagnostics?: any[];
  message: string; history: { kind: string; value: unknown }[]; paidRetryRequired?: boolean };
export class ProjectAI {
  private active = new Map<string, { task: Task; abort: AbortController; done: Promise<void> }>();
  constructor(private store: Store, private system: (method: string, args: any) => Promise<any>,
    private project: (id: string) => Promise<{ root: string }>,
    private runtime: (method: string, args: any) => Promise<any>, private chargeDesktop: (projectId: string) => void = () => {}) {
    for (const task of store.list<Task>('project-ai-task')) if (task.state === 'running') this.persist({ ...task, state: 'interrupted', message: '上次开发任务已中断，未自动调用模型或重放工具。' });
  }
  private noProgress(task: Task, tool: string, result: any, revision: string) {
    const errors = result?.diagnostics ?? (result?.diagnostic ? [result.diagnostic] : result?.error ? [{ code: 'tool-error', message: result.error }] : []);
    if (!errors.length) {if(result?.valid===true){if(task.stall?.tool===tool)task.stall=undefined;task.diagnostics=undefined;task.nextStep=result.assembledRevision?'核对资源与运行方案，再读取实际Run回执。':'继续其余节点代码，全部就绪后组装。';}return false;}
    const fingerprint = digest({ tool, errors });
    task.stall = task.stall?.fingerprint === fingerprint ? { fingerprint, count: task.stall.count + 1, tool } : { fingerprint, count: 1, tool };
    task.diagnostics = errors;
    task.nextStep = '按诊断修改对应节点；必要时调整规划，再继续开发。';
    if (task.stall.count < 3) return false;
    task.state = 'question';
    task.message = '连续三次相同诊断且无有效进展，已暂停模型循环；草稿和历史保留。';
    task.nextStep = '修改需求、规划或节点实现后，使用补充说明继续；未重放任何外发。';
    task.history.push({ kind: 'no-progress-stop', value: { ...task.stall, tool, revision } });
    return true;
  }
  private persist(task: Task) { task.updatedAt = new Date().toISOString(); this.store.put('project-ai-task', task.id, task); }
  usesProvider(provider: string) { return [...this.active.values()].some(v => v.task.connection.provider === provider || (v.task.connection.provider === 'compatible' && v.task.connection.credentialId === provider)); }
  async stopAll() { for (const v of this.active.values()) v.abort.abort(); await Promise.allSettled([...this.active.values()].map(v => v.done)); }
  get(projectId: string) {
    return { skill: authoringSkill, connection: this.store.get<Connection>('project-ai-connection', projectId) ?? { provider: 'deepseek' },
      tasks: this.store.list<Task>('project-ai-task').filter(t => t.projectId === projectId).map(({ history, ...t }) => ({ ...t, retryableTool: this.retryableTool({ ...t, history }), paidRetryRequired: t.paidRetryRequired && !t.message.startsWith('格式无效 (AIRequest)'), steps: history.length })) };
  }
  async save(projectId: string, connection: unknown) {
    await this.project(projectId);
    if ([...this.active.values()].some(v => v.task.projectId === projectId)) throw Error('请先结束当前AI开发任务');
    const value = projectAIConnection.parse(connection);
    if (value.provider === 'compatible') {
      const url = new URL(value.baseUrl);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash)
        throw Error('接口须为HTTPS或显式本机HTTP，不包含凭据、查询及片段');
    }
    this.store.put('project-ai-connection', projectId, value); return this.get(projectId);
  }
  async start(projectId: string, taskText: string, maxRequests: number, durationMs: number, reviewedCost: boolean) {
    if (!reviewedCost || !taskText.trim() || taskText.length > 12000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 100 || durationMs < 10000 || durationMs > 3600000)
      throw Error('请核对需求、调用预算和费用后开始');
    if (/\bsk-[a-zA-Z0-9]{24,}|-----BEGIN .*PRIVATE KEY/.test(taskText)) throw Error('不要在需求中填写密钥，请使用受保护凭据配置');
    if ([...this.active.values()].some(v => v.task.projectId === projectId)) throw Error('本工程已有AI任务');
    const project = await this.project(projectId), connection = this.get(projectId).connection as Connection;
    const task: Task = { id: randomUUID(), projectId, root: project.root, task: taskText.trim(), connection,
      state: 'running', requests: 0, maxRequests, durationMs, at: new Date().toISOString(), updatedAt: '', message: '准备读取工程与工具规范', history: [] };
    this.persist(task);
    const abort = new AbortController(), item = { task, abort, done: Promise.resolve() };
    this.active.set(task.id, item); item.done = this.execute(task, abort).finally(() => this.active.delete(task.id));
    return { id: task.id, state: task.state };
  }
  async resume(projectId: string, taskId: string, answer: string, maxRequests: number, durationMs: number, reviewedCost: boolean) {
    const previous = this.detail(projectId, taskId);
    if (!reviewedCost || !answer.trim() || answer.length > 12000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 100 || durationMs < 10000 || durationMs > 3600000)
      throw Error('请填写补充说明并核对本批调用预算和费用');
    if (previous.state === 'running' || previous.state === 'complete') throw Error('当前任务无需续接');
    if (previous.paidRetryRequired && !previous.message.startsWith('格式无效 (AIRequest)')) throw Error('上次模型调用失败；请先核对错误和具体付费重试，不自动续接');
    if ([...this.active.values()].some(v => v.task.projectId === projectId)) throw Error('本工程已有AI任务');
    if (/\bsk-[a-zA-Z0-9]{24,}|-----BEGIN .*PRIVATE KEY/.test(answer)) throw Error('不要在回答中填写密钥');
    const task: Task = { ...previous, id: randomUUID(), state: 'running', requests: 0, maxRequests, durationMs,
      paidRetryRequired: false, stall: undefined, diagnostics: undefined, nextStep: undefined, at: new Date().toISOString(), history: [...previous.history, { kind: 'user-continuation', value: { parentTaskId: previous.id, answer } }], message: '从已保存进度继续；不重放已有工具' };
    this.persist(task);
    const abort = new AbortController(), item = { task, abort, done: Promise.resolve() };
    this.active.set(task.id, item); item.done = this.execute(task, abort).finally(() => this.active.delete(task.id));
    return { id: task.id, state: task.state };
  }
  async cancel(id: string) { const task = this.active.get(id); if (!task) return false; task.abort.abort(); await task.done; return true; }
  detail(projectId: string, taskId: string) { const task = this.store.get<Task>('project-ai-task', taskId); if (!task || task.projectId !== projectId) throw Error('AI任务不属于本工程'); return task; }
  private retryableTool(task: Task) {
    const last = task.history.at(-1), model = [...task.history].reverse().find(h => h.kind === 'model')?.value as any;
    return !this.active.has(task.id) && last?.kind === 'tool-validation' && (last.value as any)?.executed === false &&
      model?.action?.action === 'tool' && ['flowark_project_package', 'flowark_project_from_zip'].includes(model.action.tool) &&
      model.action.tool === (last.value as any).name;
  }
  async retryTool(projectId: string, taskId: string) {
    const task = this.detail(projectId, taskId);
    if (!this.retryableTool(task)) throw Error('仅允许重试尚未执行的本地打包/复导校验请求，不重放运行或外发');
    const action = ([...task.history].reverse().find(h => h.kind === 'model')!.value as any).action;
    const rule = projectTools.find(t => t.name === action.tool)!;
    const args: Record<string, any> = { ...action.arguments };
    const validate = new Ajv({ strict: false, logger: false }).compile(rule.inputSchema);
    if (!validate(args)) throw Error('工具参数仍不符合已安装Schema，未执行');
    for (const field of ['root', 'destination', 'zip']) if (args[field] !== undefined) {
      if (typeof args[field] !== 'string') throw Error('无效工具路径');
      let path = resolve(args[field] as string), suffix: string[] = [];
      while (true) { try { path = await realpath(path); break; } catch (error: any) {
        if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
        suffix.unshift(basename(path)); path = dirname(path);
      } }
      const rel = relative(task.root, resolve(path, ...suffix));
      if (rel.startsWith('..') || rel.startsWith('/')) throw Error('工具目标不属于本人选择的工程');
    }
    // Reserve the local retry before awaiting I/O. A crash/error never re-enables it.
    task.history.push({ kind: 'local-tool-retry-reserved', value: { name: action.tool, modelRequestsAdded: 0 } }); this.persist(task);
    try {
      const result = await callProjectTool(action.tool, args);
      task.history.push({ kind: 'local-tool-retry-result', value: { name: action.tool, result, modelRequestsAdded: 0 } });
      task.message = '尚未执行的本地工具已重试并保存结果；未新增模型请求，既有预算终态保留。'; this.persist(task);
      return { result, modelRequestsAdded: 0 };
    } catch (error) { task.history.push({ kind: 'local-tool-retry-error', value: { name: action.tool, error: redactedErrorText(error), modelRequestsAdded: 0 } }); this.persist(task); throw error; }
  }
  private async execute(task: Task, abort: AbortController) {
    let secret = '';
    const deadline = setTimeout(() => abort.abort('deadline'), task.durationMs);
    const actionSchema = { type: 'object', additionalProperties: false, required: ['action', 'tool', 'arguments', 'message'], properties: {
      action: { enum: ['tool', 'complete', 'question'] }, tool: { type: 'string' }, arguments: { type: 'object' }, message: { type: 'string' } } };
    const ajv = new Ajv({ strict: false, logger: false }), validators = new Map(projectTools.map(t => [t.name, ajv.compile(t.inputSchema)]));
    try {
      let key: string, model: string, provider: 'deepseek' | 'openai-codex', endpoint: { baseUrl: string; protocol: 'responses' | 'chat-completions' } | undefined;
      if (task.connection.provider === 'compatible') {
        const id = task.connection.credentialId;
        if (id === 'deepseek' || id === 'openai-codex') {
          const saved = await this.system('ai.configuration.read', { provider: id });
          if (!saved.configured) throw Error('选定的已有服务尚未配置Key');
          key = await this.system('credentials.get', { id, revision: saved.revision });
        } else key = await this.system('credentials.get', { id });
        model = task.connection.model;
        provider = 'openai-codex'; endpoint = { baseUrl: task.connection.baseUrl, protocol: task.connection.protocol };
      } else {
        const configuration = await this.system('ai.configuration.read', { provider: task.connection.provider });
        if (!configuration.configured) throw Error('请先配置本人AI服务和Key');
        key = await this.system('credentials.get', { id: task.connection.provider, revision: configuration.revision });
        provider = task.connection.provider; model = configuration.model;
      }
      secret = key;
      const context = await callProjectTool('flowark_project_context', { root: task.root });
      task.history.push({ kind: 'initial-project-context', value: { name: 'flowark_project_context', result: context } }); this.persist(task);
      const skill = await readAuthoringSkill();
      const instruction = skill.content + '\n' + projectGuide + '\nYou are the FlowArk project developer. Follow the bundled Skill as the single stage policy. Use full flowark_authoring_* tool names. Do not handwrite manifest/Mermaid/bindings or use runtime node schemas. The private draft is not an executable project. Use installed schemas before writing nodes. The initial-project-context already contains the public source and SDK; do not read those same files again unless their revision changes. Reuse tool documents and contextDefinition schema references in the input. Return exactly one JSON action. Never claim runtime success without receipts. Read-only tools and edits inside the chosen project are allowed; runtime actions require separate user review. When a requirement needs facts from the user, return question. Do not repeat unknown effects. End when the requested artifact and checks are available. Mode: structured tool instructions (not native function calls).\nTools:\n' + JSON.stringify(projectTools);
      while (task.requests < task.maxRequests) {
        abort.signal.throwIfAborted();
        const info = await projectInfo(task.root);
        // Tool responses use the same JSON transport representation as external MCP.
        // Optional undefined properties are absent, never passed as invalid AI JSON.
        const input = JSON.parse(JSON.stringify({ task: task.task, currentAuthoring: task.authoring, nextStep: task.nextStep, project: { ...info, root: task.root }, context: projectAIContext(task.history) }));
        if (Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) { task.state = 'budget-exhausted'; task.message = '去重后的模型上下文达到256KiB范围，完整审计仍保留，未静默裁剪。'; break; }
        this.chargeDesktop(task.projectId);
        task.requests++; task.message = '模型请求 ' + task.requests + '/' + task.maxRequests; this.persist(task);
        let response;
        try { response = await generate({ provider, model, instructions: instruction, input: input as any, schema: actionSchema }, key, abort.signal, fetch, [], 'planning', true,
          provider === 'deepseek' ? { thinking: 'disabled', maxOutputTokens: 8192 } : undefined, endpoint); }
        catch (error) { task.paidRetryRequired = !(error instanceof Error && error.message.startsWith('格式无效 (AIRequest)')); throw error; }
        const action = response.output as any; task.history.push({ kind: 'model', value: { requestId: response.requestId, model: response.model, usage: response.usage, action } }); this.persist(task);
        if (action.action !== 'tool') {
          if (action.action === 'complete') {
            if (task.authoring?.draftId) { const draft = await getAuthoring(task.root,task.authoring.draftId); if (!draft.assembledRevision) { task.history.push({ kind: 'stage-diagnostic', value: { code: 'authoring-not-assembled', message: '尚未组装当前规划，不能把原工程当作新方案完成', draftId: draft.draftId, draftRevision: draft.draftRevision } }); const stop=this.noProgress(task,'complete',{diagnostics:[{code:'authoring-not-assembled',message:'当前草稿尚未组装'}]},digest({project:info.revision,plan:draft.plan,scripts:draft.scripts}));this.persist(task);if(stop)break;continue; } }
            let checked;
            try { checked = await buildProject(task.root); }
            catch(error){const result=error instanceof ProjectDiagnostic?{diagnostic:error.toJSON()}:{error:redactedErrorText(error,secret?[secret]:[])};task.history.push({kind:'tool',value:{name:'final-static-check',result}});const stop=this.noProgress(task,'complete',result,info.revision);this.persist(task);if(stop)break;continue;}
            task.history.push({ kind: 'final-static-check', value: { revision: checked.snapshot.revision, valid: true, businessAccepted: false } });
          }
          task.state = action.action; task.message = action.message; break;
        }
        try {
        const rule = validators.get(action.tool);
        if (!rule) throw new ProjectDiagnostic('unknown-tool', '模型请求未知工具');
        const args: Record<string, any> = { ...action.arguments };
        if (projectTools.find(t => t.name === action.tool)?.inputSchema.properties && 'root' in projectTools.find(t => t.name === action.tool)!.inputSchema.properties) args.root ??= task.root;
        if (!rule(args)) throw new ProjectDiagnostic('tool-arguments', ajv.errorsText(rule.errors));
        for (const field of ['root', 'destination', 'zip']) if (args[field] !== undefined) {
          if (typeof args[field] !== 'string') throw Error('无效工具路径');
          let path = resolve(args[field] as string), suffix: string[] = [];
          while (true) {
            try { path = await realpath(path); break; } catch (error: any) {
              if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
              suffix.unshift(basename(path)); path = dirname(path);
            }
          }
          path = resolve(path, ...suffix);
          const rel = relative(task.root, path);
          if (rel.startsWith('..') || rel.startsWith('/')) throw Error('工具目标不属于本人选择的工程');
        }
        abort.signal.throwIfAborted();
        task.stage = ({flowark_authoring_plan:'节点规划',flowark_authoring_code:'节点代码',flowark_authoring_assemble:'校验与组装',flowark_project_package:'打包',flowark_runtime_run:'运行'} as Record<string,string>)[action.tool] ?? task.stage;
        task.message = action.tool; this.persist(task);
        let result: any;
        try {
          const runtimeMethods: Record<string, string> = { history: 'project.run.history', configure: 'project.configure', prepare: 'project.prepare', instance: 'project.instance', preview: 'project.run.preview', run: 'project.run.request', status: 'project.run.status', control: 'project.run.control' };
          if (action.tool.startsWith('flowark_runtime_')) {
            const { root, ...rest } = args; result = await this.runtime(runtimeMethods[action.tool.slice(16)], { ...rest, id: task.projectId });
          } else result = await callProjectTool(action.tool, args);
        } catch (error) { result = { error: error instanceof Error ? error.message : String(error), ...(error instanceof ProjectDiagnostic ? { diagnostic: error.toJSON() } : {}), retryExternalEffects: false, suggestion: '按file/field/line定位修复对应规划或脚本，原工程校验通过不代表未组装的草稿通过。' }; }
        if (action.tool.startsWith('flowark_authoring_') && result?.draftId) { const state = result.plan ? result : await getAuthoring(task.root,result.draftId); task.authoring = { draftId: state.draftId, draftRevision: state.draftRevision, stage: state.stage, summary: state.summary, plan: state.plan, scripts: state.scripts, assembledRevision: state.assembledRevision }; }
        task.history.push({ kind: 'tool', value: { name: action.tool, result } });
        const stopped=this.noProgress(task, action.tool, result, digest({project:(await projectInfo(task.root)).revision, plan:task.authoring?.plan, scripts:task.authoring?.scripts?.map((s:any)=>({entryId:s.entryId,nodeId:s.nodeId,sha256:s.sha256}))}));
        this.persist(task); if(stopped) break;
        } catch (error) {
          task.history.push({ kind: 'tool-validation', value: { name: action.tool, error: redactedErrorText(error, secret ? [secret] : []), executed: false, allowedRoot: task.root } });
          const stopped=this.noProgress(task,action.tool,{error:redactedErrorText(error,secret?[secret]:[])},info.revision);
          this.persist(task); if(stopped) break;
        }
      }
      if (task.state === 'running') { task.state = 'budget-exhausted'; task.message = '达到本批调用预算，进度已保存。'; }
    } catch (error) {
      task.state = abort.signal.aborted ? abort.signal.reason === 'deadline' ? 'budget-exhausted' : 'cancelled' : 'failed';
      task.message = abort.signal.aborted ? '开发任务已停止，已提交操作与记录保留，不自动重试。' : redactedErrorText(error, secret ? [secret] : []);
    } finally { clearTimeout(deadline); this.persist(task); }
  }
}

import {
  connectionMethods,
  type ConnectionCandidate,
  type ConnectionConfig,
  type ConnectionDiscovery,
  type ToolConnection,
  type OAuthInspection,
} from '../shared/tool-connections';
import { discoverMcp, DiscoveryError, McpCleanupError } from '../adapters/mcp-discovery';
import { callMcp } from '../adapters/mcp-call';
import { inspectMcpOAuth, OAuthInspectionError } from '../adapters/mcp-oauth-inspection';
import { authorizeMcpOAuth, refreshMcpOAuth } from '../adapters/mcp-oauth-authorization';
import { oauthGrant, oauthSummary } from '../shared/mcp-oauth-grant';
import type { TaskMcpTarget } from '../shared/task-mcp-targets';
import type { McpToolResult } from '../shared/mcp-run';
import { Store } from './store';
import { canonical, uid } from '../shared/utils';
import type { PlanningTask } from '../shared/planning';
import type { Run } from '../shared/types';

type Saved = ConnectionDiscovery & {
  id: string;
  revision: number;
  config: ConnectionConfig;
  credentialRef?: string;
  disconnected?: boolean;
  oauth?: import('../shared/tool-connections').OAuthSummary;
  oauthRefreshPending?: boolean;
};
type Candidate = ConnectionCandidate & { secret?: string; saving?: boolean };
type Job = {
  abort: AbortController;
  connectionId?: string;
  promise: Promise<ConnectionCandidate | OAuthInspection>;
};
export class ToolConnections {
  private inspections = new Map<string, OAuthInspection>();
  private jobs = new Map<string, Job>();
  private calls = new Map<
    string,
    {
      connectionId: string;
      abort: AbortController;
      promise: Promise<McpToolResult>;
    }
  >();
  private assertIdle(id: string) {
    if ([...this.calls.values()].some((call) => call.connectionId === id))
      throw new Error('此连接仍有工具调用正在执行或收尾，请等待完成后再更改连接');
  }
  private async settleCalls(id?: string) {
    const pending = [...this.calls.values()].filter((call) => !id || call.connectionId === id);
    for (const call of pending) call.abort.abort();
    await Promise.all(pending.map((call) => call.promise.catch(() => {})));
    if (this.cleanupFault) throw new Error('工具会话关闭尚未确认，请退出应用并核对');
  }
  async call(
    target: TaskMcpTarget,
    input: {
      tool: string;
      arguments: Record<string, unknown>;
      signal: AbortSignal;
      timeoutMs: number;
      beforeSend: () => void;
    },
  ): Promise<McpToolResult> {
    this.targetSource(target.connectionId, target.connectionRevision);
    this.assertIdle(target.connectionId);
    if (
      [...this.jobs.values()].some((job) => job.connectionId === target.connectionId) ||
      [...this.candidates.values()].some(
        (candidate) => candidate.connectionId === target.connectionId,
      )
    )
      throw new Error('连接正在重新核对，请先完成连接设置');
    const record = this.record(target.connectionId, target.connectionRevision);
    const abort = new AbortController();
    const signal = AbortSignal.any([input.signal, abort.signal]);
    const id = uid();
    const job = { connectionId: record.id, abort, promise: undefined! as Promise<McpToolResult> };
    this.calls.set(id, job);
    job.promise = Promise.resolve().then(async () => {
      let secret: string | undefined;
      const current = () => {
        signal.throwIfAborted();
        const current = this.targetSource(target.connectionId, target.connectionRevision);
        if (current.capabilityDigest !== target.capabilityDigest)
          throw new Error('工具能力已变化，请重新核对');
      };
      try {
        if (record.credentialRef) secret = await this.credential(record, signal);
        current();
        return await callMcp({
          ...input,
          config: record.config,
          token: secret,
          signal,
          capabilityDigest: target.capabilityDigest,
          beforeSend: () => {
            current();
            input.beforeSend();
          },
        });
      } catch (error) {
        if (error instanceof McpCleanupError) this.cleanupFault = true;
        if (error instanceof DiscoveryError || error instanceof OAuthInspectionError) throw error;
        throw new Error('工具调用未能取得可确认的回复，请查看本次回执；未自动重试');
      } finally {
        secret = undefined;
        this.calls.delete(id);
      }
    });
    return job.promise;
  }
  private async credential(record: Saved, signal: AbortSignal): Promise<string> {
    if (!record.credentialRef) throw new OAuthInspectionError('请重新登录授权');
    const value = await this.deps.credentials.get(record.credentialRef);
    if (record.config.transport.type !== 'http' || record.config.transport.auth !== 'oauth')
      return value;
    let grant;
    try {
      grant = oauthGrant.parse(JSON.parse(value));
    } catch {
      throw new OAuthInspectionError('OAuth 凭据无效，请重新授权');
    }
    const binding = record.config.transport.oauth;
    if (
      record.oauthRefreshPending ||
      grant.url !== record.config.transport.url ||
      grant.issuer !== binding?.issuer ||
      grant.clientId !== binding.clientId
    )
      throw new OAuthInspectionError('OAuth 登录需要重新授权，请检查连接配置');
    if (grant.expiresAt === undefined || grant.expiresAt > this.time() + 30000)
      return grant.accessToken;
    if (!grant.refreshToken) throw new OAuthInspectionError('登录已过期，请重新授权');
    this.record(record.id, record.revision);
    signal.throwIfAborted();
    this.store.put('mcp-connection', record.id, { ...record, oauthRefreshPending: true });
    let nextRef: string | undefined;
    let committed = false;
    try {
      const next = await refreshMcpOAuth(grant, signal);
      signal.throwIfAborted();
      this.record(record.id, record.revision);
      nextRef = 'mcp-' + uid();
      await this.deps.credentials.set(nextRef, JSON.stringify(next));
      signal.throwIfAborted();
      const current = this.record(record.id, record.revision);
      this.store.put('mcp-connection', record.id, {
        ...current,
        credentialRef: nextRef,
        oauth: oauthSummary(next),
        oauthRefreshPending: false,
      });
      committed = true;
      await this.deps.credentials.remove(record.credentialRef).catch(() => {});
      return next.accessToken;
    } catch {
      this.states.set(record.id, 'failed');
      throw new OAuthInspectionError('登录刷新未完成，请重新授权；未自动重试');
    } finally {
      if (!committed && nextRef) await this.deps.credentials.remove(nextRef).catch(() => {});
    }
  }
  private candidates = new Map<string, Candidate>();
  private states = new Map<string, ToolConnection['status']>();
  private removing = new Set<string>();
  private cleanupFault = false;
  constructor(
    private store: Store,
    private deps: {
      assertAvailable: () => void;
      credentials: {
        get: (id: string) => Promise<string>;
        set: (id: string, value: string) => Promise<void>;
        remove: (id: string) => Promise<void>;
      };
      openOAuth?: (url: string) => Promise<void>;
      discover?: typeof discoverMcp;
      time?: () => number;
    },
  ) {}
  clean() {
    return !this.cleanupFault;
  }
  private time() {
    return this.deps.time?.() ?? Date.now();
  }
  private available() {
    this.deps.assertAvailable();
    if (this.cleanupFault) throw new Error('MCP 程序回收未确认，请退出应用后核对');
  }
  private record(id: string, revision?: number) {
    if (this.removing.has(id)) throw new Error('连接正在删除，请等待完成');
    const record = this.store.get<Saved>('mcp-connection', id);
    if (!record || (revision !== undefined && record.revision !== revision))
      throw new Error('连接已变化，请重新读取并核对');
    return record;
  }
  private publicRecord(record: Saved): ToolConnection {
    const { credentialRef, disconnected, oauthRefreshPending: _, ...data } = record;
    const references = this.store
      .list<PlanningTask>('ai-task')
      .filter((task) => task.toolTargets?.some((target) => target.connectionId === record.id));
    const flowIds = new Set(references.map((task) => task.flowId));
    return {
      ...data,
      hasCredential: !!credentialRef,
      taskReferences: references.map((task) => ({
        taskId: task.id,
        flowId: task.flowId,
        description: task.description.slice(0, 200),
      })),
      activeRunCount: this.store
        .list<Run>('run')
        .filter(
          (run) =>
            flowIds.has(run.flowId) &&
            ['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state),
        ).length,
      status: record.oauthRefreshPending
        ? 'failed'
        : (this.states.get(record.id) ?? (disconnected ? 'disconnected' : 'unverified')),
    };
  }
  targetSource(id: string, revision: number): ToolConnection {
    this.available();
    const record = this.publicRecord(this.record(id, revision));
    if (record.status !== 'verified')
      throw new Error('连接尚未核对或已断开，请前往应用与工具重新连接');
    return record;
  }
  private publicCandidate(candidate: Candidate): ConnectionCandidate {
    const { secret: _, saving: __, ...data } = candidate;
    return data;
  }
  private invalidate(id: string) {
    for (const call of this.calls.values()) if (call.connectionId === id) call.abort.abort();
    for (const job of this.jobs.values()) if (job.connectionId === id) job.abort.abort();
    for (const [token, candidate] of this.candidates)
      if (candidate.connectionId === id) this.candidates.delete(token);
  }
  private candidate(token: string) {
    this.available();
    const candidate = this.candidates.get(token);
    if (!candidate || candidate.expiresAt <= this.time()) {
      this.candidates.delete(token);
      throw new Error('能力检查已过期或取消，请重新发现');
    }
    if (candidate.connectionId) this.record(candidate.connectionId, candidate.revision);
    return candidate;
  }
  async request(method: string, raw: unknown): Promise<any> {
    const schema = connectionMethods[method as keyof typeof connectionMethods];
    if (!schema) throw new Error('连接方法未授权');
    const args: any = schema.parse(raw);
    for (const [token, candidate] of this.candidates)
      if (candidate.expiresAt <= this.time()) this.candidates.delete(token);
    for (const [token, inspection] of this.inspections)
      if (inspection.expiresAt <= this.time()) this.inspections.delete(token);
    if (method === 'tool.connection.list')
      return this.store.list<Saved>('mcp-connection').map((record) => this.publicRecord(record));
    if (method === 'tool.connection.cancel') {
      const job = this.jobs.get(args.requestId);
      job?.abort.abort();
      for (const [token, candidate] of this.candidates)
        if (candidate.requestId === args.requestId) this.candidates.delete(token);
      await job?.promise.catch(() => {});
      return true;
    }
    this.available();
    if (method === 'tool.connection.oauth.inspect') {
      if (this.jobs.size) throw new Error('另一个连接仍在检查或关闭，请等待完成');
      this.inspections.clear();
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 30000);
      const job: Job = { abort, promise: undefined! };
      this.jobs.set(args.requestId, job);
      job.promise = inspectMcpOAuth(args, abort.signal)
        .then((result) => {
          this.available();
          abort.signal.throwIfAborted();
          const inspectionToken = uid();
          const inspected = { ...result, inspectionToken };
          this.inspections.set(inspectionToken, inspected);
          setTimeout(() => this.inspections.delete(inspectionToken), 300000).unref();
          return inspected;
        })
        .finally(() => {
          clearTimeout(deadline);
          if (this.jobs.get(args.requestId) === job) this.jobs.delete(args.requestId);
        });
      return job.promise;
    }
    if (method === 'tool.connection.oauth.authorize') {
      if (this.jobs.size || this.candidates.size >= 8)
        throw new Error('请先完成或取消当前连接检查');
      const inspection = this.inspections.get(args.inspectionToken);
      const transport = args.config.transport;
      if (
        !inspection ||
        inspection.expiresAt <= this.time() ||
        transport.type !== 'http' ||
        transport.url !== inspection.url ||
        args.config.protocolVersion !== inspection.protocolVersion ||
        !transport.oauth ||
        !this.deps.openOAuth
      )
        throw new Error('认证检查已过期或配置不符，请重新检查');
      const previous = args.connectionId
        ? this.record(args.connectionId, args.revision)
        : undefined;
      if (previous) {
        this.assertIdle(previous.id);
        this.invalidate(previous.id);
      }
      this.inspections.delete(args.inspectionToken);
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 600000);
      const job: Job = { abort, connectionId: previous?.id, promise: undefined! };
      this.jobs.set(args.requestId, job);
      job.promise = (async () => {
        const current = () => {
          this.available();
          abort.signal.throwIfAborted();
          if (previous) this.record(previous.id, previous.revision);
        };
        try {
          current();
          const grant = await authorizeMcpOAuth(
            args.config,
            inspection,
            abort.signal,
            this.deps.openOAuth!,
          );
          current();
          const discovered = await (this.deps.discover ?? discoverMcp)(
            args.config,
            grant.accessToken,
            abort.signal,
          );
          current();
          const candidate: Candidate = {
            ...discovered,
            config: args.config,
            requestId: args.requestId,
            token: uid(),
            expiresAt: Math.min(this.time() + 300000, grant.expiresAt ?? Infinity),
            ...(previous ? { connectionId: previous.id, revision: previous.revision } : {}),
            changed: !!previous && previous.capabilityDigest !== discovered.capabilityDigest,
            secret: JSON.stringify(grant),
            oauth: oauthSummary(grant),
          };
          if (candidate.expiresAt <= this.time())
            throw new OAuthInspectionError('登录已过期，请重新授权');
          this.candidates.set(candidate.token, candidate);
          setTimeout(() => this.candidates.delete(candidate.token), 300000).unref();
          return this.publicCandidate(candidate);
        } catch (error) {
          if (error instanceof McpCleanupError) this.cleanupFault = true;
          if (error instanceof OAuthInspectionError || error instanceof DiscoveryError) throw error;
          throw new Error(
            abort.signal.aborted
              ? '登录授权已取消或超时'
              : '登录或能力核对未完成，请重新检查；连接尚未保存',
          );
        } finally {
          clearTimeout(deadline);
          if (this.jobs.get(args.requestId) === job) this.jobs.delete(args.requestId);
        }
      })();
      return job.promise;
    }
    if (method === 'tool.connection.discover') {
      if (this.jobs.size) throw new Error('另一个连接仍在发现或关闭，请等待完成');
      if ([...this.candidates.values()].some((c) => c.requestId === args.requestId))
        throw new Error('发现请求已完成，请核对候选或使用新的请求');
      if (this.candidates.size >= 8) throw new Error('待核对连接过多，请先保存或取消');
      const previous = args.connectionId
        ? this.record(args.connectionId, args.revision)
        : undefined;
      if (previous) {
        this.assertIdle(previous.id);
        this.invalidate(previous.id);
      }
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 60000);
      const job: Job = { abort, connectionId: previous?.id, promise: undefined! };
      this.jobs.set(args.requestId, job);
      job.promise = (async () => {
        let secret: string | undefined = args.bearerToken;
        const current = () => {
          this.available();
          abort.signal.throwIfAborted();
          if (previous) this.record(previous.id, previous.revision);
        };
        try {
          if (args.config.transport.type === 'http' && args.config.transport.auth === 'oauth') {
            if (
              !previous?.credentialRef ||
              canonical(previous.config.transport) !== canonical(args.config.transport)
            )
              throw new OAuthInspectionError('OAuth 配置已变化，请先检查并重新登录授权');
            secret = await this.credential(previous, abort.signal);
          }
          const wantsBearer =
            args.config.transport.type === 'http' && args.config.transport.auth === 'bearer';
          if (!secret && wantsBearer && previous?.credentialRef) {
            if (canonical(previous.config.transport) !== canonical(args.config.transport))
              throw new Error('地址或认证已变化，请重新提供此服务的凭据');
            secret = await this.deps.credentials.get(previous.credentialRef);
          }
          current();
          const discovered = await (this.deps.discover ?? discoverMcp)(
            args.config,
            secret,
            abort.signal,
          );
          current();
          const candidate: Candidate = {
            ...discovered,
            token: uid(),
            requestId: args.requestId,
            config: args.config,
            ...(previous ? { connectionId: previous.id, revision: previous.revision } : {}),
            expiresAt: this.time() + 300000,
            changed: !!previous && previous.capabilityDigest !== discovered.capabilityDigest,
            secret:
              args.config.transport.type === 'http' &&
              args.config.transport.auth === 'oauth' &&
              previous?.credentialRef
                ? await this.deps.credentials.get(
                    this.record(previous.id, previous.revision).credentialRef!,
                  )
                : secret,
            ...(args.config.transport.type === 'http' &&
            args.config.transport.auth === 'oauth' &&
            previous
              ? { oauth: this.record(previous.id, previous.revision).oauth }
              : {}),
          };
          current();
          if (candidate.oauth?.expiresAt !== undefined)
            candidate.expiresAt = Math.min(candidate.expiresAt, candidate.oauth.expiresAt);
          if (candidate.expiresAt <= this.time())
            throw new OAuthInspectionError('登录已过期，请重新授权');
          this.candidates.set(candidate.token, candidate);
          const candidateToken = candidate.token;
          setTimeout(() => this.candidates.delete(candidateToken), 300000).unref();
          return this.publicCandidate(candidate);
        } catch (error) {
          if (error instanceof McpCleanupError) this.cleanupFault = true;
          if (
            previous &&
            this.store.get<Saved>('mcp-connection', previous.id)?.revision === previous.revision &&
            !abort.signal.aborted
          )
            this.states.set(previous.id, 'failed');
          if (abort.signal.aborted) throw new Error('连接发现已取消');
          if (
            error instanceof DiscoveryError ||
            error instanceof McpCleanupError ||
            error instanceof OAuthInspectionError
          )
            throw error;
          // Adapter errors are bounded; key storage and supplied dependencies
          // must never leak their raw errors across the public interface.
          if (error instanceof Error && error.message && !secret?.length) throw error;
          throw new Error('连接发现失败，请核对服务、协议或凭据后重试');
        } finally {
          clearTimeout(deadline);
          secret = undefined;
          if (this.jobs.get(args.requestId) === job) this.jobs.delete(args.requestId);
        }
      })();
      return job.promise;
    }
    if (method === 'tool.connection.save') {
      const candidate = this.candidate(args.token);
      if (candidate.saving) throw new Error('连接正在保存');
      candidate.saving = true;
      const deadline = Date.now() + 60000;
      const id = candidate.connectionId ?? uid();
      const previous = candidate.connectionId ? this.record(id, candidate.revision) : undefined;
      this.assertIdle(id);
      let credentialRef: string | undefined;
      let committed = false;
      try {
        if (candidate.secret) {
          credentialRef = 'mcp-' + uid();
          await this.deps.credentials.set(credentialRef, candidate.secret);
        }
        this.candidate(args.token);
        this.assertIdle(id);
        if (Date.now() >= deadline) throw new Error('连接保存已超时');
        const { server, tools, capabilityDigest, testedAt, protocolVersion, config, oauth } =
          candidate;
        const record: Saved = {
          id,
          revision: (previous?.revision ?? 0) + 1,
          config,
          server,
          tools,
          capabilityDigest,
          testedAt,
          protocolVersion,
          ...(credentialRef ? { credentialRef } : {}),
          ...(oauth ? { oauth } : {}),
        };
        this.store.put('mcp-connection', id, record);
        committed = true;
        this.candidates.delete(args.token);
        this.states.set(id, 'verified');
        if (previous?.credentialRef)
          await this.deps.credentials.remove(previous.credentialRef).catch(() => {});
        return this.publicRecord(record);
      } catch {
        throw new Error('连接保存未完成，请重新核对；原连接保持不变');
      } finally {
        candidate.saving = false;
        if (!committed && credentialRef)
          await this.deps.credentials.remove(credentialRef).catch(() => {});
      }
    }
    const record = this.record(args.id, args.revision);
    this.invalidate(record.id);
    // Invalidate pending work before awaiting cleanup. Removal holds an
    // exclusive per-connection gate until both credential and record are gone.
    if (method === 'tool.connection.remove') {
      this.removing.add(record.id);
      try {
        await Promise.all(
          [...this.jobs.values()]
            .filter((job) => job.connectionId === record.id)
            .map((job) => job.promise.catch(() => {})),
        );
        await this.settleCalls(record.id);
        if (record.credentialRef) await this.deps.credentials.remove(record.credentialRef);
        this.store.remove('mcp-connection', record.id);
        this.states.delete(record.id);
      } catch {
        this.states.set(record.id, 'failed');
        throw new Error('连接或专属凭据未能删除，记录已保留；请恢复系统存储后重试删除');
      } finally {
        this.removing.delete(record.id);
      }
    } else {
      this.store.put('mcp-connection', record.id, {
        ...record,
        revision: record.revision + 1,
        disconnected: true,
      });
      this.states.set(record.id, 'disconnected');
      await this.settleCalls(record.id);
    }
    await Promise.all(
      [...this.jobs.values()]
        .filter((job) => job.connectionId === record.id)
        .map((job) => job.promise.catch(() => {})),
    );
    return true;
  }
  async cancelAll() {
    const calls = this.settleCalls();
    const pending = [...this.jobs.values()];
    this.candidates.clear();
    this.inspections.clear();
    for (const job of pending) job.abort.abort();
    await Promise.all([calls, ...pending.map((job) => job.promise.catch(() => {}))]);
    this.states.clear();
    if (this.cleanupFault) throw new Error('MCP 连接回收未确认');
  }
}

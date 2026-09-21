import {
  connectionMethods,
  type ConnectionCandidate,
  type ConnectionConfig,
  type ConnectionDiscovery,
  type ToolConnection,
} from '../shared/tool-connections';
import { discoverMcp, DiscoveryError, McpCleanupError } from '../adapters/mcp-discovery';
import { Store } from './store';
import { canonical, uid } from '../shared/utils';

type Saved = ConnectionDiscovery & {
  id: string;
  revision: number;
  config: ConnectionConfig;
  credentialRef?: string;
  disconnected?: boolean;
};
type Candidate = ConnectionCandidate & { secret?: string; saving?: boolean };
type Job = { abort: AbortController; connectionId?: string; promise: Promise<ConnectionCandidate> };
export class ToolConnections {
  private jobs = new Map<string, Job>();
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
      discover?: typeof discoverMcp;
      time?: () => number;
    },
  ) {}
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
    const { credentialRef, disconnected, ...data } = record;
    return {
      ...data,
      hasCredential: !!credentialRef,
      status: this.states.get(record.id) ?? (disconnected ? 'disconnected' : 'unverified'),
    };
  }
  private publicCandidate(candidate: Candidate): ConnectionCandidate {
    const { secret: _, saving: __, ...data } = candidate;
    return data;
  }
  private invalidate(id: string) {
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
    if (method === 'tool.connection.discover') {
      if (this.jobs.size) throw new Error('另一个连接仍在发现或关闭，请等待完成');
      if ([...this.candidates.values()].some((c) => c.requestId === args.requestId))
        throw new Error('发现请求已完成，请核对候选或使用新的请求');
      if (this.candidates.size >= 8) throw new Error('待核对连接过多，请先保存或取消');
      const previous = args.connectionId
        ? this.record(args.connectionId, args.revision)
        : undefined;
      if (previous) this.invalidate(previous.id);
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
            secret,
          };
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
          if (error instanceof DiscoveryError || error instanceof McpCleanupError) throw error;
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
      let credentialRef: string | undefined;
      let committed = false;
      try {
        if (candidate.secret) {
          credentialRef = 'mcp-' + uid();
          await this.deps.credentials.set(credentialRef, candidate.secret);
        }
        this.candidate(args.token);
        if (Date.now() >= deadline) throw new Error('连接保存已超时');
        const { server, tools, capabilityDigest, testedAt, protocolVersion, config } = candidate;
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
    }
    await Promise.all(
      [...this.jobs.values()]
        .filter((job) => job.connectionId === record.id)
        .map((job) => job.promise.catch(() => {})),
    );
    return true;
  }
  async cancelAll() {
    const pending = [...this.jobs.values()];
    this.candidates.clear();
    for (const job of pending) job.abort.abort();
    await Promise.all(pending.map((job) => job.promise.catch(() => {})));
    this.states.clear();
    if (this.cleanupFault) throw new Error('MCP 连接回收未确认');
  }
}

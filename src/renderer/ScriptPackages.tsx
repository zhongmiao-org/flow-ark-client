import { useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { Bindings, Step } from '../shared/types';

type Package = { name: string; version: string; path: string };
export default function ScriptPackages(props: {
  flowId: string;
  node: Extract<Step, { type: 'script' }>;
  bindings: Bindings;
  bind: (info: Package) => void;
  remove: (name: string) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setError('');
  }, [props.flowId, props.node.id]);
  const bind = async () => {
    const identity = props.flowId + ':' + props.node.id;
    setBusy(true);
    setError('');
    try {
      const path = await window.flowark.request('file.choose', { kind: 'directory' });
      if (!path) return;
      const info = await window.flowark.request('script.package.inspect', { path });
      const current = latest.current;
      if (alive.current && identity === current.flowId + ':' + current.node.id) current.bind(info);
    } catch (e: any) {
      if (alive.current && identity === latest.current.flowId + ':' + latest.current.node.id)
        setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="script-packages" aria-label="脚本本地依赖">
      <label>本地依赖</label>
      <p className="note">选择已安装包的目录。保存精确版本，运行前固定代码。</p>
      {props.node.dependencies.map((dep) => {
        const binding = props.bindings.scriptPackages?.[dep.name];
        return (
          <div className="script-package" key={dep.name}>
            <div>
              <strong>{dep.name}</strong>
              <small>{dep.version}</small>
              <span className="path-text">
                {binding?.version === dep.version ? binding.path : '尚未绑定此版本'}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={'移除依赖 ' + dep.name}
              onClick={() => props.remove(dep.name)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      <button onClick={bind} disabled={busy}>
        <FolderOpen size={15} />
        {busy ? '读取包信息…' : '绑定本地包'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

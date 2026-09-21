import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
(self as any).MonacoEnvironment = {
  getWorker: (_id: string, label: string) => {
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

/** Parse in Monaco's language worker; never evaluate code or resolve local packages. */
export async function checkScriptSyntax(code: string, language: 'js' | 'ts') {
  const model = monaco.editor.createModel(
    code,
    language === 'ts' ? 'typescript' : 'javascript',
    monaco.Uri.parse(`inmemory://syntax/${crypto.randomUUID()}.${language}`),
  );
  try {
    const factory = await (language === 'ts'
      ? monaco.typescript.getTypeScriptWorker()
      : monaco.typescript.getJavaScriptWorker());
    const worker = await factory(model.uri);
    const diagnostics = await worker.getSyntacticDiagnostics(model.uri.toString());
    const message = (value: (typeof diagnostics)[number]['messageText']): string =>
      typeof value === 'string'
        ? value
        : [value.messageText, ...(value.next ?? []).map(message)].join(' ');
    return diagnostics.map((diagnostic) => ({
      ...model.getPositionAt(diagnostic.start ?? 0),
      message: message(diagnostic.messageText),
    }));
  } finally {
    model.dispose();
  }
}
export default function CodeEditor({
  value,
  onChange,
  language = 'json',
  height = '300px',
  label = '流程配置编辑器',
  theme = 'light',
  readOnly = false,
}: {
  value: string;
  onChange: (s: string) => void;
  language?: string;
  height?: string;
  label?: string;
  theme?: 'light' | 'vs-dark';
  readOnly?: boolean;
}) {
  return (
    <Editor
      height={height}
      language={language}
      value={value}
      theme={theme}
      onChange={(v) => onChange(v ?? '')}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        padding: { top: 12 },
        ariaLabel: label,
      }}
    />
  );
}

import { Button, Input } from 'antd';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Json } from '../shared/types';
import ValueField from './ValueField';
import { referenceOf, type ReferenceChoice } from './value-references';
import './archive-file-list.css';

export default function ArchiveFileList({
  value,
  change,
  choices,
}: {
  value: Json;
  change: (value: Json) => void;
  choices: ReferenceChoice[];
}) {
  const id = useId();
  const files = Array.isArray(value) ? value : undefined;
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const add = useRef<HTMLButtonElement>(null);
  const focusIndex = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState<{ message: string; value: string }>();
  useLayoutEffect(() => {
    const index = focusIndex.current;
    if (index === undefined) return;
    focusIndex.current = undefined;
    if (index < 0) add.current?.focus();
    else {
      const row = rows.current[index];
      (
        row?.querySelector<HTMLElement>('input') ??
        row?.querySelector<HTMLElement>('.value-source-button')
      )?.focus();
    }
  }, [files]);
  const update = (index: number, next: Json) => {
    if (referenceOf(files![index]) !== undefined && typeof next === 'string')
      focusIndex.current = index;
    change(files!.map((file, i) => (i === index ? next : file)));
    setNotice(undefined);
  };
  return (
    <ValueField
      label="归档文件列表"
      value={value}
      change={(next) => {
        setNotice(undefined);
        if (Array.isArray(next)) focusIndex.current = next.length ? 0 : -1;
        change(next);
      }}
      choices={choices}
      defaultValue={[]}
    >
      {files ? (
        <div className="archive-file-list">
          <header>
            <strong>归档文件列表</strong>
            <span>{files.length} / 200 个文件</span>
          </header>
          <p>填写同一绑定目录内的相对文件名，或为每项选择一个文件名变量。</p>
          <ol aria-label="归档文件条目">
            {files.map((file, index) => (
              <li
                key={index}
                ref={(element) => {
                  rows.current[index] = element;
                }}
              >
                <div className="archive-file-row-heading">
                  <span>文件 {index + 1}</span>
                  <Button
                    htmlType="button"
                    aria-label={`删除归档文件 ${index + 1}`}
                    onClick={() => {
                      focusIndex.current = Math.min(index, files.length - 2);
                      const next = files.filter((_, i) => i !== index);
                      change(next);
                      setNotice({
                        message: `已移除第 ${index + 1} 项，仅修改归档清单。`,
                        value: JSON.stringify(next),
                      });
                    }}
                  >
                    移除
                  </Button>
                </div>
                <ValueField
                  label={`文件 ${index + 1}`}
                  value={file}
                  choices={choices}
                  defaultValue=""
                  change={(next) => update(index, next)}
                >
                  {typeof file === 'string' ? (
                    <>
                      <label htmlFor={`${id}-${index}`}>相对文件名 {index + 1}</label>
                      <Input
                        id={`${id}-${index}`}
                        value={file}
                        placeholder="例如 reports/summary.txt"
                        onChange={(event) => update(index, event.target.value)}
                      />
                    </>
                  ) : undefined}
                </ValueField>
                {referenceOf(file) === undefined && (typeof file !== 'string' || !file) && (
                  <p className="archive-file-hint">
                    {typeof file === 'string'
                      ? '请填写文件名或选择变量。'
                      : '归档时需要文件名文本，请改为文本或选择变量。'}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {!files.length && (
            <div className="archive-file-empty">
              尚未添加文件。添加一项，或在下方选择整个文件列表变量。
            </div>
          )}
          <Button
            ref={add}
            htmlType="button"
            disabled={files.length >= 200 || undefined}
            onClick={() => {
              focusIndex.current = files.length;
              const next = [...files, ''];
              change(next);
              setNotice({
                message: `已添加第 ${files.length + 1} 项，请填写文件名。`,
                value: JSON.stringify(next),
              });
            }}
          >
            添加文件
          </Button>
          {files.length >= 200 && (
            <p className="archive-file-hint">文件清单最多 200 项；请先移除不需要的条目。</p>
          )}
          <p className="archive-file-feedback" role="status">
            {notice?.value === JSON.stringify(value) ? notice.message : ''}
          </p>
          <p>
            运行时需要 1～200 个文件，合计不超过 100
            MiB。不会自动展开目录；移除条目不会删除磁盘文件。
          </p>
        </div>
      ) : undefined}
    </ValueField>
  );
}

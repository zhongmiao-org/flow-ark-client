import type { FlowRecord } from '../shared/types';
type Snapshot = { record: FlowRecord; selected: string };
export type DraftHistory = {
  present: Snapshot | null;
  past: Snapshot[];
  future: Snapshot[];
  group?: string;
  revision: number;
};
export type DraftAction =
  | { type: 'open'; record: FlowRecord }
  | { type: 'select'; selected: string }
  | { type: 'change'; record: FlowRecord; group?: string }
  | { type: 'undo' | 'redo' };
export const emptyHistory: DraftHistory = { present: null, past: [], future: [], revision: 0 };
export function draftHistory(state: DraftHistory, action: DraftAction): DraftHistory {
  if (action.type === 'open')
    return {
      ...emptyHistory,
      present: { record: structuredClone(action.record), selected: '' },
      revision: state.revision + 1,
    };
  if (!state.present) return state;
  if (action.type === 'select')
    return { ...state, present: { ...state.present, selected: action.selected }, group: undefined };
  if (action.type === 'change') {
    if (action.record.id !== state.present.record.id) throw new Error('编辑记录不属于当前流程');
    if (JSON.stringify(action.record) === JSON.stringify(state.present.record)) return state;
    return {
      ...state,
      past:
        action.group && action.group === state.group
          ? state.past
          : [...state.past, state.present].slice(-100),
      present: { ...state.present, record: structuredClone(action.record) },
      future: [],
      group: action.group,
    };
  }
  const from = action.type === 'undo' ? state.past : state.future;
  if (!from.length) return state;
  return {
    present: from.at(-1)!,
    past: action.type === 'undo' ? from.slice(0, -1) : [...state.past, state.present].slice(-100),
    future: action.type === 'undo' ? [...state.future, state.present] : from.slice(0, -1),
    group: undefined,
    revision: state.revision + 1,
  };
}

export type ElementTarget = {
  selector: string;
  framePath: string[];
  label: string;
  tag: string;
  inputType: string;
  multiple: boolean;
  structural: boolean;
  options: { value: string; label: string; disabled: boolean }[];
};
export type PickerState = {
  requestId: string;
  phase: 'picking' | 'selected' | 'cancelled' | 'error';
  target?: ElementTarget;
  error?: string;
};

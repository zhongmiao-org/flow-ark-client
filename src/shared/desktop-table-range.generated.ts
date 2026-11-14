// Generated from installed table-range helper contracts; do not edit.
export type DesktopTableRangeRequest = {
  effectId: string;
  effectKey: string;
  target: {
    title: string;
    application: string;
  };
  from: {
    x: number;
    y: number;
  };
  /**
   * Required only for explicit drag selection; keyboard selection needs only from and rows/columns.
   */
  to?: {
    x: number;
    y: number;
  };
  rows: number;
  columns: number;
  requireBlank?: boolean;
  /**
   * @minItems 1
   * @maxItems 200
   */
  expected?: string[][];
  /**
   * Default keyboard: click anchor then Shift+Down/Right. Drag only for a target explicitly known to select a rectangle.
   */
  selection?: "keyboard" | "drag";
  /**
   * Explicitly verified empty/nonediting anchor only: Tab then Shift+Tab returns to grid navigation before keyboard selection. No input/paste/save. Not valid with drag.
   */
  selectionPreparation?: "tab-roundtrip";
};

export interface DesktopTableRangeResult {
  version: 1;
  /**
   * @minItems 1
   * @maxItems 200
   */
  cells: string[][];
  shapeVerified: true;
  allBlank: boolean;
  matchesExpected: true | null;
}


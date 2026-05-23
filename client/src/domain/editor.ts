export type EditorTool = 'select' | 'place' | 'move' | 'rotate' | 'scale' | 'remove' | 'path' | 'terrain';

export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flatten';

export interface BrushSettings {
  mode: BrushMode;
  radius: number;
  strength: number;
  flattenTargetHeight: number | null;
}

export interface EditorSelection {
  objectId: string | null;
  assetId: string | null;
}

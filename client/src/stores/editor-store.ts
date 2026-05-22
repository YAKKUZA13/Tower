import { defineStore } from 'pinia';
import type { BrushSettings, EditorSelection, EditorTool } from '../domain/editor';

interface EditorState {
  selectedTool: EditorTool;
  brush: BrushSettings;
  selection: EditorSelection;
}

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    selectedTool: 'terrain',
    brush: {
      mode: 'raise',
      radius: 1.2,
      strength: 0.35,
      flattenTargetHeight: null
    },
    selection: {
      objectId: null,
      assetId: null
    }
  }),
  actions: {
    setTool(tool: EditorTool) {
      this.selectedTool = tool;
    },
    setSelection(selection: Partial<EditorSelection>) {
      this.selection = { ...this.selection, ...selection };
    }
  }
});

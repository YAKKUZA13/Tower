import { defineStore } from 'pinia';
import type { MapDocument } from '../domain/map';
import { getMap, saveMap } from '../services/api';

interface MapState {
  document: MapDocument | null;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  error: string;
}

export const useMapStore = defineStore('map', {
  state: (): MapState => ({
    document: null,
    isLoading: false,
    isSaving: false,
    isDirty: false,
    error: ''
  }),
  actions: {
    async loadMap() {
      this.isLoading = true;
      this.error = '';
      try {
        this.document = await getMap();
        this.isDirty = false;
      } catch (e) {
        this.error = 'Не удалось загрузить карту';
        throw e;
      } finally {
        this.isLoading = false;
      }
    },
    setMap(document: MapDocument) {
      this.document = document;
      this.isDirty = true;
    },
    async saveCurrentMap(document?: MapDocument | null) {
      document = document || this.document;
      if (!document) return;
      this.isSaving = true;
      this.error = '';
      try {
        await saveMap(document);
        this.isDirty = false;
      } catch (e) {
        this.error = 'Не удалось сохранить карту';
        throw e;
      } finally {
        this.isSaving = false;
      }
    }
  }
});

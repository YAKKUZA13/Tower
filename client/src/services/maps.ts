/**
 * Локальный резолвер карт (Phase B новой концепции).
 *
 * Встроенные карты хранятся в `@tower/shared/maps` и доступны синхронно — без
 * сетевого запроса и без БД. Single-player использует `DEFAULT_MAP_ID`, co-op
 * хост выбирает карту в лобби и пробрасывает её id гостям через `coop:welcome`.
 */

import { DEFAULT_MAP_ID, getBuiltinMap } from '@tower/shared';
import type { MapDocument } from '@tower/shared';

/**
 * Возвращает MapDocument по id встроенной карты.
 * Фолбэк — дефолтная карта (`DEFAULT_MAP_ID`).
 */
export function loadMap(mapId: string | null | undefined): MapDocument {
  return getBuiltinMap(mapId);
}

export { DEFAULT_MAP_ID };

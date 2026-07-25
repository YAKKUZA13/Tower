/**
 * M8.2 — Formations (расстановка выделенных юнитов вокруг точки приказа).
 * Источник: AoE/Warcraft/StarCraft formations; Game AI Pro §grid/wedge.
 *
 *  - grid: прямоугольная сетка N×M вокруг target
 *  - wedge: клин (1-3-5-7...)
 *  - line: одна линия (front-wide)
 *  - column: колонна (deep)
 *
 * Возвращает массив (col, row) для каждого unit в unitIds (по порядку).
 * Сервер (или клиент-предикт) применяет их как order-unit-move на каждый юнит.
 *
 * Детерминизм: порядок unitIds сохраняется (тай-брейк по id нет — клиент
 * задаёт порядок в selection).
 */
import type { FormationKind } from '@tower/shared';

export interface FormationOptions {
  /** Шаг между юнитами в клетках. */
  spacing?: number;
  /** Смещение относительно target: 'center' (вокруг), 'forward' (позади-вперёд). */
  anchor?: 'center' | 'forward';
}

/**
 * Распределяет N юнитов в формацию вокруг target (col,row).
 * Возвращает массив пар (col, row) длиной = unitIds.length.
 */
export function computeFormation(
  unitCount: number,
  target: { col: number; row: number },
  kind: FormationKind,
  options: FormationOptions = {}
): Array<{ col: number; row: number }> {
  if (unitCount <= 0) return [];
  if (unitCount === 1) return [{ col: target.col, row: target.row }];
  const spacing = options.spacing ?? 1.2;
  const out: Array<{ col: number; row: number }> = [];

  switch (kind) {
    case 'none': {
      // все в одну точку (legacy behavior — stack в 1 клетку)
      for (let i = 0; i < unitCount; i++) out.push({ col: target.col, row: target.row });
      return out;
    }
    case 'grid': {
      // квадрат (r × c) вокруг target
      const cols = Math.ceil(Math.sqrt(unitCount));
      const rows = Math.ceil(unitCount / cols);
      const halfW = (cols - 1) / 2;
      const halfH = (rows - 1) / 2;
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (idx >= unitCount) break;
          out.push({
            col: Math.round((target.col + (c - halfW) * spacing) * 10) / 10,
            row: Math.round((target.row + (r - halfH) * spacing) * 10) / 10
          });
          idx++;
        }
      }
      return out;
    }
    case 'wedge': {
      // клин 1, 3, 5, 7, ... — leader впереди, остальные позади-вбок
      out.push({ col: target.col, row: target.row });
      let ring = 1;
      let placed = 1;
      while (placed < unitCount) {
        const ringSize = ring * 2 + 1;
        for (let i = 0; i < ringSize && placed < unitCount; i++) {
          const offset = (i - ring);
          out.push({
            col: Math.round((target.col + offset * spacing) * 10) / 10,
            row: Math.round((target.row + ring * spacing) * 10) / 10
          });
          placed++;
        }
        ring++;
      }
      return out;
    }
    case 'line': {
      // горизонтальная линия (front-wide), все на одной row = target.row
      const half = (unitCount - 1) / 2;
      for (let i = 0; i < unitCount; i++) {
        out.push({
          col: Math.round((target.col + (i - half) * spacing) * 10) / 10,
          row: target.row
        });
      }
      return out;
    }
    case 'column': {
      // вертикальная колонна (deep)
      const half = (unitCount - 1) / 2;
      for (let i = 0; i < unitCount; i++) {
        out.push({
          col: target.col,
          row: Math.round((target.row + (i - half) * spacing) * 10) / 10
        });
      }
      return out;
    }
    default:
      return computeFormation(unitCount, target, 'grid', options);
  }
}

/**
 * Применяет формацию к группе юнитов → массив order-unit-move-приказов.
 * (Готовый хелпер для PlayerAction-order-unit-move).
 */
export function formationToOrders(
  unitIds: string[],
  target: { col: number; row: number },
  kind: FormationKind,
  options: FormationOptions = {}
): Array<{ unitId: string; col: number; row: number }> {
  const positions = computeFormation(unitIds.length, target, kind, options);
  return unitIds.map((id, i) => ({ unitId: id, col: positions[i].col, row: positions[i].row }));
}

# Каталог моделей TD — post-MVP GLB swap

Этот каталог использует **процедурные воксель-модели** по умолчанию (см.
`client/src/babylon/voxel/voxel-builder.ts`). Это даёт тёмный дарк-фэнтези стиль
из коробки, без сетевых зависимостей и без скачивания внешних ассетов.

## Когда нужен swap на реальные CC0 GLB

Проект поддерживает автоматический swap на реальные CC0 GLB-модели. Инфраструктура
уже готова (`client/src/babylon/asset-catalog.ts:103-123`):

1. Положи GLB файл в соответствующую подпапку (см. ниже).
2. Добавь `glbPath` к записи в `manifest.json`.
3. При запуске `AssetCatalog` загрузит GLB и автоматически переключит рендер на него.
   При ошибке загрузки — fallback на процедурную воксель-модель.

## Рекомендуемые CC0-паки (post-MVP)

| Назначение | Пак | Источник | Лицензия |
|---|---|---|---|
| Враги (animated) | **Quaternius Cube World Kit** | https://quaternius.com/packs/cubeworldkit.html | CC0 |
| Стены/пол | **KayKit Dungeon Remastered** | https://kaylousberg.com/game-assets/dungeon-remastered | CC0 |
| Тайлы/декор | **Kenney Modular Dungeon Kit** | https://kenney.nl/assets/modular-dungeon-kit | CC0 |
| Башни/здания | **Quaternius Ultimate Fantasy RTS** | https://quaternius.com | CC0 |
| Добор | **Poly Pizza** (search License=CC0) | https://poly.pizza | per-model |

## Структура подпапок

```
client/public/catalog/
  manifest.json          ← главный манифест; добавляй glbPath сюда
  enemies/
    skeleton.glb         ← пример: CC0 модель из Cube World Kit
    goblin.glb
    zombie.glb
    demon.glb
    boss.glb
    slime.glb            ← post-MVP силуэт
    bat.glb
    spider.glb
    ghost.glb
  towers/
    arrow.glb  cannon.glb  arcane.glb  ice.glb
  walls/
    wood.glb   stone.glb   bone.glb
  relics/
    totem-fire.glb  totem-arcane.glb  totem-gold.glb  totem-ice.glb  totem-blood.glb
  base/
    altar.glb
  spawn/
    portal.glb
  buildings/
    sawmill.glb  mine.glb  smelter.glb  barracks.glb
  units/
    knight.glb  archer.glb  mage.glb  commander.glb
  tiles/
    grass.glb  dirt.glb  road.glb  water.glb  rock.glb  sand.glb
```

## Как добавить `glbPath` в `manifest.json`

Пример для `enemy:skeleton`:

```json
{
  "catalogId": "enemy:skeleton",
  "kind": "enemy",
  "builder": "enemy:skeleton",
  "glbPath": "enemies/skeleton.glb",
  "baseColor": [0.74, 0.71, 0.62],
  "emissive": [1.00, 0.18, 0.12]
}
```

После этого `AssetCatalog.preloadGlbTemplates()` поднимет GLB при запуске,
`normalizeMesh` приведёт его к каноническому виду (base @ y=-0.5, height=1.0), и
рендерер будет использовать GLB-вариант. Фолбэк на `builder` сработает автоматически
при ошибке.

## Подготовка GLB (offline пайплайн)

| Этап | Инструмент | Лицензия | Назначение |
|---|---|---|---|
| Лепка/правка | **Vengi VoxEdit** | MIT | правка/адаптация под палитру |
| Конверсия .vox → glTF | **Vengi VoxConvert** (CLI) | MIT | основной конвертер |
| Экспорт из Blockbench | **Blockbench** | GPL-3.0 | экспорт GLB напрямую + риг/анимации |

Тонировка под дарк-фэнтези: десатурация 15–30%, землистые тона, кровавые/холодные
акценты (см. `client/src/babylon/voxel/dark-palette.ts`).

## Скелетная анимация (TODO)

Quaternius Cube World Kit поставляется **анимированным**. Для поддержки скелетной
анимации per-instance в Babylon.js через thin instances нужно:

1. Загрузить skeleton + animations из GLB.
2. Запечь кадры в вершинные атрибуты через `BakedVertexAnimationManager`
   (Babylon.js 7+, `@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager`).
3. В enemy-renderer: для каждого thin-instance — свой `bakedVertexAnimationManager`
   с shared baked texture (BVA texture).
4. Альтернатива (проще): переключить врагов с thin instances на `InstancedMesh`
   (как башни/юниты) и использовать обычный `Animation` per-instance — но это теряет
   1-draw-call-per-type.

Это большая инфраструктура, отложена в `redy.md` как post-MVP фаза "Anim-1".

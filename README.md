# Tower Engine — voxel RTS showcase

Engine asset work: [implementation plan and acceptance gates](docs/sciens/asset-contract-roadmap.md),
[research and design decisions](docs/sciens/asset-contract-research.md).
Run `npm run dev:lab` and open `http://127.0.0.1:5184/#character` for JSON characters,
creatures and equipment: shared geometry, independent animation, socket attachments
and part inspection. [Installed authoring skill](node_modules/@voxkera/engine-recipe/skills/tower-assets/SKILL.md).
`?backend=webgpu#character` opts into experimental WebGPU; WebGL remains default.
The independent engine repository is **Voxkera**, located beside Tower. Tower consumes
six public MIT-licensed `@voxkera/*@0.1.0` packages from npm, pinned in the lockfile.
[Dependency audit and exact module list](docs/sciens/voxkera-extraction-audit.md),
[migration result](docs/sciens/voxkera-migration-status.md).
These are technical fixtures, not art-approved assets or a completed ARPG.

![RTS command feedback and procedural buildings](docs/media/rts-command-feedback.png)

Tower — TypeScript/Babylon.js RTS на универсальном движке Voxkera. Текущий вертикальный срез — одиночная RTS «Тёмная крепость»: экономика, строительство, производство войск, формации, командирские заклинания и волны противника работают на детерминированной игровой симуляции Tower.

## Что показывает RTS

- ортографическую RTS-камеру с плавным WASD/edge-scroll, drag-pan, zoom-to-cursor и вращением;
- чанковый террасный terrain с отдельными биомами, высотами и непроходимыми зонами;
- процедурные составные воксельные здания, войска и ресурсные узлы;
- сбор дерева/камня/руды, производственные цепочки и строительство;
- выделение отрядов, control groups, формации, fog of war и миникарту;
- карточку состава выбранного отряда и цветное подтверждение приказов прямо на поле;
- обход препятствий рабочими и войсками, доставку груза к краю ратуши и стабильную анимацию составных ригов;
- охраняемый обоз с ресурсами и сигнальный пост: очистка, удержание, награда и снижение частоты налётов;
- охрану точек, патрули и налётчиков, вступающих в бой с отрядами игрока вместо движения по единственному TD-маршруту;
- круговую область заклинаний, падение метеора с отложенным уроном и шейдерную стужу на террасном рельефе;
- адаптивный полевой HUD без отдельного «мобильного» режима;
- детерминированную симуляцию, пригодную для prediction/rollback и сетевого режима.

![Crossroads battlefield at the start of a match](docs/media/rts-crossroads.png)

![Enemy fortress objective](docs/media/rts-enemy-fortress.png)

![Guarded world objective and meteor](docs/media/rts-meteor.png)

![Frost area on the battlefield](docs/media/rts-frost.png)

## Визуальная база

Читаемость силуэтов и назначение построек сверялись с CC0-наборами [KayKit Medieval Hexagon](https://kaylousberg.itch.io/kaykit-medieval-hexagon) и [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers). В игру не вставлен готовый asset pack: крепость, шахта, лесопилка, юниты и вражеский оплот собраны процедурно через voxel pipeline Tower, чтобы showcase демонстрировал сам движок.

![Welcome screen and campaign entry](docs/media/rts-welcome.png)

## Запуск без сервера и базы данных

```bash
npm ci
npm run dev:rts
```

Откройте `http://127.0.0.1:5173/?demo=rts&map=rts-2p-crossroads`. Маршрут создаёт локального demo-командира и сразу запускает RTS, поэтому PostgreSQL, Redis и авторизация для showcase не нужны.

Управление: `WASD`/стрелки или края экрана — перемещение, колесо — zoom-to-cursor, средняя кнопка или `Alt` + ЛКМ — drag-pan, `Q`/`E` — поворот, `1–9` — группы, ПКМ — приказ.

## Структура движка

```text
../Voxkera                independent npm workspace; six @voxkera/* packages
vendor/voxkera            versioned npm tarballs and integrity manifest
shared                    Tower contracts, catalogs and maps
client/src/sim            deterministic RTS simulation
client/src/babylon        RTS presentation and game-owned models/palettes
server                    Tower networking, authentication and storage
packages/voxel-lab        Tower demo tool using installed package APIs
```

## Проверка

```bash
npm run typecheck
npm run check:engine
npm run smoke:content
npm run smoke:rts
npx tsx scripts/smoke-rts.ts
npx tsx scripts/smoke-rts-solo.ts
npx tsx scripts/smoke-rts-m8.ts
npx tsx scripts/smoke-rts-camera.ts
npx tsx scripts/smoke-rts-terrain.ts
npx tsx scripts/smoke-rts-gameplay.ts
npx tsx scripts/smoke-rts-workers.ts
npx tsx scripts/smoke-rts-rendering.ts
npm run smoke:rts:browser
npm run build
```

Сделать свежий README-кадр. Команда проверит установленные engine-артефакты, временно
поднимет локальный Vite и освободит порт после снимка:

```bash
npm run capture:rts
```

`voxel-lab` остаётся экспериментальной площадкой движка. Ритуальная сцена намеренно не включена в RTS и будет продолжена после завершения игрового RTS-среза.

## Обновление Voxkera

Tower использует опубликованный npm-релиз `0.1.0`. Для обновления на новый релиз
укажите его точную версию:

```powershell
npm.cmd run engine:source -- registry --version 0.1.0
```

Команда проверяет наличие всех шести версий, обновляет root/client/shared/lab manifests,
повторно разрешает только engine-записи lockfile и выполняет чистый `npm ci`.
`npm run engine:source -- vendor` возвращает подключение к архивным `.tgz`.
Source checkout движка в обоих случаях не используется.

В соседнем `Voxkera` выполните `npm ci`, `npm run ci`, `npm run smoke:browser` и
`npm run pack:artifacts`. Проверенные `.tgz` и `manifest.json` находятся в
`Voxkera/artifacts/packages`. Новое содержимое требует новой версии пакетов:
не заменяйте архив под прежним именем. Обновите `vendor/voxkera`, ссылки `file:*.tgz`
в manifests и `package-lock.json`, затем запустите проверки выше и `npm run build`.

Tower не требует соседний checkout для установки, разработки или CI.
`build:pkgs` сохранён как проверка целостности артефактов; он больше не собирает движок.
`npm run smoke:clean-install` проверяет отдельную копию Tower без engine sources.
`npm run export:engine` экспортирует архивы только в vendor-режиме. В registry-режиме
для получения точной опубликованной версии используйте `npm pack @voxkera/<package>@<version>`.

Babylon adapters требуют `@babylonjs/core@7.54.3`. Для TypeScript 6 используйте
`moduleResolution: Bundler` и `skipLibCheck: true` из-за деклараций Babylon;
pure-пакеты Voxkera поддерживают строгий NodeNext. Рендерер и WebGL default сохранены.

## GitHub Pages: офлайн RTS

В **Settings → Pages → Source** выберите **GitHub Actions**. Workflow
[pages.yml](.github/workflows/pages.yml) публикует `client/dist` после push в `main`
либо ручного запуска; `configure-pages` задаёт правильный base path репозитория.
`npm ci` устанавливает публичные `@voxkera/*@0.1.0` по lockfile без npm token
и без соседнего checkout движка. Зафиксируйте manifests и lockfile вместе с workflow.

Локальная проверка проекта в подпапке:

```powershell
$env:TOWER_BASE = '/tower-test/'
npm.cmd run build:pages
npm.cmd run smoke:pages
Remove-Item Env:TOWER_BASE
```

Pages mode сразу открывает гостевую RTS, не восстанавливает серверную сессию и
загружает catalog/recipes относительно base URL. Проверяются все три карты и
отсутствие запросов к backend. Fastify, БД и multiplayer этим workflow не размещаются.
Нормальная full-stack сборка по-прежнему запускается через `npm run build`.

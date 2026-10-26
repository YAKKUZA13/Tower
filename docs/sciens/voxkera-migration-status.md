# Tower → Voxkera: результат миграции

Дата: 26 октября 2026. Исходный Tower: `D:\projeckt\Tower`, HEAD `26b3a757afb9b3f887c57cb0266c7af29d37b35d`, с существовавшими до работы незакоммиченными изменениями.

**Выделение и npm-публикация выполнены.** Самостоятельный Git-репозиторий и npm workspace monorepo находится в **`D:\projeckt\Voxkera`**. Шесть библиотек **0.1.0** опубликованы в публичном npm с лицензией **MIT**. Tower использует точные registry versions и SHA-512 integrity в lockfile. Наличие соседнего checkout для установки или запуска Tower не требуется. Первоначальные `vendor/voxkera` tarballs сохранены без изменений как архивный вариант подключения.

До изменений предоставлен [аудит зависимостей и точный состав модулей](voxkera-extraction-audit.md). [Исходный машинный граф](voxkera-dependencies.json) сохранён; повторный анализ пишет [текущий граф](voxkera-dependencies-current.json).

## Этапы

- [x] 0. Dependency report, module inventory/hashes и исходные regression checks.
- [x] 1. Отделение игрового content с проверкой результатов до/после.
- [x] 2. Самостоятельный npm monorepo из шести `@voxkera/*` библиотек.
- [x] 3. Public exports, declarations, Babylon peers, package smoke и CI.
- [x] 4. Tower на versioned tarballs; старые engine workspaces и source imports удалены.
- [x] 5. Установка по lockfile, typecheck, RTS/browser, полный build и независимая clean-install проверка.
- [x] 6. MIT LICENSE, публикация шести проверенных tarballs, проверка registry integrity и чистый `npm ci` Tower из npm.

## Публичный релиз 0.1.0: проверка Tower

Все шесть пакетов доступны в [npm scope Voxkera](https://www.npmjs.com/org/voxkera). SHA-512 опубликованных архивов совпадает с release manifest. Анонимная загрузка всех шести tarballs дала HTTP 200 и правильный SHA-512; npm credentials для установки в Pages CI не нужны. Доказательства: `artifacts/voxkera-migration/npm-public-artifacts.json`, а в Voxkera — `artifacts/release-0.1.0-state.json`.

При первом переключении обычный npm install сохранил старые file-архивы с тем же номером версии. Guard обнаружил неверный resolved URL. Переключатель исправлен: повторно разрешает только шесть engine-записей lockfile без node_modules и выполняет npm ci. Сравнение lockfile подтвердило, что остальные установленные зависимости не изменились. Первоначальные vendor archives не перезаписаны.

После чистой установки из registry прошли все восемь команд: `typecheck`, `smoke:rts` (девять regression scripts), `smoke:content`, `smoke:engine:consumer`, `build`, `smoke:rts:browser`, `build:pages`, `smoke:pages`. Результаты и пути к логам: `artifacts/voxkera-migration/registry-verification.json`. Полный build сохранил Babylon chunk `babylon-core-Cv0VWDF9.js` размером 2.66 MB при лимите 3.00 MB. Pages проверен под `/tower-test/` на строгом статическом сервере: все три карты, непустой canvas, правильные asset paths, без API и console/network errors. Отчёт: `artifacts/pages/report.json`.

Геймплей RTS и renderer не изменялись для публикации. GitHub workflow готов; удалённый Pages deploy и remote push не выполнялись.

В исходном Tower изначально были dirty/untracked character assets и подготовительные изменения engine. Они включены в перенос, а не отброшены. Исходные снимки до разделения и после него сохранены в `artifacts/voxkera-migration/source` и `stage1-source`. Удаления шести engine-каталогов в diff Tower — перенос в соседний репозиторий. Старые README и переносимый heightmap demo дополнительно сохранены в Voxkera `docs/character-contract.md`, `docs/voxel-babylon-guide.md` и `demos/heightmap-demo.ts`.

Публикация npm выполнена по отдельному запросу владельца. Remote push и GitHub Pages deploy в этой работе не выполнялись. Прежние незакоммиченные изменения Tower не коммитились целиком.

## Пакеты и границы

| Пакет | Source modules | Зависимости |
|---|---:|---|
| `@voxkera/engine-recipe` | 8 | `zod@4.6.7` |
| `@voxkera/engine-terrain` | 3 | нет |
| `@voxkera/engine-scene` | 6 | нет |
| `@voxkera/voxel-core` | 20 | engine-recipe 0.1.0 |
| `@voxkera/voxel-babylon` | 9 | voxel-core 0.1.0; peer/dev `@babylonjs/core@7.54.3` |
| `@voxkera/scene-babylon` | 2 | engine-scene 0.1.0; peer/dev `@babylonjs/core@7.54.3` |

Всего 48 library source modules: 45 engine-модулей из исходного списка и три выделенных generic-модуля (`color`, `palette`, `voxel-stamps`). Нет library imports в Tower shared/client/server, package/source cycles или renderer dependency в pure-пакетах.

Каждый package имеет `type: module`, корневой ESM export с `types`/`import`/`default`, `dist/index.js`, `dist/index.d.ts`, allowlist package files. `src/*` и неэкспортированные `dist/*` недоступны как package subpaths. Source/declaration maps отключены; зависимость от отсутствующих исходников в упакованных декларациях исключена. Public symbols и SHA-256 деклараций зафиксированы в Voxkera `docs/public-api.json`; `check:api` обнаруживает изменения контракта.

Полная Tower-палитра, модели, `VOXEL_BUILDERS`, enemy/tower/relic color mappings и готовый character kit находятся в `client/src/babylon/voxel/content`. Core принимает palette entries, fallback colors и material resolver от приложения. Client compatibility facades сохраняют прежний игровой интерфейс. Tower `voxel-lab` остаётся game demo/tool: пять его fixture imports направлены в Tower client content. Это явно разрешённая связь приложения с игровыми данными, не обратная зависимость Voxkera.

Обратный import `engine-recipe/demo → voxel-core/src` устранён: recipe demo находится в Tower `scripts/demo-recipe.ts` и использует public package API. Все 14 smoke imports engine sources заменены package roots. Типовая самоссылка `shared/src/types/sim.ts` сохранена; runtime-цикла она не создаёт.

## Сохранность RTS и renderer

- Зафиксированы **291** результата исходных builders, palette queries, kit seeds, stamp defaults и recipe assembly. После разделения и после установки tarballs их SHA-256 совпадают; gate: `npm run smoke:content`.
- **90** исходных gameplay/domain/UI/server/shared файлов проверены по исходным хешам с допустимой заменой package scope. Только три файла этого набора содержат такие замены: `client/src/sim/game-sim.ts`, `client/src/sim/systems/rts-world.ts`, `client/src/domain/grid-math.ts`. Остальное содержимое и исходная кодировка/line endings сохранены. Recipe compatibility facade отдельно изменён на новый package import.
- **11** source-модулей двух Babylon adapters совпадают с исходным кодом после замены `@tower/` на `@voxkera/` и нормализации line endings. Алгоритмы renderer, shaders, WGSL workaround и параметры не переписаны. Babylon не обновлялся.
- Карты, экономика, AI, costs, spells, combat, navigation behavior, модели/анимации Tower и сетевые правила не изменялись. ECS и новый WebGPU backend не добавлялись; default остаётся WebGL.

В тесте `smoke-voxel-surface` устранена ошибочная база подсчёта: Babylon лениво создаёт scene-owned `default material` при построении submeshes. Тест прогревает этот singleton до baseline, затем по-прежнему проверяет освобождение всех материалов, принадлежащих mesh. Renderer для этого не менялся.

## Проверки после переключения Tower

Среда локальной проверки: Windows, Node 24.13.0, npm 11.6.2, Babylon 7.54.3.

| Проверка | Результат |
|---|---|
| `npm run check:engine` | PASS: шесть обычных установленных npm directories, SHA/integrity совпадают, одна Babylon core; нет source workspaces, symlink/junction, deep/source imports |
| `npm run typecheck` | PASS: lab, shared, server, client |
| `npm run smoke:content` | PASS: 291 совпадение с результатами до миграции |
| `npm run smoke:rts` | PASS: все 9 существующих скриптов — rts, camera, gameplay, workers, rendering, terrain, solo, m8, unit-orders |
| `npm run smoke:rts:browser` | PASS: собственный сервер/порт, три карты, workers/orders/buildings/objectives/spells/camera, resize и disposal |
| `npm run smoke:assets` | PASS: schema/compile, 100 shared-geometry instances, poses/materials/attachments/animation/disposal, lab backend lifecycle |
| `npm run smoke:engine:consumer` | PASS: те же vendored tarballs установлены в отдельную временную папку; обычный JS runtime и TypeScript consumers, без tsx/source links |
| `npm run smoke:assets:browser` | PASS: текущий WebGL report, pixels/views, picking, attachment, fixtures, rebuild/tab disposal, resize, native resolution, console/network checks |
| `npm run build` | PASS: shared/server/client; Babylon chunk **2.66 MB ≤ 3.00 MB**, тот же hash `babylon-core-Cv0VWDF9.js` |
| `npm --workspace @tower/voxel-lab run build` | PASS в clean install |
| `npm run export:engine` | PASS: экспорт точных vendored archives и manifest; source history не экспортируется |

Дополнительный character browser прогон выявил несогласованные таймауты тестового harness: CDP отменял benchmark через 20 секунд при page deadline 60 секунд. Для этого запроса установлен timeout 65 секунд; 60 warmup и 180 measured frames, визуальные assertions и page deadline сохранены. Повторный прогон завершён успешно. Это программный WebGL/Desktop smoke, не новая hardware/mobile/WebGPU performance certification.

## Независимая установка

`npm run smoke:clean-install` создал отдельный Tower в системном temp, без engine source directories и без соседнего Voxkera. PASS:

1. `npm ci --ignore-scripts --no-audit --no-fund`.
2. `npm run typecheck` и shared build.
3. Content parity, девять RTS smokes и browser RTS.
4. Полный Tower build и voxel-lab build.

Отчёт: `artifacts/voxkera-migration/clean-install-report.json`; все восемь команд завершились с кодом 0. Успешный sandbox удалён после проверки, логи сохранены. Исходный Tower не использовался как resolver fallback.

Voxkera отдельно прошёл `npm ci --ignore-scripts` и `npm run ci`: clean build, typecheck, boundary/API gates, шесть engine test suites и isolated npm pack consumer. Последний дополнительно проверяет JS runtime всех шести APIs, character/scene lifecycle, injected materials, navigation, закрытые subpaths и Vite browser bundle. Повторный `pack:artifacts` воспроизводит archives, совпадающие с Tower vendor manifest.

Независимый production character example прошёл `npm run smoke:browser`: WebGL/SwiftShader, непустые canvas pixels, picking, attachments, invalid input preserving preview, remount/resource counts и resize. Снимки и отчёт находятся в `Voxkera/artifacts/browser`, preview — в `Voxkera/docs/media/character.png`. `testedWorkspace` в отчёте — новый Voxkera.

## TypeScript: подтверждённое ограничение

Pure packages проходят TypeScript 6.0.3, strict NodeNext и **`skipLibCheck: false`**. Все шесть пакетов проверены через настоящие packed declarations:

- TypeScript 6.0.3, Bundler, strict, `skipLibCheck: true`.
- TypeScript 5.7.3, Bundler, strict, **`skipLibCheck: false`**.

Babylon 7.54.3 имеет extensionless relative imports в `.d.ts`, несовместимые со strict NodeNext, и собственные WebGPU declarations, конфликтующие с DOM из TypeScript 6. Поэтому adapters сохраняют прежнюю Bundler/ESNext сборку. Обычный Node ESM runtime работает; **strict NodeNext types для adapters не заявлены**. Документировано в `Voxkera/docs/typescript-compatibility.md`. Исправление не маскируется патчем node_modules или обновлением renderer.

## CI и дальнейшая работа

Добавлены workflows для Windows/Linux, Node 24 и npm 11.6.2:

- Voxkera `.github/workflows/ci.yml`: clean install, package build/typecheck/API/boundaries, tests/pack consumer, production browser example, upload artifacts.
- Tower `.github/workflows/engine.yml`: проверка tarball integrity до установки, clean install, typecheck/content/RTS/assets/consumer/browser/build и bundle budget. Соседний repo не checkout-ится.

Chromium устанавливается явно, `TOWER_CHROME` задаётся для существующих smoke scripts. Browser RTS wrapper запускает собственный сервер на свободном порту, а не использует случайный чужой checkout.

Workflows подготовлены и соответствующие команды проверены локально на Windows. Удалённые GitHub Actions и Linux runner в этой сессии **не запускались**. Предупреждения Rollup об аннотациях zod и chunk >500 kB остаются; project bundle budget проходит. Публикация `0.1.0` с MIT выполнена позднее по запросу владельца; remote push и hardware WebGPU acceptance не выполнялись.

Автоматическая проверка отклонила необязательную очистку диагностического temp consumer `voxkera-consumer-cUHCJC` с причиной `blocked by policy`; каталог оставлен в системном temp. Это sandbox первого type-compatibility исследования, не зависимость Tower или Voxkera. Успешные consumer sandboxes и отдельная clean Tower-копия удалены собственными проверенными lifecycle scripts.

Для обновления engine: менять Voxkera → новая версия пакетов → `npm run ci`/browser/pack → новые tarballs и manifest в Tower → manifests/lock → Tower regression gates. Не заменять содержимое уже зафиксированного tarball под прежней версией. `build:pkgs` в Tower теперь только проверяет artifacts и не обращается к sibling source.

-- 004_cleanup_dnd.sql — drop D&D-рудиментов и inert-таблиц после концептуальной миграции
-- (см. docs/adr.md «Мигр.A/E»). Карты переехали в код (@tower/shared/maps);
-- GLB-ассеты больше не загружаются (встроенные воксель-модели); D&D-колонки
-- character_name/role gm-player-spectator не используются co-op.

-- 1. Таблица maps — больше не нужна (карты в коде, single/coop не используют /map).
DROP TABLE IF EXISTS maps;

-- 2. Таблица assets — больше не нужна (нет UI аплоада GLB; встроенные воксель-модели).
DROP TABLE IF EXISTS assets;

-- 3. D&D-колонка character_name в game_participants — никогда не использовалась co-op.
--    Удаляем колонку и её DEFAULT; таблица остаётся для coop session membership.
ALTER TABLE game_participants DROP COLUMN IF EXISTS character_name;

-- 4. role в game_participants: упрощаем CHECK до актуальных co-op-ролей.
--    Co-op использует gm (= host) и player (= guest); spectator никогда не пишет.
--    Старый CHECK уже совместим, оставляем как есть — это inert ограничение.

-- 5. default_role в users: gm/player всё ещё валидны для backwards-compat auth,
--    но клиент больше не отправляет defaultRole (Фаза A.4 — optional). Оставляем колонку
--    и CHECK без изменений (inert), чтобы не сломать старые строки users.

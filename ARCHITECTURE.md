# Архитектура проекта Planko

**Архитектурный стек:** **Clean Architecture (Чистая слоёная архитектура) + CQRS/Stores (Zustand) + 2D CAD Engine (Konva) + Repository Pattern (SQLite)**

---

## 1. Концепция и ключевые производственные требования

1. **Автономность (Offline-First):** Приложение функционирует полностью автономно на десктопе (Windows `.exe`) без внешних облачных зависимостей.
2. **Единый источник истины (Single Source of Truth):** Все проекты, стены, материалы, проемы, поколоночные сетки, кастомные сегменты и конфигурации швов сохраняются в структурированном виде.
3. **Figma-подобный 3-панельный интерфейс:**
   * **Левая панель:** Список стен, слои, перечень проемов (двери, окна, ТВ-зоны, ниши).
   * **Центральный CAD-холст:** Интерактивное 2D-пространство с панорамированием, масштабированием, точными размерами в миллиметрах, живой отрисовкой монолитных панелей, ламелей реек, проемов и светодиодных линий.
   * **Правая панель (Инспектор):** Контекстно-зависимый редактор свойств (стены, проема, ячейки или стыка) с поддержкой мульти-выбора через `Shift`.
4. **Сквозная производственная маркировка `[Лист].[Деталь]`:**
   * Каждая деталь получает производственный номер (например, `1.1`, `1.2.1`), связывающий монтажный эскиз с картой раскроя цеха.
5. **Проектный кросс-стеновой раскрой (Cross-Wall Nesting):**
   * Единая оптимизация раскроя листов `1220 × 2800` для всего проекта с переиспользованием обрезков на откосы, барные стойки и соседние стены.

---

## 2. Ключевые алгоритмы и геометрический движок (Domain Layer)

### 2.1. Алгоритм раскладки и целостности панелей (`LayoutEngine`)
* **Монолитность плит без лишнего дробления:** Проемы окон и дверей накладываются поверх панелей в виде вырезов с контурами, исключая искусственное разрезание панелей на мелкие фрагменты.
* **Иерархия ячеек сетки:** Стены делятся на колонки (`customPanels[colIdx]`), каждая из которых может иметь произвольную ширину и вертикальные сегменты (`segments[segIdx]`).

### 2.2. Алгоритм упаковки в листы при объединении блоков (`mergeSelectedCells`)
При объединении нескольких смежных ячеек сетки одного материала движок применяет правило физического ограничения листа:
1. **Расчет суммарного габарита:** Суммируются ширины колонок и промежуточные швы $8\text{ мм}$ (или высоты сегментов).
2. **Упаковка в цельные листы ($1220\text{ мм}$ для плит):**
   * Если суммарная ширина $> 1220\text{ мм}$, создается $N$ полноразмерных колонок по $1220\text{ мм}$ со стандартными швами $8\text{ мм}$ между ними.
   * Оставшийся остаток формируется в последнюю замыкающую колонку.
   * Если суммарная ширина $\le 1220\text{ мм}$, создается ровно 1 монолитная колонка.
3. **Объединение пустот (`MATERIAL_NONE_ID`):** Зоны «ПУСТО» не имеют физических ограничений и объединяются в 1 сплошной блок.

```
Случай A: 800 + 800 + 800 мм (Сумма = 2424 мм)
┌──────────────────────┬──────────────────────┐
│  Лист 1 (1220 мм)    │  Лист 2 (1196 мм)    │◄── 2 цельных листа со швом 8 мм
└──────────────────────┴──────────────────────┘

Случай B: 500 + 500 мм (Сумма = 1008 мм <= 1220 мм)
┌─────────────────────────────────────────────┐
│  Монолитная панель (1008 мм)                │◄── 1 цельный лист
└─────────────────────────────────────────────┘
```

### 2.3. Алгоритм соединения продолговатых швов в единую линию (`mergeSelectedJoints`)
* **Проверка коллинеарности и совместимости:**
  * Швы должны лежать на одной прямой ($|Y_1 - Y_2| \le 3\text{ мм}$ для горизонтальных или $|X_1 - X_2| \le 3\text{ мм}$ для вертикальных).
  * Толщина и тип подсветки (LED) должны совпадать.
* **Слияние 1D-интервалов:** Движок объединяет диапазоны координат $[\min X, \max X]$ в единую непрерывную сущность `CalculatedJointLine`.
* **Умный обход проемов:**
  * Швы, проходящие по верхней кромке проема ($Y = \text{door.height}$) или по боковым стойкам, не вырезаются, а бесшовно продолжают линию стены.
  * Вырезаются только те участки, которые проходят строго внутри тела проема ($\text{op.y} + 2 < Y < \text{op.y} + \text{op.height} - 2$).

---

## 3. Слои архитектуры

```mermaid
graph TD
    subgraph Presentation [1. Presentation Layer - React / Konva / Mantine]
        UI[3-панельный UI Figma: Стены слева | Холст по центру | Инспектор справа]
        Canvas[2D CAD Холст: Монолитные панели, интерактивные швы, размерные линии]
        Sidebar[Инспектор свойств: Стены, проемы, ячейки, мульти-выбор швов]
    end

    subgraph Application [2. Application Layer - Stores & CQRS]
        Store[useProjectStore: Управление проектом, выделение, слияние ячеек и швов]
        Validation[Валидатор соединения швов: Коллинеарность, толщина, LED]
    end

    subgraph Domain [3. Domain Layer - Pure TypeScript / Геометрия]
        LayoutEngine[LayoutEngine: Расчет сетки, упаковка листов, слияние швов, площади]
        Intervals[Interval1D: Математика вычитания отрезков и проемов]
        Models[Модели: Wall, Material, Profile, Opening, Project]
    end

    subgraph Infrastructure [4. Persistence Layer - SQLite]
        SQLiteRepo[SQLite Repository Pattern]
        Database[(Локальная SQLite БД)]
    end

    Presentation --> Application
    Application --> Domain
    Application --> Infrastructure
    Infrastructure --> Database
```

---

## 4. Модели данных (TypeScript & SQLite)

### 4.1. Основные структуры данных

```typescript
// Конфигурация шва / края
export interface JointEdgeConfig {
  id: string;
  orientation: 'VERTICAL' | 'HORIZONTAL';
  width: number;       // 0, 5, 8, 10 мм
  isLED: boolean;      // true для подсветки
  groupId?: string;    // ID группы при объединении швов
}

// Конфигурация сегмента панели
export interface PanelSegmentConfig {
  id: string;
  height?: number;     // кастомная высота сегмента в мм
  customMaterialId?: string;
  partLabel?: string;  // например "1.1", "1.2.1", "ПУСТО"
}

// Конфигурация колонки
export interface PanelCustomConfig {
  columnIndex: number;
  customWidth?: number;
  customMaterialId?: string;
  segments?: PanelSegmentConfig[];
}
```

### 4.2. Схема базы данных SQLite

```sql
-- Проекты
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Материалы (листовые, реечные, пустота)
CREATE TABLE materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('SHEET', 'SLAT')) NOT NULL,
    width REAL NOT NULL,        -- 1220 или 145
    height REAL NOT NULL,       -- 2800 или 3000
    thickness REAL NOT NULL,    -- 5, 15 или 16
    color TEXT NOT NULL,
    is_void BOOLEAN DEFAULT 0
);

-- Стены проекта
CREATE TABLE walls (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    default_joint_width REAL DEFAULT 8.0,
    default_material_id TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Индивидуальные колонки и сегменты панелей
CREATE TABLE wall_panels (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL,
    column_index INTEGER NOT NULL,
    custom_width REAL,
    custom_material_id TEXT,
    segments_json TEXT,         -- JSON массив сегментов по высоте
    FOREIGN KEY(wall_id) REFERENCES walls(id) ON DELETE CASCADE
);

-- Настройки индивидуальных и объединенных стыков
CREATE TABLE wall_joints (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL,
    joint_key TEXT NOT NULL,    -- edge-v-0, edge-h-0-1, edge-v-left и др.
    orientation TEXT NOT NULL,  -- VERTICAL / HORIZONTAL
    width REAL NOT NULL,
    is_led BOOLEAN DEFAULT 0,
    group_id TEXT,              -- идентификатор сквозной объединенной линии
    FOREIGN KEY(wall_id) REFERENCES walls(id) ON DELETE CASCADE
);

-- Проемы (двери, окна, ТВ-зоны, ниши)
CREATE TABLE openings (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('DOOR', 'WINDOW', 'TV_ZONE', 'NICHE')) NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    is_cutout BOOLEAN DEFAULT 1,
    FOREIGN KEY(wall_id) REFERENCES walls(id) ON DELETE CASCADE
);
```

---

## 5. Дорожная карта и последующие этапы

1. **Кросс-стеновой раскрой (Cross-Wall Nesting Module):**
   * Автоматическая оптимизация раскладки деталей на листах `1220 × 2800` с минимизацией отходов.
   * Автоматический раскрой откосов из узких деловых обрезков ($150–280\text{ мм}$).
2. **Экспорт чертежей и спецификаций в PDF/DXF:**
   * Формирование сборочного чертежа для монтажников с точными привязками LED-линий и стыков.
   * Формирование карт раскроя для распиловочного цеха.

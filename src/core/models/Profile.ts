export type ProfileType = 'JOINT_3' | 'JOINT_7' | 'JOINT_8' | 'H_JOINT' | 'LED_10' | 'END' | 'CORNER';

// Mounting gap is a layout allowance, not the metal wall thickness.
// Until a manufacturer's section specifies otherwise, preserve the visible-width allowance.
export const DEFAULT_JOINT_GAP_MM = 3;
export function getProfileMountingGap(profile: { visibleWidth: number; mountingGap?: number }): number {
  return profile.mountingGap ?? profile.visibleWidth;
}

export interface Profile {
  id: string;
  name: string;
  type: ProfileType;
  width: number;        // видимая ширина шва/профиля на стене в мм (3.0 мм, 7.0 мм, 10 мм и т.д.)
  metalThickness?: number; // толщина стенки металла в мм (например 0.8 мм)
  stockLength: number;  // стандартная длина хлыста (3000 мм)
  color: string;
}

export const DEFAULT_PROFILES: Record<ProfileType, Profile> = {
  JOINT_3: {
    id: 'prof-joint-3',
    name: 'Стандартный шов (3 мм)',
    type: 'JOINT_3',
    width: 3.0,
    metalThickness: 0.8,
    stockLength: 3000,
    color: '#343a40',
  },
  JOINT_7: {
    id: 'prof-joint-7',
    name: 'Декоративный шов (7 мм)',
    type: 'JOINT_7',
    width: 7.0,
    metalThickness: 0.8,
    stockLength: 3000,
    color: '#343a40',
  },
  JOINT_8: {
    id: 'prof-joint-8',
    name: 'Теневой шов (8 мм)',
    type: 'JOINT_8',
    width: 8.0,
    stockLength: 3000,
    color: '#343a40',
  },
  H_JOINT: {
    id: 'prof-h-joint',
    name: 'Соединительный профиль 3 мм (металл 0.8 мм)',
    type: 'H_JOINT',
    width: 3.0,
    metalThickness: 0.8,
    stockLength: 3000,
    color: '#495057',
  },
  LED_10: {
    id: 'prof-led-10',
    name: 'LED-профиль (10 мм, под RGB)',
    type: 'LED_10',
    width: 10.0,
    stockLength: 3000,
    color: '#ffc107',
  },
  END: {
    id: 'prof-end',
    name: 'Торцевой профиль',
    type: 'END',
    width: 1.5,
    stockLength: 3000,
    color: '#868e96',
  },
  CORNER: {
    id: 'prof-corner',
    name: 'Угловой профиль (откосы)',
    type: 'CORNER',
    width: 2.0,
    stockLength: 3000,
    color: '#868e96',
  },
};

// =============================================================================
// ПОЛНЫЙ КАТАЛОГ ДЕКОРАТИВНЫХ ПРОФИЛЕЙ ALL WALL (Технологии быстрого монтажа)
// =============================================================================

export type AllWallProfileCategory =
  | 'EXTERNAL_CORNER' // Внешний угол (EC)
  | 'CONNECTOR'       // Металлический коннектор (MC)
  | 'DECORATIVE_TRIM' // Декоративный металлический профиль (DL)
  | 'LED'             // Светодиодный профиль (паз 10 мм / карниз)
  | 'END_CAP'         // Торцевой закрывающий
  | 'SHADOW'          // Теневой шов и теневой плинтус
  | 'BASEBOARD';      // Напольный микроплинтус

export type ProfileFunctionalRole =
  | 'CORNER'    // Угловые (внешние и внутренние)
  | 'JOINT'     // Соединительные (межпанельные стыки)
  | 'END'       // Торцевые (финишные, закрывающие края и откосы)
  | 'LED'       // Светодиодные (с пазом под RGB ленту)
  | 'BASEBOARD' // Плинтусы
  | 'SHADOW';   // Теневые зазоры

export interface AllWallProfileColor {
  code: 'BLACK' | 'GOLD' | 'ROSE_GOLD' | 'SILVER';
  name: string;
  hex: string;
}

export const ALLWALL_PROFILE_COLORS: Record<string, AllWallProfileColor> = {
  BLACK: { code: 'BLACK', name: 'Чёрный', hex: '#212529' },
  GOLD: { code: 'GOLD', name: 'Золотистый', hex: '#c9a25b' },
  ROSE_GOLD: { code: 'ROSE_GOLD', name: 'Розовое золото', hex: '#b76e79' },
  SILVER: { code: 'SILVER', name: 'Серебристый', hex: '#adb5bd' },
};

export interface AllWallProfileItem {
  article: string;                    // Артикул AllWall (например: 'DL-13', 'MC-06', 'EC-01')
  name: string;                       // Понятное наименование
  category: AllWallProfileCategory;   // Категория каталога
  functionalRole: ProfileFunctionalRole; // Функциональная роль для монтажа
  stockLength: number;                // Длина хлыста в мм (стандарт 3000 мм, 2700 мм, 2500 мм)
  visibleWidth: number;               // Видимая ширина на стене в мм (3.0 мм, 7.0 мм, 10 мм, 15 мм и т.д.)
  mountingGap?: number;               // Монтажный зазор по сечению; не толщина металла
  metalThickness?: number;            // Толщина стенки металла в мм (например 0.8 мм)
  allowedThicknesses: number[];       // Допустимые толщины стыкуемых панелей [5, 8], [5] или [8]
  availableColors: AllWallProfileColor[]; // Доступная цветовая палитра
  defaultColorHex: string;            // HEX цвет по умолчанию
  description: string;                // Описание применения и особенностей
  dimensionsNote?: string;            // Дополнительные габариты (например '10x10 мм', '15x7 мм')
  isLEDCompatible?: boolean;          // Подходит ли под укладку RGB/LED ленты
}

export const ALLWALL_PROFILES_CATALOG: AllWallProfileItem[] = [
  // ---------------------------------------------------------------------------
  // 1. ВНЕШНИЕ УГЛЫ (СЕРИЯ EC — External Corner)
  // ---------------------------------------------------------------------------
  {
    article: 'EC-01',
    name: 'Внешний угол прямой с кантом EC-01',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 2.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Прямоугольный наружный угол для стыковки двух панелей под углом 90° с четким кантом.',
  },
  {
    article: 'EC-02',
    name: 'Внешний угол с фаской EC-02',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 2.5,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Наружный угол со скошенной гранью (фаской) для премиального оформления углов.',
  },
  {
    article: 'EC-03',
    name: 'Внешний угол острый минималистичный EC-03',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 1.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Минималистичный наружный угол с минимальной видимой полосой металла.',
  },
  {
    article: 'EC-04',
    name: 'Накладной L-уголок 10×10 мм EC-04',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 10.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    dimensionsNote: '10×10 мм',
    description: 'Равнополочный накладной уголок 10×10 мм для наружных углов и откосов.',
  },
  {
    article: 'EC-05',
    name: 'Накладной L-уголок 15×15 мм EC-05',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 15.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    dimensionsNote: '15×15 мм',
    description: 'Накладной металлический уголок 15×15 мм для защиты углов и колонн.',
  },
  {
    article: 'EC-06',
    name: 'Накладной L-уголок 20×20 мм EC-06',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 20.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    dimensionsNote: '20×20 мм',
    description: 'Широкий защитный уголок 20×20 мм для зон с повышенной проходимостью.',
  },
  {
    article: 'EC-07',
    name: 'Внешний угол с вогнутым желобом EC-07',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 3.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Внешний угол с декоративным вогнутым углублением по всей высоте.',
  },
  {
    article: 'EC-08',
    name: 'Внешний скругленный угол EC-08',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 5.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Радиусный полукруглый кант внешнего угла для мягких линий перехода.',
  },
  {
    article: 'EC-09',
    name: 'Внешний угол с двойной выемкой EC-09 (5 мм)',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 4.0,
    allowedThicknesses: [5],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Специализированный внешний угол для тонких панелей толщиной 5 мм.',
  },
  {
    article: 'EC-10',
    name: 'Внешний угол двойной ступенчатый EC-10 (8 мм)',
    category: 'EXTERNAL_CORNER',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 4.0,
    allowedThicknesses: [8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Ступенчатый двойной вогнутый внешний угол для панелей толщиной 8 мм.',
  },

  // ---------------------------------------------------------------------------
  // 2. МЕТАЛЛИЧЕСКИЕ КОННЕКТОРЫ И СОЕДИНИТЕЛИ (СЕРИЯ MC — Metal Connector)
  // ---------------------------------------------------------------------------
  {
    article: 'MC-01',
    name: 'Г-образный стартовый/переходной MC-01 (2.7 м)',
    category: 'CONNECTOR',
    functionalRole: 'END',
    stockLength: 2700,
    visibleWidth: 1.5,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Стартовый и завершающий профиль длиной 2700 мм для торцов и откосов.',
  },
  {
    article: 'MC-02',
    name: 'V-образный угловой коннектор MC-02',
    category: 'CONNECTOR',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 2.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'V-образный профиль для внутренних и внешних углов под 45°/90°.',
  },
  {
    article: 'MC-03',
    name: 'Т-образный стыковочный коннектор MC-03',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 1.5,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Классический соединительный Т-профиль для вертикальной и горизонтальной стыковки.',
  },
  {
    article: 'MC-04',
    name: 'Скошенный разделительный профиль MC-04',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 2.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Декоративный разделительный шов с акцентной геометрией.',
  },
  {
    article: 'MC-05',
    name: 'Н-образный силовой замковый коннектор MC-05',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 8.0,
    allowedThicknesses: [8],
    availableColors: [ALLWALL_PROFILE_COLORS.SILVER],
    defaultColorHex: ALLWALL_PROFILE_COLORS.SILVER.hex,
    description: 'Усиленный соединитель со скрытым механическим креплением саморезами к стене для плит 8 мм.',
  },
  {
    article: 'MC-06',
    name: 'Соединительный профиль 3 мм MC-06 (0.8 мм)',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 3.0,
    metalThickness: 0.8,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Стандартный соединительный профиль с видимой планкой 3 мм (толщина стенки металла 0.8 мм).',
  },
  {
    article: 'MC-06-7',
    name: 'Соединительный профиль 7 мм MC-06 (0.8 мм)',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 7.0,
    metalThickness: 0.8,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Соединительный профиль с акцентной видимой планкой 7 мм (толщина стенки металла 0.8 мм).',
  },
  {
    article: 'MC-07',
    name: 'Н-образный базовый соединитель MC-07',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 1.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Двусторонний направляющий Н-профиль скрытого и полускрытого монтажа.',
  },
  {
    article: 'MC-08',
    name: 'Крестообразный соединитель (X-стык) MC-08',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 1.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Узловой соединитель для четкой фиксации 4-х стыкуемых плит при блочной раскладке.',
  },
  {
    article: 'MC-09',
    name: 'Внутренний вогнутый угол MC-09',
    category: 'CONNECTOR',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 2.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Профиль для аккуратного оформления внутренних углов комнаты 90°.',
  },
  {
    article: 'MC-10',
    name: 'Гибкий радиусный соединитель MC-10',
    category: 'CONNECTOR',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 1.5,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Специальный профиль с насечками/зубцами для стыковки панелей на радиусных стенах и колоннах.',
  },

  // ---------------------------------------------------------------------------
  // 3. ДЕКОРАТИВНЫЕ, СВЕТОДИОДНЫЕ (LED), ТОРЦЕВЫЕ И ТЕНЕВЫЕ (СЕРИЯ DL)
  // ---------------------------------------------------------------------------
  {
    article: 'DL-13',
    name: 'Светодиодный LED-профиль 10 мм межпанельный DL-13',
    category: 'LED',
    functionalRole: 'LED',
    stockLength: 3000,
    visibleWidth: 10.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    isLEDCompatible: true,
    description: 'Специализированный профиль с пазом 10 мм и матовым светорассеивателем под монтаж RGB/LED ленты между плитами.',
  },
  {
    article: 'DL-04',
    name: 'Светодиодный LED-карниз скрытой подсветки DL-04 (8 мм)',
    category: 'LED',
    functionalRole: 'LED',
    stockLength: 3000,
    visibleWidth: 12.0,
    allowedThicknesses: [8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    isLEDCompatible: true,
    description: 'Профиль для создания парящих стен и световых ниш у потолка и изголовья кровати под панели 8 мм.',
  },
  {
    article: 'DL-14',
    name: 'Торцевой закрывающий F/U-профиль DL-14',
    category: 'END_CAP',
    functionalRole: 'END',
    stockLength: 3000,
    visibleWidth: 1.5,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Закрывающий профиль для чистовой окантовки открытых торцов панелей и боковин.',
  },
  {
    article: 'DL-16',
    name: 'Торцевой Г-образный финишный профиль DL-16',
    category: 'END_CAP',
    functionalRole: 'END',
    stockLength: 3000,
    visibleWidth: 1.5,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Завершающий край панелей у дверных коробок, оконных откосов и порталов.',
  },
  {
    article: 'DL-17',
    name: 'Шовный соединительный профиль 3 мм DL-17',
    category: 'DECORATIVE_TRIM',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 3.0,
    metalThickness: 0.8,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Плоский минималистичный межпанельный стык 3 мм (толщина металла 0.8 мм).',
  },
  {
    article: 'DL-17-7',
    name: 'Шовный соединительный профиль 7 мм DL-17',
    category: 'DECORATIVE_TRIM',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 7.0,
    metalThickness: 0.8,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Декоративный межпанельный стык 7 мм (толщина металла 0.8 мм).',
  },
  {
    article: 'DL-15',
    name: 'Внутренний угол тонкий DL-15',
    category: 'DECORATIVE_TRIM',
    functionalRole: 'CORNER',
    stockLength: 3000,
    visibleWidth: 2.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Минималистичный внутренний угол для стыковки смежных стен без видимых зазоров.',
  },
  {
    article: 'DL-10',
    name: 'Т-образная декоративная раскладка DL-10 (6-20 мм)',
    category: 'DECORATIVE_TRIM',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 10.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    dimensionsNote: 'Ширина: 6, 8, 10, 15, 20 мм',
    description: 'Акцентная Т-образная раскладка различной ширины (6, 8, 10, 15, 20 мм) для дизайнерского членения стен.',
  },
  {
    article: 'DL-12',
    name: 'U-образная декоративная вставка DL-12',
    category: 'DECORATIVE_TRIM',
    functionalRole: 'JOINT',
    stockLength: 3000,
    visibleWidth: 15.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD, ALLWALL_PROFILE_COLORS.ROSE_GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    dimensionsNote: '15×7 мм / 11×6 мм',
    description: 'Декоративная металлическая рейка-вставка между панелями.',
  },
  {
    article: 'DL-01',
    name: 'Теневой разделительный шов DL-01',
    category: 'SHADOW',
    functionalRole: 'SHADOW',
    stockLength: 3000,
    visibleWidth: 8.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Создает глубокий контрастный теневой зазор между панелями.',
  },
  {
    article: 'DL-02',
    name: 'Теневой потолочный примыкающий профиль DL-02 (8 мм)',
    category: 'SHADOW',
    functionalRole: 'SHADOW',
    stockLength: 3000,
    visibleWidth: 10.0,
    allowedThicknesses: [8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Теневой профиль верхнего примыкания отделки стены к потолку.',
  },
  {
    article: 'DL-03',
    name: 'Г-образный теневой торцевой DL-03',
    category: 'SHADOW',
    functionalRole: 'END',
    stockLength: 3000,
    visibleWidth: 2.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Теневое торцевание крайних панелей с примыканием к существующим стенам.',
  },
  {
    article: 'DL-11',
    name: 'Теневой плинтус скрытого монтажа DL-11',
    category: 'BASEBOARD',
    functionalRole: 'BASEBOARD',
    stockLength: 3000,
    visibleWidth: 15.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    description: 'Скрытый теневой плинтус под панелями для эффекта парящих стен над полом.',
  },
  {
    article: 'DL-09',
    name: 'Микроплинтус напольный DL-09 (2.5 м)',
    category: 'BASEBOARD',
    functionalRole: 'BASEBOARD',
    stockLength: 2500,
    visibleWidth: 60.0,
    allowedThicknesses: [5, 8],
    availableColors: [ALLWALL_PROFILE_COLORS.BLACK, ALLWALL_PROFILE_COLORS.GOLD],
    defaultColorHex: ALLWALL_PROFILE_COLORS.BLACK.hex,
    dimensionsNote: 'Высота: 60 мм / 80 мм, длина: 2500 мм',
    description: 'Напольный металлический микроплинтус высотой 60 мм или 80 мм под панели AllWall.',
  },
];

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ СПРАВОЧНИКА
// =============================================================================

export function findProfileByArticle(article: string): AllWallProfileItem | undefined {
  if (!article) return undefined;
  const clean = article.trim().toUpperCase();
  return ALLWALL_PROFILES_CATALOG.find((p) => p.article.toUpperCase() === clean);
}

export function getProfilesByRole(role: ProfileFunctionalRole): AllWallProfileItem[] {
  return ALLWALL_PROFILES_CATALOG.filter((p) => p.functionalRole === role);
}

export function getProfilesForThickness(thickness: number): AllWallProfileItem[] {
  return ALLWALL_PROFILES_CATALOG.filter((p) => p.allowedThicknesses.includes(thickness));
}

export interface AllWallDecor {
  code: string;             // например: '7029', '5134', 'RY8056', 'LG2146'
  name: string;             // например: 'Ткань Бежевая 7029', 'Дуб Натуральный 5134'
  color: string;            // HEX цвет (#d4c8b8, #5a3d28)
  category: 'FABRIC' | 'WOOD' | 'STONE' | 'MIRROR' | 'METAL' | 'SOFT_TOUCH' | 'MARBLE_HQ' | 'GOLD_HQ';
  imageUrl?: string;
  isPopular?: boolean;
}

export type SlatProfileShape = 'FLAT' | 'WAVE_GW90' | 'CONCAVE_GW30' | 'STEP_SLAT';

export interface AllWallPanelModel {
  id: string;
  name: string;
  category: 'SHEET' | 'SLAT' | 'HQ';
  width: number;            // базовый размер мм (например 1220 или 158)
  height: number;           // базовый размер мм (например 2800 или 3000)
  thicknessOptions: number[]; // доступные толщины [5, 8] или [15]
  defaultThickness: number;
  reliefType: SlatProfileShape;
  textureCategory: 'FABRIC' | 'WOOD' | 'STONE' | 'MIRROR' | 'METAL' | 'SOFT_TOUCH' | 'MARBLE_HQ' | 'GOLD_HQ';
  decors: AllWallDecor[];
  description: string;
  url: string;
  isCustom?: boolean;
}

// -----------------------------------------------------------------------------
// База декоров AllWall (Спарсено с allwall.by)
// -----------------------------------------------------------------------------

export const ALLWALL_DECORS_FABRIC: AllWallDecor[] = [
  { code: '7029', name: 'Лен Песочный 7029', color: '#c4b5a2', category: 'FABRIC', isPopular: true },
  { code: '7206', name: 'Ткань Серый Меланж 7206', color: '#9e9c97', category: 'FABRIC' },
  { code: '7207', name: 'Ткань Графит 7207', color: '#52504d', category: 'FABRIC' },
  { code: '7204', name: 'Рогожка Беж 7204', color: '#d9cdb8', category: 'FABRIC', isPopular: true },
  { code: '7102', name: 'Текстиль Капучино 7102', color: '#ad9c88', category: 'FABRIC' },
  { code: '7112', name: 'Ткань Дымчатая 7112', color: '#b5b2aa', category: 'FABRIC' },
  { code: '7138', name: 'Ткань Темный Антрацит 7138', color: '#3d3b38', category: 'FABRIC' },
];

export const ALLWALL_DECORS_WOOD: AllWallDecor[] = [
  { code: '5134', name: 'Дуб Натуральный 5134', color: '#a0784a', category: 'WOOD', isPopular: true },
  { code: '5186', name: 'Орех Американский 5186', color: '#684a32', category: 'WOOD', isPopular: true },
  { code: '5187', name: 'Дуб Рустик 5187', color: '#886241', category: 'WOOD' },
  { code: '5189', name: 'Темный Орех 5189', color: '#4d3725', category: 'WOOD' },
  { code: '5152', name: 'Беленый Ясень 5152', color: '#cbbda9', category: 'WOOD' },
  { code: '5165', name: 'Дуб Медовый 5165', color: '#ab814e', category: 'WOOD' },
  { code: '5167', name: 'Ясень Сканди 5167', color: '#b9a58b', category: 'WOOD' },
  { code: '5173', name: 'Дуб Карамель 5173', color: '#976e43', category: 'WOOD' },
  { code: '5009', name: 'Венге 5009', color: '#32251d', category: 'WOOD' },
  { code: '5147', name: 'Тик 5147', color: '#8d603a', category: 'WOOD' },
  { code: '5007', name: 'Дуб Мореный 5007', color: '#3e322b', category: 'WOOD' },
  { code: '5190', name: 'Орех Седой 5190', color: '#7a6a5d', category: 'WOOD' },
  { code: '5022', name: 'Палисандр 5022', color: '#4a2e22', category: 'WOOD' },
];

export const ALLWALL_DECORS_STONE: AllWallDecor[] = [
  { code: '6302', name: 'Бетон Лофт 6302', color: '#a4a39f', category: 'STONE', isPopular: true },
  { code: '6307', name: 'Сланец Темный 6307', color: '#595958', category: 'STONE' },
  { code: '8805-8', name: 'Песчаник Светлый 8805-8', color: '#d2c7b5', category: 'STONE' },
  { code: '6153', name: 'Микроцемент Серый 6153', color: '#8c8b87', category: 'STONE', isPopular: true },
  { code: '8807-10', name: 'Гранит Антрацит 8807-10', color: '#414345', category: 'STONE' },
  { code: '6125', name: 'Штукатурка Травертин 6125', color: '#c9beaf', category: 'STONE' },
  { code: '6120', name: 'Бетон Светлый 6120', color: '#bcbbb6', category: 'STONE' },
  { code: '8016-3', name: 'Мрамор Матовый 8016-3', color: '#ddd9d0', category: 'STONE' },
  { code: '8806-8', name: 'Сланец Бежевый 8806-8', color: '#b8ab9a', category: 'STONE' },
  { code: '8201-8', name: 'Базальт 8201-8', color: '#4e4f50', category: 'STONE' },
  { code: '6303', name: 'Индустриальный Бетон 6303', color: '#7e7e7a', category: 'STONE' },
  { code: '8040', name: 'Скала Серый 8040', color: '#6e6f6f', category: 'STONE' },
];

export const ALLWALL_DECORS_MIRROR: AllWallDecor[] = [
  { code: '2217-30', name: 'Зеркало Серебро 2217-30', color: '#d8dee3', category: 'MIRROR', isPopular: true },
  { code: '8012-15', name: 'Зеркало Бронза 8012-15', color: '#a88566', category: 'MIRROR' },
  { code: '8803-30', name: 'Зеркало Графит 8803-30', color: '#555b61', category: 'MIRROR', isPopular: true },
  { code: '8804-30', name: 'Зеркало Титан 8804-30', color: '#7a8187', category: 'MIRROR' },
  { code: '8807-10', name: 'Зеркало Черный Глянец 8807-10', color: '#2b2d30', category: 'MIRROR' },
  { code: '8812-15', name: 'Зеркало Золото 8812-15', color: '#c9a25b', category: 'MIRROR' },
  { code: '2223-30', name: 'Зеркало Шампань 2223-30', color: '#c8b99d', category: 'MIRROR' },
  { code: '8810-15', name: 'Зеркало Медь 8810-15', color: '#ad6a52', category: 'MIRROR' },
];

export const ALLWALL_DECORS_METAL: AllWallDecor[] = [
  { code: '2012-35', name: 'Брашированный Алюминий 2012-35', color: '#b1b6ba', category: 'METAL', isPopular: true },
  { code: '2007-15', name: 'Брашированная Латунь 2007-15', color: '#bf9b59', category: 'METAL', isPopular: true },
  { code: '2123-10', name: 'Брашированная Медь 2123-10', color: '#b06849', category: 'METAL' },
  { code: '2220-25', name: 'Темный Титан 2220-25', color: '#4a4f54', category: 'METAL' },
  { code: '2015-35', name: 'Черный Матовый Металл 2015-35', color: '#27292b', category: 'METAL' },
  { code: '2201-30', name: 'Хром Сатин 2201-30', color: '#cad0d4', category: 'METAL' },
  { code: '2204-30', name: 'Шампань Металл 2204-30', color: '#bdae95', category: 'METAL' },
];

export const ALLWALL_DECORS_SOFT_TOUCH: AllWallDecor[] = [
  { code: '1022', name: 'Soft-Touch Белый Теплый 1022', color: '#eae7df', category: 'SOFT_TOUCH', isPopular: true },
  { code: '1013-8', name: 'Soft-Touch Крем 1013-8', color: '#ded7c9', category: 'SOFT_TOUCH' },
  { code: '1011-8', name: 'Soft-Touch Кашемир 1011-8', color: '#c8bfb1', category: 'SOFT_TOUCH', isPopular: true },
  { code: '10087A-5', name: 'Soft-Touch Пудровый 10087A-5', color: '#c7b4aa', category: 'SOFT_TOUCH' },
  { code: '1088-5', name: 'Soft-Touch Графит 1088-5', color: '#4a4a4b', category: 'SOFT_TOUCH' },
  { code: '1092-5', name: 'Soft-Touch Черный Бархат 1092-5', color: '#232425', category: 'SOFT_TOUCH', isPopular: true },
  { code: '1053-5', name: 'Soft-Touch Олива 1053-5', color: '#687063', category: 'SOFT_TOUCH' },
  { code: '1052-5', name: 'Soft-Touch Серо-Синий 1052-5', color: '#5b6b75', category: 'SOFT_TOUCH' },
  { code: '1085-5', name: 'Soft-Touch Терракота 1085-5', color: '#9e5a48', category: 'SOFT_TOUCH' },
  { code: '1081A-5', name: 'Кожа Бежевая 1081A-5', color: '#bfaa96', category: 'SOFT_TOUCH' },
];

export const ALLWALL_DECORS_HQ_GLOSS_MARBLE: AllWallDecor[] = [
  { code: 'RY8085', name: 'Калакатта Роял RY8085', color: '#e8e7e1', category: 'MARBLE_HQ', isPopular: true },
  { code: 'RY8047', name: 'Неро Марквина RY8047', color: '#2c2d30', category: 'MARBLE_HQ', isPopular: true },
  { code: 'RY8045', name: 'Статуарио Экстра RY8045', color: '#ecebe6', category: 'MARBLE_HQ' },
  { code: 'RY8038', name: 'Оникс Серый RY8038', color: '#9ea0a2', category: 'MARBLE_HQ' },
  { code: 'RY8056', name: 'Мрамор Бьянко Золото RY8056', color: '#e3ded4', category: 'MARBLE_HQ', isPopular: true },
  { code: 'RY8009', name: 'Имперадор Дарк RY8009', color: '#45382f', category: 'MARBLE_HQ' },
  { code: 'RY8079', name: 'Арабескато RY8079', color: '#dbd8d0', category: 'MARBLE_HQ' },
  { code: 'RY8078', name: 'Панда Вайт RY8078', color: '#f0ede6', category: 'MARBLE_HQ' },
  { code: 'RY8021-4', name: 'Оникс Медовый RY8021-4', color: '#c4a678', category: 'MARBLE_HQ' },
  { code: 'RY8041', name: 'Гриджио Оробико RY8041', color: '#686b6e', category: 'MARBLE_HQ' },
  { code: 'RY8063-2', name: 'Браун Сильвер RY8063-2', color: '#5a4f49', category: 'MARBLE_HQ' },
];

export const ALLWALL_DECORS_HQ_GOLD: AllWallDecor[] = [
  { code: 'LG2142', name: 'Бесконечное Золото Агат LG2142', color: '#cfba8f', category: 'GOLD_HQ', isPopular: true },
  { code: 'LG2141', name: 'Золотые Вены LG2141', color: '#d8c7a2', category: 'GOLD_HQ' },
  { code: 'LG2146', name: 'Черное Золото LG2146', color: '#383633', category: 'GOLD_HQ', isPopular: true },
  { code: 'LG2054', name: 'Латунная Река LG2054', color: '#bfa472', category: 'GOLD_HQ' },
  { code: 'LG2030', name: 'Золотой Оникс LG2030', color: '#d4b77f', category: 'GOLD_HQ' },
  { code: 'LG2125', name: 'Белое Золото LG2125', color: '#e4dcce', category: 'GOLD_HQ' },
];

export const ALLWALL_DECORS_HQ_BOOKMATCH: AllWallDecor[] = [
  { code: 'LW9015', name: 'Стыкуемый Калакатта Оро LW9015', color: '#e7e3d9', category: 'MARBLE_HQ', isPopular: true },
  { code: 'LW1018', name: 'Бесконечный Неро LW1018', color: '#2a2c2e', category: 'MARBLE_HQ', isPopular: true },
  { code: 'LW1009', name: 'Бесконечный Статуарио LW1009', color: '#eae6df', category: 'MARBLE_HQ' },
  { code: 'LW1020', name: 'Стыкуемый Азур LW1020', color: '#566e7a', category: 'MARBLE_HQ' },
  { code: 'LW1048', name: 'Бесконечный Патагония LW1048', color: '#c7b89f', category: 'MARBLE_HQ' },
  { code: 'LW7017', name: 'Стыкуемый Сахара Блэк LW7017', color: '#2f2c2a', category: 'MARBLE_HQ' },
  { code: 'LW9044', name: 'Бесконечный Кварцит LW9044', color: '#b9b4a9', category: 'MARBLE_HQ' },
];

// Все декоры в едином справочнике
export const ALL_ALLWALL_DECORS: AllWallDecor[] = [
  ...ALLWALL_DECORS_FABRIC,
  ...ALLWALL_DECORS_WOOD,
  ...ALLWALL_DECORS_STONE,
  ...ALLWALL_DECORS_MIRROR,
  ...ALLWALL_DECORS_METAL,
  ...ALLWALL_DECORS_SOFT_TOUCH,
  ...ALLWALL_DECORS_HQ_GLOSS_MARBLE,
  ...ALLWALL_DECORS_HQ_GOLD,
  ...ALLWALL_DECORS_HQ_BOOKMATCH,
];

// -----------------------------------------------------------------------------
// Каталог моделей панелей AllWall
// -----------------------------------------------------------------------------

export const ALLWALL_CATALOG_MODELS: AllWallPanelModel[] = [
  // === 1. СПЛОШНЫЕ ПАНЕЛИ ===
  {
    id: 'aw-sheet-fabric',
    name: 'Сплошная панель: Ткань',
    category: 'SHEET',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'FABRIC',
    decors: ALLWALL_DECORS_FABRIC,
    description: 'Текстильные поверхности с фактурой льна, рогожки и меланжа. Уютный премиальный вид.',
    url: 'https://allwall.by/sploshnaya-bambukovaya-panel-tkan',
  },
  {
    id: 'aw-sheet-wood',
    name: 'Сплошная панель: Дерево',
    category: 'SHEET',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Реалистичные текстуры натурального дуба, ореха, ясеня и венге с тиснением пор.',
    url: 'https://allwall.by/sploshnaya-bambukovaya-panel-derevo',
  },
  {
    id: 'aw-sheet-stone',
    name: 'Сплошная панель: Камень & Бетон',
    category: 'SHEET',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'STONE',
    decors: ALLWALL_DECORS_STONE,
    description: 'Матовый камень, гранит, сланец и микроцемент для стилей лофт, минимализм и джапанди.',
    url: 'https://allwall.by/sploshnaya-bambukovaya-panel-kamen',
  },
  {
    id: 'aw-sheet-mirror',
    name: 'Сплошная панель: Зеркало',
    category: 'SHEET',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'MIRROR',
    decors: ALLWALL_DECORS_MIRROR,
    description: 'Высокоглянцевые зеркальные отражающие панели (серебро, графит, титан, золото).',
    url: 'https://allwall.by/sploshnaya-bambukovaya-panel-zerkalo',
  },
  {
    id: 'aw-sheet-metal',
    name: 'Сплошная панель: Металл',
    category: 'SHEET',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'METAL',
    decors: ALLWALL_DECORS_METAL,
    description: 'Брашированный алюминий, латунь, медь и темная сталь с металлическим блеском.',
    url: 'https://allwall.by/sploshnaya-bambukovaya-panel-metall',
  },
  {
    id: 'aw-sheet-softtouch',
    name: 'Сплошная панель: Soft Touch & Кожа',
    category: 'SHEET',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'SOFT_TOUCH',
    decors: ALLWALL_DECORS_SOFT_TOUCH,
    description: 'Бархатистые матовые супергладкие покрытия Soft-touch и фактурная кожа.',
    url: 'https://allwall.by/sploshnaya-bambukovaya-panel-soft-touch',
  },

  // === 2. РЕЕЧНЫЕ ПАНЕЛИ (1000+ цветов / декоров AllWall) ===
  {
    id: 'aw-slat-gw90',
    name: 'Реечная панель: GW90 Волна (Гофре)',
    category: 'SLAT',
    width: 158,
    height: 3000,
    thicknessOptions: [15],
    defaultThickness: 15,
    reliefType: 'WAVE_GW90',
    textureCategory: 'WOOD',
    decors: [...ALLWALL_DECORS_WOOD, ...ALLWALL_DECORS_SOFT_TOUCH, ...ALLWALL_DECORS_METAL],
    description: 'Изысканный волновой 3D-профиль из полукруглых радиусных дуг (гофре / fluted). 158 × 15 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw90',
  },
  {
    id: 'aw-slat-gw30',
    name: 'Реечная панель: GW30 Комбинированный желоб',
    category: 'SLAT',
    width: 153,
    height: 3000,
    thicknessOptions: [16],
    defaultThickness: 16,
    reliefType: 'CONCAVE_GW30',
    textureCategory: 'WOOD',
    decors: [...ALLWALL_DECORS_WOOD, ...ALLWALL_DECORS_SOFT_TOUCH],
    description: 'Сложный 3D-профиль: центральный вогнутый желоб + боковые прямоугольные рейки. 153 × 16 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw30',
  },
  {
    id: 'aw-slat-gw10',
    name: 'Реечная панель: GW10 Узкая рейка',
    category: 'SLAT',
    width: 53,
    height: 3000,
    thicknessOptions: [17],
    defaultThickness: 17,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Компактная акцентная рейка с глубоким шагом. 53 × 17 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw10',
  },
  {
    id: 'aw-slat-gw16',
    name: 'Реечная панель: GW16 Массивная',
    category: 'SLAT',
    width: 210,
    height: 3000,
    thicknessOptions: [22],
    defaultThickness: 22,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Широкая массивная рейка увеличенной глубины (22 мм). 210 × 22 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw16',
  },
  {
    id: 'aw-slat-gw40',
    name: 'Реечная панель: GW40 Тонкая',
    category: 'SLAT',
    width: 130,
    height: 3000,
    thicknessOptions: [9],
    defaultThickness: 9,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Тонкий реечный профиль для минималистичных интерьеров. 130 × 9 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw40',
  },
  {
    id: 'aw-slat-gw20',
    name: 'Реечная панель: GW20 Глубокий баффель',
    category: 'SLAT',
    width: 177,
    height: 3000,
    thicknessOptions: [22],
    defaultThickness: 22,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Классический глубокий баффель с четкой теневой геометрией. 177 × 22 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw20',
  },
  {
    id: 'aw-slat-gw22',
    name: 'Реечная панель: GW22 Средняя',
    category: 'SLAT',
    width: 172,
    height: 3000,
    thicknessOptions: [18],
    defaultThickness: 18,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Универсальная интерьерная реечная панель. 172 × 18 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw22',
  },
  {
    id: 'aw-slat-gw60',
    name: 'Реечная панель: GW60 Плоский ритм',
    category: 'SLAT',
    width: 199,
    height: 3000,
    thicknessOptions: [11],
    defaultThickness: 11,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Широкая ритмичная ламель. 199 × 11 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw60',
  },
  {
    id: 'aw-slat-gw99',
    name: 'Реечная панель: GW99 Нишевая',
    category: 'SLAT',
    width: 83,
    height: 3000,
    thicknessOptions: [14],
    defaultThickness: 14,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Компактная узкая рейка для ниш, откосов и колонн. 83 × 14 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw99',
  },
  {
    id: 'aw-slat-gw15',
    name: 'Реечная панель: GW15 Тонкая широкая',
    category: 'SLAT',
    width: 204,
    height: 3000,
    thicknessOptions: [10],
    defaultThickness: 10,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Элегантный плоский профиль 204 × 10 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw15',
  },
  {
    id: 'aw-slat-gw68',
    name: 'Реечная панель: GW68 Экстра-глубокая',
    category: 'SLAT',
    width: 200,
    height: 3000,
    thicknessOptions: [25],
    defaultThickness: 25,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Максимальный объем и выразительная тень (25 мм). 200 × 25 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw68',
  },
  {
    id: 'aw-slat-gw23',
    name: 'Реечная панель: GW23 Фасадная',
    category: 'SLAT',
    width: 220,
    height: 3000,
    thicknessOptions: [12],
    defaultThickness: 12,
    reliefType: 'STEP_SLAT',
    textureCategory: 'WOOD',
    decors: ALLWALL_DECORS_WOOD,
    description: 'Крупноформатная рейка для акцентных стен. 220 × 12 × 3000 мм.',
    url: 'https://allwall.by/reechnaya-stenovaya-panel-gw23',
  },

  // === 3. HQ ПАНЕЛИ (HIGH QUALITY) ===
  {
    id: 'aw-hq-gloss-marble',
    name: 'HQ-панель: Глянцевый мрамор',
    category: 'HQ',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'MARBLE_HQ',
    decors: ALLWALL_DECORS_HQ_GLOSS_MARBLE,
    description: 'Зеркальный суперглянец и сверхчеткий рисунок итальянского мрамора Калакатта, Неро Марквина.',
    url: 'https://allwall.by/hq-bambukovaya-panel-glyancevyj-mramor',
  },
  {
    id: 'aw-hq-gold',
    name: 'HQ-панель: Бесконечное золото',
    category: 'HQ',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'GOLD_HQ',
    decors: ALLWALL_DECORS_HQ_GOLD,
    description: 'Художественные слэбы с непрерывными золотыми и латунными прожилками (серия LG).',
    url: 'https://allwall.by/hq-bambukovaya-panel-beskonechnoe-zoloto',
  },
  {
    id: 'aw-hq-bookmatch',
    name: 'HQ-панель: Бесконечный мрамор (Bookmatch)',
    category: 'HQ',
    width: 1220,
    height: 2800,
    thicknessOptions: [5, 8],
    defaultThickness: 5,
    reliefType: 'FLAT',
    textureCategory: 'MARBLE_HQ',
    decors: ALLWALL_DECORS_HQ_BOOKMATCH,
    description: 'Стыкуемый рисунок с эффектом раскрытия «бабочки» для непрерывных стен без прерывания вен (серия LW).',
    url: 'https://allwall.by/hq-bambukovaya-panel-beskonechnyj-mramor',
  },
];

// Хелпер быстрого поиска декора по коду
export function findDecorByCode(code: string): AllWallDecor | undefined {
  if (!code) return undefined;
  const clean = code.trim().toUpperCase();
  return ALL_ALLWALL_DECORS.find(
    (d) => d.code.toUpperCase() === clean || d.code.toUpperCase().replace(/[^A-Z0-9]/g, '') === clean.replace(/[^A-Z0-9]/g, '')
  );
}

// Хелпер поиска модели по ID
export function findModelById(modelId: string): AllWallPanelModel | undefined {
  return ALLWALL_CATALOG_MODELS.find((m) => m.id === modelId);
}

// Реэкспорт справочника профилей AllWall
export * from './Profile';


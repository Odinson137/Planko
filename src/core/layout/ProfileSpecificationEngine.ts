import { Wall } from '../models/Wall';
import { LayoutEngine, LayoutCalculationResult, CalculatedJointLine } from './LayoutEngine';
import { Material, DEFAULT_MATERIALS } from '../models/Material';
import { DEFAULT_PROFILES, findProfileByArticle } from '../models/Profile';

export type StandardProfileCategory = 'H_JOINT_08' | 'LED_10' | 'END_CAP' | 'CORNER' | 'BASEBOARD' | 'OTHER';

export interface ProfileCategoryInfo {
  type: StandardProfileCategory;
  name: string;
  article: string;
  defaultWidth: number;
  colorHex: string;
  stockLengthMm: number; // 3000 mm
  description: string;
}

export const PROFILE_CATEGORIES_INFO: Record<StandardProfileCategory, ProfileCategoryInfo> = {
  H_JOINT_08: {
    type: 'H_JOINT_08',
    name: 'Соединительный профиль (3 мм / 7 мм)',
    article: 'MC-06 / DL-17',
    defaultWidth: 3.0,
    colorHex: '#3b82f6', // Синий
    stockLengthMm: 3000,
    description: 'Тонкий межпанельный стыковочный профиль (видимая часть 3 мм / 7 мм, металл 0.8 мм)',
  },
  LED_10: {
    type: 'LED_10',
    name: 'Светодиодный LED-профиль (10 мм, под RGB)',
    article: 'DL-13',
    defaultWidth: 10.0,
    colorHex: '#f59e0b', // Янтарный / Жёлтый
    stockLengthMm: 3000,
    description: 'Профиль с пазом 10 мм и матовым рассеивателем под монтаж светодиодной ленты',
  },
  END_CAP: {
    type: 'END_CAP',
    name: 'Торцевой закрывающий профиль',
    article: 'DL-14 / DL-16',
    defaultWidth: 1.5,
    colorHex: '#ef4444', // Красный
    stockLengthMm: 3000,
    description: 'Завершающий край панелей у дверных коробок, откосов и боковин',
  },
  CORNER: {
    type: 'CORNER',
    name: 'Угловой профиль (внешний / внутренний)',
    article: 'EC-01 / MC-02',
    defaultWidth: 2.0,
    colorHex: '#06b6d4', // Циан
    stockLengthMm: 3000,
    description: 'Профиль для аккуратного оформления внешних и внутренних углов 90°',
  },
  BASEBOARD: {
    type: 'BASEBOARD',
    name: 'Плинтус / Теневой зазор',
    article: 'DL-11 / DL-01',
    defaultWidth: 15.0,
    colorHex: '#8b5cf6', // Фиолетовый
    stockLengthMm: 3000,
    description: 'Теневой профиль примыкания к полу/потолку',
  },
  OTHER: {
    type: 'OTHER',
    name: 'Специальный профиль',
    article: 'MC / DL',
    defaultWidth: 8.0,
    colorHex: '#6b7280', // Серый
    stockLengthMm: 3000,
    description: 'Стандартный шовный профиль',
  },
};

export interface WallProfileItemSummary {
  category: StandardProfileCategory;
  visibleWidth: number;
  metalThickness?: number;
  stockLengthMm: number;
  profileColor?: string;
  name: string;
  article: string;
  colorHex: string;
  totalLengthMm: number;
  totalLinearMeters: number;
  stockBarsCount: number;
  segmentsCount: number;
  segmentLengthsMm: number[]; // Preserve individual cuts when combining orders across walls.
}

export interface WallProfilesReport {
  wallId: string;
  wallName: string;
  wallWidth: number;
  wallHeight: number;
  items: WallProfileItemSummary[];
  totalLinearMeters: number;
  totalStockBars: number;
}

export interface ProjectProfilesReport {
  totalLinearMeters: number;
  totalStockBars: number;
  byCategorySummary: WallProfileItemSummary[];
  wallReports: WallProfilesReport[];
}

type ProfileIdentity = Pick<WallProfileItemSummary, 'category' | 'name' | 'article' | 'colorHex' | 'visibleWidth' | 'metalThickness' | 'stockLengthMm' | 'profileColor'>;

function profileKey(item: ProfileIdentity): string {
  return JSON.stringify([item.category, item.article, item.visibleWidth, item.metalThickness, item.stockLengthMm, item.profileColor?.toLowerCase()]);
}

// First-fit decreasing keeps each segment intact when it fits a stock bar.
// Longer tracks require joints; their full bars and remaining tail are counted separately.
// Saw allowance and an extra purchase reserve are not configured for profiles yet.
function countStockBars(lengths: number[], stockLength: number): number {
  let fullBars = 0;
  const tails: number[] = [];
  for (const length of lengths) {
    if (length <= 0) continue;
    fullBars += Math.floor(length / stockLength);
    const tail = length % stockLength;
    if (tail > 1e-6) tails.push(tail);
  }
  const remaining: number[] = [];
  for (const tail of tails.sort((a, b) => b - a)) {
    const bar = remaining.findIndex(space => space + 1e-6 >= tail);
    if (bar < 0) remaining.push(stockLength - tail);
    else remaining[bar] -= tail;
  }
  return fullBars + remaining.length;
}

function profileIdentity(category: StandardProfileCategory, joint?: Partial<CalculatedJointLine>): ProfileIdentity {
  const info = PROFILE_CATEGORIES_INFO[category];
  const profile = joint?.profileArticle ? findProfileByArticle(joint.profileArticle) : undefined;
  return {
    category,
    name: profile?.name ?? (category === 'H_JOINT_08' ? 'Соединительный профиль' : info.name),
    article: profile?.article ?? joint?.profileArticle ?? 'Не выбран',
    colorHex: info.colorHex,
    visibleWidth: profile?.visibleWidth ?? joint?.width ?? info.defaultWidth,
    metalThickness: profile?.metalThickness,
    stockLengthMm: profile?.stockLength ?? info.stockLengthMm,
    profileColor: joint?.profileColor ?? profile?.defaultColorHex,
  };
}

export class ProfileSpecificationEngine {
  public static categorizeJoint(joint: CalculatedJointLine): StandardProfileCategory {
    if (joint.isLED) {
      return 'LED_10';
    }

    if (joint.profileArticle) {
      const art = joint.profileArticle.toUpperCase();
      const pItem = findProfileByArticle(art);
      if (pItem) {
        if (pItem.isLEDCompatible || pItem.category === 'LED') return 'LED_10';
        if (pItem.functionalRole === 'CORNER' || pItem.category === 'EXTERNAL_CORNER') return 'CORNER';
        if (pItem.functionalRole === 'END' || pItem.category === 'END_CAP') return 'END_CAP';
        if (pItem.functionalRole === 'BASEBOARD' || pItem.category === 'SHADOW') return 'BASEBOARD';
        if (pItem.functionalRole === 'JOINT') return 'H_JOINT_08';
      }
    }

    if (joint.isOuterEdge) {
      return 'END_CAP';
    }

    if (joint.width >= 0.5 && joint.width <= 7.5) {
      return 'H_JOINT_08';
    }

    if (joint.width >= 9 && joint.width <= 12) {
      return 'LED_10';
    }

    return 'OTHER';
  }

  /**
   * Рассчитывает спецификацию профилей для одной стены
   */
  public static calculateWallProfiles(
    wall: Wall,
    defaultMaterial: Material,
    allMaterials: Material[] = DEFAULT_MATERIALS,
    wallIndexOrNumber: number = 1
  ): WallProfilesReport {
    const layout: LayoutCalculationResult = LayoutEngine.calculateWallLayout(wall, defaultMaterial, allMaterials, wallIndexOrNumber);
    const activeJoints = layout.joints.filter((j) => j.width > 0 || j.isLED || j.profileArticle);

    const map = new Map<string, { identity: ProfileIdentity; lengths: number[]; count: number }>();

    activeJoints.forEach((j) => {
      const cat = this.categorizeJoint(j);
      const identity = profileIdentity(cat, j);
      const key = profileKey(identity);
      const entry = map.get(key) || { identity, lengths: [], count: 0 };
      entry.lengths.push(j.length);
      entry.count++;
      map.set(key, entry);
    });

    // Учет профилей обрамления проемов (двери, окна, ниши)
    if (wall.openings && wall.openings.length > 0) {
      wall.openings.forEach((op) => {
        if (op.isCutout === false) return;
        if (op.framing) {
          for (const side of ['left', 'right', 'top', 'bottom'] as const) {
            if (side === 'bottom' && op.type === 'DOOR' && op.y <= 5) continue;
            const edge = op.framing[side];
            if (!edge || (edge.width <= 0 && !edge.profileArticle && !edge.isLED)) continue;
            const joint = { ...edge, isOuterEdge: true } as CalculatedJointLine;
            const identity = profileIdentity(this.categorizeJoint(joint), joint);
            const key = profileKey(identity);
            const entry = map.get(key) || { identity, lengths: [], count: 0 };
            entry.lengths.push(side === 'top' || side === 'bottom' ? op.width : op.height);
            entry.count++;
            map.set(key, entry);
          }
          const slopes = op.slopes;
          const type = slopes?.jointProfileType;
          if (slopes?.enabled && type && type !== 'NONE') {
            const profile = DEFAULT_PROFILES[type];
            const article = type === 'JOINT_3' ? 'MC-06' : type === 'JOINT_7' ? 'MC-06-7' : undefined;
            const category = type === 'CORNER' ? 'CORNER' : type === 'LED_10' ? 'LED_10' : type === 'JOINT_8' ? 'BASEBOARD' : 'H_JOINT_08';
            const identity = profileIdentity(category, { width: profile.width, profileArticle: article });
            const key = profileKey(identity);
            const entry = map.get(key) || { identity, lengths: [], count: 0 };
            const depth = (side: 'top' | 'bottom' | 'left' | 'right') => slopes.fitToOpeningDepth
              ? (op.depth ?? (op.type === 'WINDOW' ? 200 : 150))
              : slopes.depthMode === 'SAME' ? slopes.depth : slopes[side].depth;
            for (const [a, b] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as const) {
              if (slopes[a].enabled && slopes[b].enabled) {
                entry.lengths.push(Math.max(depth(a), depth(b)));
                entry.count++;
              }
            }
            if (entry.count) map.set(key, entry);
          }
          return;
        }
        const hasSlopes = op.slopes?.enabled !== false;
        const opCat: StandardProfileCategory = hasSlopes ? 'CORNER' : 'END_CAP';

        const perim = op.type === 'DOOR'
          ? (op.y <= 5 ? op.width + op.height * 2 : (op.width + op.height) * 2)
          : (op.width + op.height) * 2;

        if (perim > 0) {
          const identity = profileIdentity(opCat);
          const key = profileKey(identity);
          const entry = map.get(key) || { identity, lengths: [], count: 0 };
          entry.lengths.push(op.width, op.height, op.height);
          if (op.type !== 'DOOR' || op.y > 5) entry.lengths.push(op.width);
          entry.count += (op.type === 'DOOR' && op.y <= 5 ? 3 : 4);
          map.set(key, entry);
        }
      });
    }

    const items: WallProfileItemSummary[] = [];
    let totalWallMeters = 0;
    let totalWallBars = 0;

    map.forEach((data) => {
      const sumMm = data.lengths.reduce((acc, l) => acc + l, 0);
      const meters = Math.round((sumMm / 1000) * 100) / 100;
      
      const barsCount = countStockBars(data.lengths, data.identity.stockLengthMm);

      totalWallMeters += meters;
      totalWallBars += barsCount;

      items.push({
        ...data.identity,
        totalLengthMm: sumMm,
        totalLinearMeters: meters,
        stockBarsCount: barsCount,
        segmentsCount: data.count,
        segmentLengthsMm: [...data.lengths],
      });
    });

    // Сортировка: LED -> Соединительные -> Торцевые -> Угловые
    const sortOrder: Record<StandardProfileCategory, number> = {
      LED_10: 1,
      H_JOINT_08: 2,
      END_CAP: 3,
      CORNER: 4,
      BASEBOARD: 5,
      OTHER: 6,
    };
    items.sort((a, b) => (sortOrder[a.category] || 99) - (sortOrder[b.category] || 99));

    return {
      wallId: wall.id,
      wallName: wall.name,
      wallWidth: wall.width,
      wallHeight: wall.height,
      items,
      totalLinearMeters: Math.round(totalWallMeters * 10) / 10,
      totalStockBars: totalWallBars,
    };
  }

  /**
   * Рассчитывает общую спецификацию профилей по всем стенам проекта
   */
  public static calculateProjectProfiles(
    walls: Wall[],
    materials: Material[]
  ): ProjectProfilesReport {
    const wallReports: WallProfilesReport[] = [];
    const aggregated = new Map<string, { identity: ProfileIdentity; lengths: number[]; count: number }>();

    walls.forEach((wall, idx) => {
      const defMat = materials.find((m) => m.id === wall.zone.materialId) || materials[0];
      const report = this.calculateWallProfiles(wall, defMat, materials, idx + 1);
      wallReports.push(report);

      report.items.forEach((item) => {
        const key = profileKey(item);
        const entry = aggregated.get(key) || { identity: item, lengths: [], count: 0 };
        entry.lengths.push(...item.segmentLengthsMm);
        entry.count += item.segmentsCount;
        aggregated.set(key, entry);
      });
    });

    const byCategorySummary: WallProfileItemSummary[] = [];
    let projectTotalMeters = 0;
    let projectTotalBars = 0;

    aggregated.forEach((data) => {
      const sumMm = data.lengths.reduce((acc, l) => acc + l, 0);
      const meters = Math.round((sumMm / 1000) * 100) / 100;
      const barsCount = countStockBars(data.lengths, data.identity.stockLengthMm);

      projectTotalMeters += meters;
      projectTotalBars += barsCount;

      byCategorySummary.push({
        ...data.identity,
        totalLengthMm: sumMm,
        totalLinearMeters: meters,
        stockBarsCount: barsCount,
        segmentsCount: data.count,
        segmentLengthsMm: [...data.lengths],
      });
    });

    const sortOrder: Record<StandardProfileCategory, number> = {
      LED_10: 1,
      H_JOINT_08: 2,
      END_CAP: 3,
      CORNER: 4,
      BASEBOARD: 5,
      OTHER: 6,
    };
    byCategorySummary.sort((a, b) => (sortOrder[a.category] || 99) - (sortOrder[b.category] || 99));

    return {
      totalLinearMeters: Math.round(projectTotalMeters * 10) / 10,
      totalStockBars: projectTotalBars,
      byCategorySummary,
      wallReports,
    };
  }
}

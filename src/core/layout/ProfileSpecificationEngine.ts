import { Wall } from '../models/Wall';
import { LayoutEngine, LayoutCalculationResult, CalculatedJointLine } from './LayoutEngine';
import { Material, DEFAULT_MATERIALS } from '../models/Material';
import { findProfileByArticle } from '../models/Profile';

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
    name: 'Соединительный профиль (0.8 мм)',
    article: 'MC-06 / DL-17',
    defaultWidth: 0.8,
    colorHex: '#3b82f6', // Синий
    stockLengthMm: 3000,
    description: 'Тонкий межпанельный стыковочный профиль для соединения плит',
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
  name: string;
  article: string;
  colorHex: string;
  totalLengthMm: number;
  totalLinearMeters: number;
  stockBarsCount: number; // 3-метровые хлысты с запасом 10%
  segmentsCount: number;
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

    if (joint.width <= 1.5) {
      return 'H_JOINT_08';
    }

    if (joint.width >= 9 && joint.width <= 12) {
      return 'LED_10';
    }

    return 'H_JOINT_08';
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
    const activeJoints = layout.joints.filter((j) => j.width > 0 || j.isLED);

    const map = new Map<StandardProfileCategory, { lengths: number[]; count: number }>();

    activeJoints.forEach((j) => {
      const cat = this.categorizeJoint(j);
      const entry = map.get(cat) || { lengths: [], count: 0 };
      entry.lengths.push(j.length);
      entry.count++;
      map.set(cat, entry);
    });

    // Учет профилей обрамления проемов (двери, окна, ниши)
    if (wall.openings && wall.openings.length > 0) {
      wall.openings.forEach((op) => {
        if (op.isCutout === false) return;
        const hasSlopes = op.slopes?.enabled !== false;
        const opCat: StandardProfileCategory = hasSlopes ? 'CORNER' : 'END_CAP';

        const perim = op.type === 'DOOR'
          ? (op.y <= 5 ? op.width + op.height * 2 : (op.width + op.height) * 2)
          : (op.width + op.height) * 2;

        if (perim > 0) {
          const entry = map.get(opCat) || { lengths: [], count: 0 };
          entry.lengths.push(perim);
          entry.count += (op.type === 'DOOR' && op.y <= 5 ? 3 : 4);
          map.set(opCat, entry);
        }
      });
    }

    const items: WallProfileItemSummary[] = [];
    let totalWallMeters = 0;
    let totalWallBars = 0;

    map.forEach((data, cat) => {
      const info = PROFILE_CATEGORIES_INFO[cat];
      const sumMm = data.lengths.reduce((acc, l) => acc + l, 0);
      const meters = Math.round((sumMm / 1000) * 100) / 100;
      
      // Расчет 3-метровых хлыстов без наценки
      const barsCount = Math.max(1, Math.ceil(meters / 3.0));

      totalWallMeters += meters;
      totalWallBars += barsCount;

      items.push({
        category: cat,
        name: info.name,
        article: info.article,
        colorHex: info.colorHex,
        totalLengthMm: sumMm,
        totalLinearMeters: meters,
        stockBarsCount: barsCount,
        segmentsCount: data.count,
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
    const aggregated = new Map<StandardProfileCategory, { lengths: number[]; count: number }>();

    walls.forEach((wall, idx) => {
      const defMat = materials.find((m) => m.id === wall.zone.materialId) || materials[0];
      const report = this.calculateWallProfiles(wall, defMat, materials, idx + 1);
      wallReports.push(report);

      report.items.forEach((item) => {
        const entry = aggregated.get(item.category) || { lengths: [], count: 0 };
        entry.lengths.push(item.totalLengthMm);
        entry.count += item.segmentsCount;
        aggregated.set(item.category, entry);
      });
    });

    const byCategorySummary: WallProfileItemSummary[] = [];
    let projectTotalMeters = 0;
    let projectTotalBars = 0;

    aggregated.forEach((data, cat) => {
      const info = PROFILE_CATEGORIES_INFO[cat];
      const sumMm = data.lengths.reduce((acc, l) => acc + l, 0);
      const meters = Math.round((sumMm / 1000) * 100) / 100;
      const barsCount = Math.max(1, Math.ceil(meters / 3.0));

      projectTotalMeters += meters;
      projectTotalBars += barsCount;

      byCategorySummary.push({
        category: cat,
        name: info.name,
        article: info.article,
        colorHex: info.colorHex,
        totalLengthMm: sumMm,
        totalLinearMeters: meters,
        stockBarsCount: barsCount,
        segmentsCount: data.count,
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

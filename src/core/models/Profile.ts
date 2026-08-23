export type ProfileType = 'JOINT_8' | 'H_JOINT' | 'LED_10' | 'END' | 'CORNER';

export interface Profile {
  id: string;
  name: string;
  type: ProfileType;
  width: number;        // видимая ширина шва/профиля на стене в мм (8.0 мм, 0.8 мм, 10 мм и т.д.)
  stockLength: number;  // стандартная длина хлыста (3000 мм)
  color: string;
}

export const DEFAULT_PROFILES: Record<ProfileType, Profile> = {
  JOINT_8: {
    id: 'prof-joint-8',
    name: 'Стандартный шов (8 мм)',
    type: 'JOINT_8',
    width: 8.0,
    stockLength: 3000,
    color: '#343a40',
  },
  H_JOINT: {
    id: 'prof-h-joint',
    name: 'Соединительный профиль (0.8 мм)',
    type: 'H_JOINT',
    width: 0.8,
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

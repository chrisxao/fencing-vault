// Label taxonomy for touch analysis.
//
// General categories are fixed (they drive the stats breakdowns); specific
// action labels are seeded per user and can be extended with custom labels.

export type Weapon = 'foil' | 'epee' | 'sabre';

export const WEAPONS: { id: Weapon; name: string; icon: string }[] = [
  { id: 'foil', name: 'Foil', icon: '🤺' },
  { id: 'epee', name: 'Épée', icon: '⚔️' },
  { id: 'sabre', name: 'Sabre', icon: '🗡️' },
];

export function weaponName(id: string): string {
  return WEAPONS.find((w) => w.id === id)?.name ?? id;
}

export type CategoryId =
  | 'short-attack'
  | 'long-attack'
  | 'short-defense'
  | 'long-defense'
  | 'middle';

export interface Category {
  id: CategoryId;
  name: string;
  short: string;
  color: string;
  /** 'middle' only applies to the conventional weapons (foil, sabre). */
  weapons: Weapon[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'short-attack',
    name: 'Short Attack',
    short: 'Short Atk',
    color: '#f59e0b',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'long-attack',
    name: 'Long Attack',
    short: 'Long Atk',
    color: '#ef4444',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'short-defense',
    name: 'Short Defense',
    short: 'Short Def',
    color: '#38bdf8',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'long-defense',
    name: 'Long Defense',
    short: 'Long Def',
    color: '#818cf8',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'middle',
    name: 'Middle',
    short: 'Middle',
    color: '#34d399',
    weapons: ['foil', 'sabre'],
  },
];

export function categoriesForWeapon(weapon: string): Category[] {
  return CATEGORIES.filter((c) => c.weapons.includes(weapon as Weapon));
}

export function categoryById(id: string | undefined): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** Default specific labels seeded for every new user. */
export const DEFAULT_LABELS: { name: string; category: CategoryId }[] = [
  { name: 'Attack on preparation', category: 'short-attack' },
  { name: 'Simple attack', category: 'short-attack' },
  { name: 'Flick attack', category: 'short-attack' },
  { name: 'Compound attack', category: 'long-attack' },
  { name: 'Reprise attack', category: 'long-attack' },
  { name: 'Remise', category: 'long-attack' },
  { name: 'March attack', category: 'long-attack' },
  { name: 'Parry riposte', category: 'short-defense' },
  { name: 'Counter attack', category: 'short-defense' },
  { name: 'Point in line', category: 'short-defense' },
  { name: 'Prise de fer', category: 'long-defense' },
  { name: 'Counter riposte', category: 'long-defense' },
  { name: 'Distance pull counter', category: 'long-defense' },
  { name: 'Attack en fer', category: 'middle' },
  { name: 'Beat attack', category: 'middle' },
  { name: 'Simultaneous action', category: 'middle' },
];

export type TouchResult =
  | 'scored'
  | 'received'
  | 'double'
  | 'simultaneous'
  | 'no-touch';

export const RESULTS: { id: TouchResult; name: string; color: string; weapons: Weapon[] }[] = [
  { id: 'scored', name: 'Scored', color: '#34d399', weapons: ['foil', 'epee', 'sabre'] },
  { id: 'received', name: 'Received', color: '#f87171', weapons: ['foil', 'epee', 'sabre'] },
  { id: 'double', name: 'Double', color: '#fbbf24', weapons: ['epee'] },
  { id: 'simultaneous', name: 'Simultaneous', color: '#a3a3a3', weapons: ['foil', 'sabre'] },
  { id: 'no-touch', name: 'No touch', color: '#737373', weapons: ['foil', 'epee', 'sabre'] },
];

export function resultsForWeapon(weapon: string) {
  return RESULTS.filter((r) => r.weapons.includes(weapon as Weapon));
}

export function resultById(id: string) {
  return RESULTS.find((r) => r.id === id);
}

export type Weapon = 'foil' | 'epee' | 'sabre';
export type TouchResult = 'scored' | 'received' | 'double' | 'simultaneous' | 'no-touch';

export const WEAPONS: { id: Weapon; name: string }[] = [
  { id: 'foil', name: 'Foil' },
  { id: 'epee', name: 'Épée' },
  { id: 'sabre', name: 'Sabre' },
];

export const CATEGORIES = [
  {
    id: 'short-attack',
    name: 'Short Attack',
    short: 'Short Atk',
    color: '#b9995f',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'long-attack',
    name: 'Long Attack',
    short: 'Long Atk',
    color: '#b97e72',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'short-defense',
    name: 'Short Defense',
    short: 'Short Def',
    color: '#7fa3bf',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'long-defense',
    name: 'Long Defense',
    short: 'Long Def',
    color: '#968fbf',
    weapons: ['foil', 'epee', 'sabre'],
  },
  {
    id: 'middle',
    name: 'Middle',
    short: 'Middle',
    color: '#83ab94',
    weapons: ['foil', 'sabre'],
  },
] as const;

export const DEFAULT_LABELS = [
  ['Simple attack', 'short-attack'],
  ['Flick attack', 'short-attack'],
  ['Compound attack', 'long-attack'],
  ['Remise', 'long-attack'],
  ['Parry riposte', 'short-defense'],
  ['Counter attack', 'short-defense'],
  ['Point in line', 'short-defense'],
  ['Prise de fer', 'long-defense'],
  ['Counter riposte', 'long-defense'],
  ['Distance pull counter', 'long-defense'],
  ['Attack on preparation', 'middle'],
  ['Reprise attack', 'middle'],
  ['Beat attack', 'middle'],
  ['Simultaneous action', 'middle'],
] as const;

export const RESULTS: {
  id: TouchResult;
  name: string;
  color: string;
  weapons: Weapon[];
}[] = [
  { id: 'scored', name: 'Scored', color: '#6d997c', weapons: ['foil', 'epee', 'sabre'] },
  { id: 'received', name: 'Received', color: '#b66f66', weapons: ['foil', 'epee', 'sabre'] },
  { id: 'double', name: 'Double', color: '#ad9257', weapons: ['epee'] },
  { id: 'simultaneous', name: 'Simultaneous', color: '#7d8089', weapons: ['foil', 'sabre'] },
  { id: 'no-touch', name: 'No touch', color: '#7d8089', weapons: ['foil', 'epee', 'sabre'] },
];

export const categoriesForWeapon = (weapon: string) =>
  CATEGORIES.filter((category) => category.weapons.some((value) => value === weapon));

export const resultsForWeapon = (weapon: string) =>
  RESULTS.filter((result) => result.weapons.some((value) => value === weapon));

export const weaponName = (weapon: string) =>
  WEAPONS.find((option) => option.id === weapon)?.name ?? weapon;

export const isScored = (result: string) => result === 'scored' || result === 'double';
export const isReceived = (result: string) => result === 'received' || result === 'double';

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
}

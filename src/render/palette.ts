/** docs/design/04-content.md 4.6 のカラーコード */
export const palette = {
  vocal: '#FF6BA8',
  dance: '#4FC3F7',
  visual: '#FFD54F',

  silence: '#7E57C2',
  noise: '#EF5350',
  glare: '#26A69A',

  moonLow: '#E8F1FF',
  moonHigh: '#FFD54F',

  bgTop: '#0B0A1C',
  bgBottom: '#1B1436',
  grid: 'rgba(255, 255, 255, 0.05)',
  gridStrong: 'rgba(255, 255, 255, 0.10)',
  lane: 'rgba(126, 87, 194, 0.35)',
  laneEdge: 'rgba(190, 160, 255, 0.55)',
  placeable: 'rgba(79, 195, 247, 0.16)',
  placeableEdge: 'rgba(79, 195, 247, 0.55)',
  runway: 'rgba(255, 213, 79, 0.18)',
  runwayEdge: 'rgba(255, 213, 79, 0.6)',
  audienceCell: 'rgba(255, 107, 168, 0.16)',
  audienceCellEdge: 'rgba(255, 107, 168, 0.55)',
  goal: '#FFD54F',
  text: '#EAE6FF',
  textDim: 'rgba(234, 230, 255, 0.55)',
  invalid: '#FF6B6B',
  unitBody: '#141230',
} as const;

export function typeColor(type: string): string {
  switch (type) {
    case 'vocal':
      return palette.vocal;
    case 'dance':
      return palette.dance;
    default:
      return palette.visual;
  }
}

export function attrColor(attr: string): string {
  switch (attr) {
    case 'silence':
      return palette.silence;
    case 'noise':
      return palette.noise;
    default:
      return palette.glare;
  }
}

export type CellStyle = { fill: string; stroke: string };

export function cellStyle(type: string | undefined): CellStyle {
  switch (type) {
    case 'runway':
    case 'monitor':
      return { fill: palette.runway, stroke: palette.runwayEdge };
    case 'audience':
      return { fill: palette.audienceCell, stroke: palette.audienceCellEdge };
    default:
      return { fill: palette.placeable, stroke: palette.placeableEdge };
  }
}

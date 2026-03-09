// ─── Seeded RNG (mulberry32) ────────────────────────────────────────────────

export function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Tile types ─────────────────────────────────────────────────────────────

export const TileType = {
  DEEP_WATER: 0,
  SHALLOW_WATER: 1,
  SAND: 2,
  SOIL: 3,
  GRASS: 4,
  BUSH: 5,
  TREE: 6,
  FOREST_FLOOR: 7,
  SEED: 8,
  SPROUT: 9,
  ROCK: 10,
  CLIFF: 11,
  CORAL: 12,
  FERTILE_SOIL: 13,
  DENSE_FOREST: 14,
  SWAMP: 15,
} as const;

export type TileTypeValue = (typeof TileType)[keyof typeof TileType];

export const TILE_COLORS: Record<number, string> = {
  [TileType.DEEP_WATER]: "#0d2440",
  [TileType.SHALLOW_WATER]: "#1a6088",
  [TileType.SAND]: "#d4b060",
  [TileType.SOIL]: "#6a3e12",
  [TileType.GRASS]: "#3a8820",
  [TileType.BUSH]: "#256e18",
  [TileType.TREE]: "#174d0c",
  [TileType.FOREST_FLOOR]: "#1e6310",
  [TileType.SEED]: "#c09030",
  [TileType.SPROUT]: "#58c032",
  [TileType.ROCK]: "#606060",
  [TileType.CLIFF]: "#7a7060",
  [TileType.CORAL]: "#e05030",
  [TileType.FERTILE_SOIL]: "#3d2208",
  [TileType.DENSE_FOREST]: "#0e3208",
  [TileType.SWAMP]: "#3a4820",
};

// ─── Simple 2D value noise ───────────────────────────────────────────────────

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildPermTable(rng: () => number, size: number): Float32Array {
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) {
    table[i] = rng() * 2 - 1;
  }
  return table;
}

function sampleNoise(
  table: Float32Array,
  tableSize: number,
  x: number,
  y: number,
): number {
  const xi = Math.floor(x) & (tableSize - 1);
  const yi = Math.floor(y) & (tableSize - 1);
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  const a = table[yi * tableSize + xi];
  const b = table[yi * tableSize + ((xi + 1) & (tableSize - 1))];
  const c = table[((yi + 1) & (tableSize - 1)) * tableSize + xi];
  const d =
    table[
      ((yi + 1) & (tableSize - 1)) * tableSize + ((xi + 1) & (tableSize - 1))
    ];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(
  table: Float32Array,
  tableSize: number,
  x: number,
  y: number,
  octaves: number,
): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value +=
      sampleNoise(table, tableSize, x * frequency, y * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

// ─── Island Generation ───────────────────────────────────────────────────────

export interface IslandTile {
  type: TileTypeValue;
  growthTimer: number; // ticks until next growth stage
  spreadChance: number; // extra spread probability
}

export const GRID_W = 160;
export const GRID_H = 120;

export function generateIsland(seed: number): IslandTile[] {
  const rng = mulberry32(seed);
  const tableSize = 32;
  const noiseTable = buildPermTable(rng, tableSize);
  // Second noise table for biome variation
  const noiseTable2 = buildPermTable(rng, tableSize);
  // Third noise table for detail
  const noiseTable3 = buildPermTable(rng, tableSize);

  const tiles: IslandTile[] = new Array(GRID_W * GRID_H);

  const cx = GRID_W / 2;
  const cy = GRID_H / 2;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const nx = (x / GRID_W) * tableSize;
      const ny = (y / GRID_H) * tableSize;

      // Multi-octave FBM for organic island shape (6 octaves)
      const noise = fbm(noiseTable, tableSize, nx * 0.4, ny * 0.4, 6);
      // Secondary noise for biome variation
      const biomeNoise = fbm(noiseTable2, tableSize, nx * 0.6, ny * 0.6, 4);
      // Detail noise
      const detailNoise = fbm(noiseTable3, tableSize, nx * 1.2, ny * 1.2, 3);

      const dx = (x - cx) / (cx * 0.85);
      const dy = (y - cy) / (cy * 0.85);
      const distFactor = Math.sqrt(dx * dx + dy * dy);

      // Island shape: combination of distance falloff and noise
      const islandValue = 1 - distFactor * 1.1 + noise * 0.55;

      // Altitude for central peaks
      const altitude = islandValue + detailNoise * 0.15;

      let tileType: TileTypeValue;

      if (islandValue < 0.04) {
        tileType = TileType.DEEP_WATER;
      } else if (islandValue < 0.18) {
        // Shallow water with occasional coral
        if (biomeNoise > 0.3 && rng() < 0.15) {
          tileType = TileType.CORAL;
        } else {
          tileType = TileType.SHALLOW_WATER;
        }
      } else if (islandValue < 0.28) {
        // Coast transition - cliffs or sand
        if (detailNoise > 0.2 && islandValue < 0.24) {
          tileType = TileType.CLIFF;
        } else {
          tileType = TileType.SAND;
        }
      } else if (islandValue < 0.38) {
        tileType = TileType.SAND;
      } else if (islandValue < 0.48) {
        // Soil with some fertile soil near forest margins
        if (biomeNoise > 0.2) {
          tileType = TileType.FERTILE_SOIL;
        } else {
          tileType = TileType.SOIL;
        }
      } else if (islandValue < 0.62) {
        // Grass zones, swamp in wet depressions
        if (biomeNoise < -0.35 && detailNoise < -0.2) {
          tileType = TileType.SWAMP;
        } else {
          tileType = TileType.GRASS;
        }
      } else if (islandValue < 0.75) {
        // High interior - rocks and fertile soil
        if (altitude > 0.85) {
          tileType = TileType.ROCK;
        } else if (biomeNoise > 0.25) {
          tileType = TileType.FERTILE_SOIL;
        } else {
          tileType = TileType.SOIL;
        }
      } else {
        // Central peaks - rocky
        tileType = TileType.ROCK;
      }

      tiles[y * GRID_W + x] = {
        type: tileType,
        growthTimer: 0,
        spreadChance: 0,
      };
    }
  }

  // Place initial seeds on soil/grass/fertile_soil tiles (more seeds for larger map)
  const seedCount = Math.floor(rng() * 16) + 20; // 20-35 seeds
  let placed = 0;
  let attempts = 0;
  while (placed < seedCount && attempts < 2000) {
    attempts++;
    const x = Math.floor(rng() * GRID_W);
    const y = Math.floor(rng() * GRID_H);
    const idx = y * GRID_W + x;
    if (
      tiles[idx].type === TileType.SOIL ||
      tiles[idx].type === TileType.GRASS ||
      tiles[idx].type === TileType.FERTILE_SOIL
    ) {
      tiles[idx].type = TileType.SEED;
      tiles[idx].growthTimer = Math.floor(rng() * 30) + 30;
      placed++;
    }
  }

  return tiles;
}

// ─── Tile helpers ────────────────────────────────────────────────────────────

export function isWater(type: TileTypeValue): boolean {
  return (
    type === TileType.DEEP_WATER ||
    type === TileType.SHALLOW_WATER ||
    type === TileType.CORAL
  );
}

export function isLand(type: TileTypeValue): boolean {
  return !isWater(type);
}

export function isVegetation(type: TileTypeValue): boolean {
  return (
    type === TileType.GRASS ||
    type === TileType.BUSH ||
    type === TileType.TREE ||
    type === TileType.FOREST_FLOOR ||
    type === TileType.DENSE_FOREST ||
    type === TileType.SPROUT ||
    type === TileType.SWAMP
  );
}

export function isSpreadable(type: TileTypeValue): boolean {
  return (
    type === TileType.SOIL ||
    type === TileType.SAND ||
    type === TileType.FERTILE_SOIL
  );
}

const NEIGHBORS_4 = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const NEIGHBORS_8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function getNeighbors4(x: number, y: number): Array<[number, number]> {
  return NEIGHBORS_4.map(
    ([dx, dy]) => [x + dx, y + dy] as [number, number],
  ).filter(([nx, ny]) => nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H);
}

export function getNeighbors8(x: number, y: number): Array<[number, number]> {
  return NEIGHBORS_8.map(
    ([dx, dy]) => [x + dx, y + dy] as [number, number],
  ).filter(([nx, ny]) => nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H);
}

export function tileIdx(x: number, y: number): number {
  return y * GRID_W + x;
}

export function tileXY(idx: number): [number, number] {
  return [idx % GRID_W, Math.floor(idx / GRID_W)];
}

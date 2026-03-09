import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SimulationRecord } from "../backend";
import { useActor } from "../hooks/useActor";
import {
  GRID_H,
  GRID_W,
  type IslandTile,
  TILE_COLORS,
  TileType,
  type TileTypeValue,
  generateIsland,
  getNeighbors4,
  getNeighbors8,
  isLand,
  isVegetation,
  isWater,
  mulberry32,
  tileIdx,
} from "../utils/islandGen";

// ─── Constants ───────────────────────────────────────────────────────────────

const TILE_SIZE = 16;
const WORLD_W = GRID_W * TILE_SIZE; // 2560
const WORLD_H = GRID_H * TILE_SIZE; // 1920
const VIEWPORT_W = 800;
const VIEWPORT_H = 600;

const TICKS_PER_DAY = 60;
const SPEED_TICKS: Record<string, number> = {
  slow: 1,
  normal: 4,
  fast: 15,
};

// ─── Animal Types ────────────────────────────────────────────────────────────

type AnimalKind = "insect" | "bird" | "mammal" | "predator";

interface Animal {
  id: number;
  kind: AnimalKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveTimer: number;
  lifespan: number;
  age: number;
  reproTimer: number;
}

const ANIMAL_CAPS: Record<AnimalKind, number> = {
  insect: 300,
  bird: 150,
  mammal: 120,
  predator: 30,
};

// ─── Simulation State (all refs) ─────────────────────────────────────────────

export interface SimState {
  tiles: IslandTile[];
  animals: Animal[];
  day: number;
  tickInDay: number;
  weather: "sunny" | "rainy";
  weatherTimer: number;
  seed: number;
  rng: () => number;
  animalIdCounter: number;
  peakPlants: number;
  peakInsects: number;
  peakBirds: number;
  peakMammals: number;
  peakPredators: number;
  totalLandTiles: number;
}

function countVegetation(tiles: IslandTile[]) {
  let grass = 0;
  let bush = 0;
  let tree = 0;
  for (const t of tiles) {
    if (t.type === TileType.GRASS || t.type === TileType.SPROUT) grass++;
    else if (t.type === TileType.BUSH) bush++;
    else if (
      t.type === TileType.TREE ||
      t.type === TileType.FOREST_FLOOR ||
      t.type === TileType.DENSE_FOREST
    )
      tree++;
  }
  return { grass, bush, tree };
}

function countAnimals(animals: Animal[]) {
  let insects = 0;
  let birds = 0;
  let mammals = 0;
  let predators = 0;
  for (const a of animals) {
    if (a.kind === "insect") insects++;
    else if (a.kind === "bird") birds++;
    else if (a.kind === "mammal") mammals++;
    else if (a.kind === "predator") predators++;
  }
  return { insects, birds, mammals, predators };
}

function initSimState(seed: number): SimState {
  const tiles = generateIsland(seed);
  const rng = mulberry32(seed ^ 0xdeadbeef);
  let totalLandTiles = 0;
  for (const t of tiles) {
    if (isLand(t.type)) totalLandTiles++;
  }
  return {
    tiles,
    animals: [],
    day: 1,
    tickInDay: 0,
    weather: "sunny",
    weatherTimer: Math.floor(rng() * 40) + 20,
    seed,
    rng,
    animalIdCounter: 0,
    peakPlants: 0,
    peakInsects: 0,
    peakBirds: 0,
    peakMammals: 0,
    peakPredators: 0,
    totalLandTiles,
  };
}

// ─── Tick Logic ──────────────────────────────────────────────────────────────

function simulationTick(state: SimState): void {
  const { tiles, rng } = state;

  state.tickInDay++;
  if (state.tickInDay >= TICKS_PER_DAY) {
    state.tickInDay = 0;
    state.day++;
  }

  state.weatherTimer--;
  if (state.weatherTimer <= 0) {
    state.weather = state.weather === "sunny" ? "rainy" : "sunny";
    state.weatherTimer = Math.floor(rng() * 61) + 20;
  }

  const spreadQueue: Array<{ x: number; y: number; type: TileTypeValue }> = [];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const x = i % GRID_W;
    const y = Math.floor(i / GRID_W);

    if (tile.growthTimer > 0) {
      tile.growthTimer--;
    }

    if (tile.growthTimer === 0) {
      if (tile.type === TileType.SEED) {
        tile.type = TileType.SPROUT;
        tile.growthTimer = Math.floor(rng() * 21) + 20;
      } else if (tile.type === TileType.SPROUT) {
        tile.type = TileType.GRASS;
        tile.growthTimer = Math.floor(rng() * 41) + 40;
      } else if (tile.type === TileType.GRASS) {
        tile.type = TileType.BUSH;
        tile.growthTimer = Math.floor(rng() * 61) + 60;
      } else if (tile.type === TileType.BUSH) {
        tile.type = TileType.TREE;
        tile.growthTimer = Math.floor(rng() * 80) + 80;
      } else if (tile.type === TileType.TREE) {
        // Dense forest from tree clusters
        const neighbors = getNeighbors8(x, y);
        const treeNeighbors = neighbors.filter(
          ([nx, ny]) =>
            tiles[tileIdx(nx, ny)].type === TileType.TREE ||
            tiles[tileIdx(nx, ny)].type === TileType.FOREST_FLOOR,
        );
        if (treeNeighbors.length >= 4) {
          tile.type = TileType.DENSE_FOREST;
        } else {
          tile.type = TileType.FOREST_FLOOR;
        }
        tile.growthTimer = 0;
      }
    }

    // Plant death (tiny chance)
    if (isVegetation(tile.type) && rng() < 0.0002) {
      if (
        tile.type === TileType.DENSE_FOREST ||
        tile.type === TileType.FOREST_FLOOR
      ) {
        tile.type = TileType.TREE;
        tile.growthTimer = Math.floor(rng() * 80) + 80;
      } else if (tile.type === TileType.TREE) {
        tile.type = TileType.BUSH;
        tile.growthTimer = Math.floor(rng() * 61) + 60;
      } else if (tile.type === TileType.BUSH) {
        tile.type = TileType.GRASS;
        tile.growthTimer = Math.floor(rng() * 41) + 40;
      } else if (
        tile.type === TileType.GRASS ||
        tile.type === TileType.SPROUT
      ) {
        tile.type = TileType.SOIL;
        tile.growthTimer = 0;
      }
    }

    // Spreading
    if (
      tile.type === TileType.GRASS ||
      tile.type === TileType.BUSH ||
      tile.type === TileType.TREE ||
      tile.type === TileType.FOREST_FLOOR ||
      tile.type === TileType.DENSE_FOREST
    ) {
      const spreadProb =
        tile.type === TileType.GRASS
          ? 0.004
          : tile.type === TileType.BUSH
            ? 0.003
            : 0.002;

      if (rng() < spreadProb) {
        const neighbors = getNeighbors8(x, y);
        const candidates = neighbors.filter(([nx, ny]) => {
          const ntype = tiles[tileIdx(nx, ny)].type;
          return (
            ntype === TileType.SOIL ||
            ntype === TileType.SAND ||
            ntype === TileType.FERTILE_SOIL
          );
        });
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(rng() * candidates.length)];
          spreadQueue.push({ x: pick[0], y: pick[1], type: TileType.SEED });
        }
      }
    }
  }

  for (const { x, y, type } of spreadQueue) {
    const idx = tileIdx(x, y);
    if (
      tiles[idx].type === TileType.SOIL ||
      tiles[idx].type === TileType.SAND ||
      tiles[idx].type === TileType.FERTILE_SOIL
    ) {
      tiles[idx].type = type;
      tiles[idx].growthTimer = Math.floor(rng() * 31) + 30;
    }
  }

  const { grass, bush, tree } = countVegetation(tiles);
  const vegCount = grass + bush + tree;
  const grassPct = (grass + bush) / Math.max(1, state.totalLandTiles);
  const treePct = tree / Math.max(1, state.totalLandTiles);

  if (vegCount > state.peakPlants) state.peakPlants = vegCount;

  const counts = countAnimals(state.animals);
  if (counts.insects > state.peakInsects) state.peakInsects = counts.insects;
  if (counts.birds > state.peakBirds) state.peakBirds = counts.birds;
  if (counts.mammals > state.peakMammals) state.peakMammals = counts.mammals;
  if (counts.predators > state.peakPredators)
    state.peakPredators = counts.predators;

  if (grassPct > 0.05 && counts.insects < ANIMAL_CAPS.insect && rng() < 0.04) {
    spawnAnimal(state, "insect", tiles, rng);
  }
  if (grassPct > 0.1 && counts.birds < ANIMAL_CAPS.bird && rng() < 0.02) {
    spawnAnimal(state, "bird", tiles, rng);
  }
  if (treePct > 0.05 && counts.mammals < ANIMAL_CAPS.mammal && rng() < 0.015) {
    spawnAnimal(state, "mammal", tiles, rng);
  }
  if (
    counts.mammals > 20 &&
    tree > 100 &&
    counts.predators < ANIMAL_CAPS.predator &&
    rng() < 0.005
  ) {
    spawnAnimal(state, "predator", tiles, rng);
  }

  const toRemove: number[] = [];

  for (let i = 0; i < state.animals.length; i++) {
    const animal = state.animals[i];
    animal.age++;

    if (animal.age >= animal.lifespan) {
      toRemove.push(i);
      continue;
    }

    if (animal.kind === "predator") {
      const nearby = state.animals.find(
        (a) =>
          a !== animal &&
          a.kind === "mammal" &&
          Math.abs(a.x - animal.x) <= 2 &&
          Math.abs(a.y - animal.y) <= 2,
      );
      if (nearby) {
        animal.lifespan = Math.min(animal.lifespan + 20, 400);
        const preyIdx = state.animals.indexOf(nearby);
        if (preyIdx !== -1) toRemove.push(preyIdx);
      }
    }

    animal.moveTimer--;
    if (animal.moveTimer <= 0) {
      animal.moveTimer =
        animal.kind === "insect" ? 1 : animal.kind === "bird" ? 2 : 3;

      const neighbors = getNeighbors4(animal.x, animal.y);
      const validNeighbors = neighbors.filter(([nx, ny]) => {
        const t = tiles[tileIdx(nx, ny)].type;
        return animal.kind === "bird" ? isLand(t) : isLand(t) && !isWater(t);
      });

      if (validNeighbors.length > 0) {
        const forward = validNeighbors.find(
          ([nx, ny]) =>
            nx === animal.x + animal.dx && ny === animal.y + animal.dy,
        );
        if (forward && rng() < 0.7) {
          animal.x = forward[0];
          animal.y = forward[1];
        } else {
          const pick =
            validNeighbors[Math.floor(rng() * validNeighbors.length)];
          animal.x = pick[0];
          animal.y = pick[1];
          animal.dx = pick[0] - animal.x || animal.dx;
          animal.dy = pick[1] - animal.y || animal.dy;
        }
      }
    }

    animal.reproTimer--;
    if (animal.reproTimer <= 0) {
      animal.reproTimer = Math.floor(rng() * 60) + 40;
      const cap = ANIMAL_CAPS[animal.kind];
      const sameSpecies = state.animals.filter((a) => a.kind === animal.kind);
      if (sameSpecies.length < cap) {
        const mate = sameSpecies.find(
          (a) =>
            a !== animal &&
            Math.abs(a.x - animal.x) <= 1 &&
            Math.abs(a.y - animal.y) <= 1,
        );
        if (mate && rng() < 0.3) {
          const newAnimal = createAnimal(
            state,
            animal.kind,
            animal.x,
            animal.y,
            rng,
          );
          if (newAnimal) state.animals.push(newAnimal);
        }
      }
    }
  }

  const uniqueToRemove = [...new Set(toRemove)].sort((a, b) => b - a);
  for (const idx of uniqueToRemove) {
    state.animals.splice(idx, 1);
  }
}

function spawnAnimal(
  state: SimState,
  kind: AnimalKind,
  tiles: IslandTile[],
  rng: () => number,
): void {
  const newAnimal = createAnimal(state, kind, -1, -1, rng);
  if (!newAnimal) return;

  let attempts = 0;
  while (attempts < 50) {
    const x = Math.floor(rng() * GRID_W);
    const y = Math.floor(rng() * GRID_H);
    const t = tiles[tileIdx(x, y)].type;
    if (isLand(t) && !isWater(t)) {
      newAnimal.x = x;
      newAnimal.y = y;
      state.animals.push(newAnimal);
      return;
    }
    attempts++;
  }
}

function createAnimal(
  state: SimState,
  kind: AnimalKind,
  x: number,
  y: number,
  rng: () => number,
): Animal | null {
  return {
    id: state.animalIdCounter++,
    kind,
    x,
    y,
    dx: Math.floor(rng() * 3) - 1,
    dy: Math.floor(rng() * 3) - 1,
    moveTimer: 1,
    lifespan: Math.floor(rng() * 201) + 100,
    age: 0,
    reproTimer: Math.floor(rng() * 60) + 40,
  };
}

// ─── Canvas Renderer (RPG Pixel Art) ─────────────────────────────────────────

function drawDeepWater(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
  ts: number,
): void {
  // Deep ocean base
  ctx.fillStyle = "#0d2440";
  ctx.fillRect(x, y, 16, 16);

  // Depth gradient - top darker
  ctx.fillStyle = "#0a1e38";
  ctx.fillRect(x, y, 16, 3);

  // Wave band 1
  const wy1 = Math.round(y + 4 + Math.sin(ts * 0.0005 + i * 0.12) * 2.5);
  ctx.fillStyle = "#0f2e52";
  ctx.fillRect(x, wy1, 16, 2);

  // Wave band 2
  const wy2 = Math.round(y + 9 + Math.sin(ts * 0.0004 + i * 0.09 + 1.2) * 2);
  ctx.fillStyle = "#122e58";
  ctx.fillRect(x, wy2, 16, 2);

  // Wave band 3
  const wy3 = Math.round(y + 13 + Math.sin(ts * 0.0006 + i * 0.15 + 2.4) * 1.5);
  ctx.fillStyle = "#163564";
  ctx.fillRect(x, wy3, 16, 1);

  // Foam on wave crests
  const wv1 = Math.sin(ts * 0.0005 + i * 0.12);
  if (wv1 > 0.55) {
    ctx.fillStyle = "#3a80b8";
    ctx.fillRect(x + (i % 9) + 2, wy1 - 1, 3, 1);
    ctx.fillStyle = "rgba(180,220,255,0.4)";
    ctx.fillRect(x + ((i * 3) % 11) + 1, wy1 - 1, 2, 1);
  }
  if (wv1 > 0.75) {
    ctx.fillStyle = "rgba(200,235,255,0.3)";
    ctx.fillRect(x + ((i * 7) % 13), wy1, 1, 1);
  }
}

function drawShallowWater(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
  ts: number,
): void {
  ctx.fillStyle = "#1a6088";
  ctx.fillRect(x, y, 16, 16);

  // Sand visible through water
  const sandPixels = [(i * 7 + 3) % 14, (i * 11 + 5) % 14, (i * 13 + 1) % 14];
  ctx.fillStyle = "rgba(200,168,74,0.35)";
  for (const sp of sandPixels) {
    ctx.fillRect(x + sp, y + ((i * 5 + sp) % 14), 2, 1);
  }

  // Wave
  const wy = Math.round(y + 5 + Math.sin(ts * 0.0006 + i * 0.16) * 2.5);
  ctx.fillStyle = "#2278a8";
  ctx.fillRect(x, wy, 16, 2);
  ctx.fillStyle = "#1e6ea0";
  ctx.fillRect(x, wy + 4, 16, 1);

  const wv = Math.sin(ts * 0.0006 + i * 0.16);
  // Foam
  if (wv > 0.45) {
    ctx.fillStyle = "#7ac8e8";
    ctx.fillRect(x + (i % 10) + 1, wy - 1, 4, 1);
    ctx.fillStyle = "rgba(240,252,255,0.5)";
    ctx.fillRect(x + ((i * 5) % 12) + 1, wy - 1, 2, 1);
  }
  // Light reflection - sinusoidal
  const refX = Math.round(x + 7 + Math.sin(ts * 0.0008 + i * 0.2) * 5);
  if (refX >= x && refX < x + 15) {
    ctx.fillStyle = "rgba(180,240,255,0.4)";
    ctx.fillRect(refX, y + 3, 1, 1);
    ctx.fillRect(refX + 2, y + 8, 1, 1);
  }
}

function drawSand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  ctx.fillStyle = "#d4b060";
  ctx.fillRect(x, y, 16, 16);

  // Texture variation - 3 tones scattered
  const t1x = (i * 11) % 14;
  const t1y = (i * 7) % 14;
  ctx.fillStyle = "#dcc070";
  ctx.fillRect(x + t1x, y + t1y, 3, 2);
  ctx.fillRect(x + ((t1x + 7) % 14), y + ((t1y + 5) % 14), 2, 2);

  ctx.fillStyle = "#c8a040";
  ctx.fillRect(x + ((i * 5) % 12), y + ((i * 9) % 12), 2, 1);
  ctx.fillRect(x + ((i * 3 + 6) % 13), y + ((i * 7 + 3) % 13), 1, 2);

  // Grain shadows
  ctx.fillStyle = "#b08030";
  ctx.fillRect(x + ((i * 13) % 13), y + ((i * 11) % 13), 1, 1);
  ctx.fillRect(x + ((i * 9 + 4) % 12), y + ((i * 5 + 2) % 12), 1, 1);

  // Highlights
  ctx.fillStyle = "#e0c878";
  ctx.fillRect(x + ((i * 17 + 2) % 14), y + ((i * 13 + 4) % 14), 1, 1);

  // Pebbles (deterministic)
  if ((i * 37) % 8 === 0) {
    ctx.fillStyle = "#a07030";
    ctx.fillRect(x + ((i * 7) % 12) + 2, y + ((i * 11) % 12) + 2, 2, 2);
    ctx.fillStyle = "#b89040";
    ctx.fillRect(x + ((i * 7) % 12) + 2, y + ((i * 11) % 12) + 2, 1, 1);
  }

  // Shells
  if ((i * 31) % 14 === 0) {
    ctx.fillStyle = "#f0e8d0";
    ctx.fillRect(x + ((i * 13) % 10) + 3, y + ((i * 7) % 10) + 3, 2, 1);
    ctx.fillStyle = "#e0d8c0";
    ctx.fillRect(x + ((i * 13) % 10) + 3, y + ((i * 7) % 10) + 4, 2, 1);
  }
}

function drawSoil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  ctx.fillStyle = "#6a3e12";
  ctx.fillRect(x, y, 16, 16);

  // Irregular horizontal texture bands
  ctx.fillStyle = "#5c3410";
  ctx.fillRect(x, y + (i % 4) + 1, 16, 1);
  ctx.fillRect(x, y + (i % 4) + 6, 16, 2);

  ctx.fillStyle = "#724418";
  ctx.fillRect(x, y + (i % 3) + 4, 16, 1);
  ctx.fillRect(x, y + (i % 3) + 11, 16, 1);

  ctx.fillStyle = "#7a4c1e";
  ctx.fillRect(x, y + 8, 16, 1);
  ctx.fillRect(x, y + 13, 16, 2);

  ctx.fillStyle = "#8a5820";
  ctx.fillRect(x, y + (i % 5) + 2, 4, 1);
  ctx.fillRect(x + 8, y + (i % 4) + 9, 6, 1);

  // Cracks
  ctx.fillStyle = "#4a2808";
  if ((i * 13) % 5 === 0) {
    ctx.fillRect(x + ((i * 7) % 12) + 2, y + 3, 1, 4);
  }
  if ((i * 17) % 7 === 0) {
    ctx.fillRect(x + ((i * 11) % 10) + 3, y + 9, 4, 1);
  }
}

function drawFertileSoil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  ctx.fillStyle = "#3d2208";
  ctx.fillRect(x, y, 16, 16);

  // Rich dark variations
  ctx.fillStyle = "#2e1806";
  ctx.fillRect(x, y + (i % 3) + 2, 16, 2);
  ctx.fillRect(x, y + (i % 3) + 10, 16, 1);

  ctx.fillStyle = "#4e2c0c";
  ctx.fillRect(x, y + (i % 4) + 5, 16, 2);
  ctx.fillRect(x + 4, y + 13, 8, 2);

  // Moist spots
  ctx.fillStyle = "#261406";
  for (let m = 0; m < 4; m++) {
    ctx.fillRect(
      x + ((i * (m + 3) + m * 7) % 13) + 1,
      y + ((i * (m + 5) + m * 5) % 13) + 1,
      1,
      1,
    );
  }

  // Worm pixels
  if ((i * 41) % 12 === 0) {
    ctx.fillStyle = "#d08080";
    ctx.fillRect(x + ((i * 7) % 10) + 3, y + ((i * 11) % 10) + 3, 3, 1);
    ctx.fillRect(x + ((i * 7) % 10) + 4, y + ((i * 11) % 10) + 4, 2, 1);
  }
  if ((i * 53) % 11 === 0) {
    ctx.fillStyle = "#c07070";
    ctx.fillRect(x + ((i * 9) % 9) + 2, y + ((i * 13) % 9) + 6, 4, 1);
  }
}

function drawGrass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  ctx.fillStyle = "#3a8820";
  ctx.fillRect(x, y, 16, 16);

  // Shadow at base
  ctx.fillStyle = "#286010";
  ctx.fillRect(x, y + 15, 16, 1);

  // Blade layer 1 - dark
  ctx.fillStyle = "#2e7018";
  for (let bx = 0; bx < 16; bx += 4) {
    const h = 4 + ((i * 7 + bx) % 5);
    ctx.fillRect(x + bx + 1, y + 16 - h - 1, 1, h);
  }

  // Blade layer 2 - medium
  ctx.fillStyle = "#4a9c2c";
  for (let bx = 1; bx < 16; bx += 3) {
    const h = 5 + ((i * 11 + bx) % 4);
    ctx.fillRect(x + bx, y + 16 - h - 1, 1, h);
  }

  // Blade layer 3 - bright tips
  ctx.fillStyle = "#5ab034";
  for (let bx = 2; bx < 15; bx += 5) {
    const h = 6 + ((i * 13 + bx) % 3);
    ctx.fillRect(x + bx, y + 16 - h - 1, 1, 2);
  }

  // Highlight at top
  ctx.fillStyle = "#60c040";
  ctx.fillRect(x, y, 16, 1);

  // Flowers (occasional)
  const flowerCheck = (i * 31) % 40;
  if (flowerCheck < 2) {
    const fx = ((i * 17) % 10) + 3;
    const fy = ((i * 7) % 6) + 4;
    ctx.fillStyle = "#f0e040";
    ctx.fillRect(x + fx, y + fy, 1, 1);
    ctx.fillRect(x + fx + 1, y + fy - 1, 1, 1);
    ctx.fillRect(x + fx + 2, y + fy, 1, 1);
    ctx.fillRect(x + fx + 1, y + fy + 1, 1, 1);
    ctx.fillStyle = "#f8a020";
    ctx.fillRect(x + fx + 1, y + fy, 1, 1);
  } else if (flowerCheck < 4) {
    const fx = ((i * 13) % 10) + 3;
    const fy = ((i * 9) % 6) + 4;
    ctx.fillStyle = "#f06080";
    ctx.fillRect(x + fx, y + fy, 2, 1);
    ctx.fillRect(x + fx, y + fy - 1, 1, 1);
    ctx.fillRect(x + fx + 1, y + fy + 1, 1, 1);
    ctx.fillStyle = "#ffb0c0";
    ctx.fillRect(x + fx, y + fy, 1, 1);
  }
}

function drawBush(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  // Soil base
  ctx.fillStyle = "#6a3e12";
  ctx.fillRect(x, y, 16, 16);

  // Root hints
  ctx.fillStyle = "#3a2008";
  ctx.fillRect(x + 5, y + 14, 2, 2);
  ctx.fillRect(x + 9, y + 14, 2, 2);

  // Bush blob - 5 layers of green
  // Outer dark base
  ctx.fillStyle = "#1a5010";
  ctx.fillRect(x + 2, y + 9, 12, 5);
  ctx.fillRect(x + 4, y + 7, 8, 3);

  // Mid dark
  ctx.fillStyle = "#1e6010";
  ctx.fillRect(x + 1, y + 7, 14, 6);
  ctx.fillRect(x + 3, y + 4, 10, 4);

  // Mid bright
  ctx.fillStyle = "#2a7c18";
  ctx.fillRect(x + 2, y + 5, 12, 7);
  ctx.fillRect(x + 5, y + 3, 6, 3);

  // Top bright
  ctx.fillStyle = "#38b028";
  ctx.fillRect(x + 4, y + 4, 8, 5);
  ctx.fillRect(x + 6, y + 2, 4, 3);

  // Highlight top-left
  ctx.fillStyle = "#50d038";
  ctx.fillRect(x + 5, y + 3, 2, 2);
  ctx.fillRect(x + 4, y + 5, 1, 2);

  // Shadow bottom-right
  ctx.fillStyle = "#0a2008";
  ctx.fillRect(x + 11, y + 11, 3, 2);
  ctx.fillRect(x + 12, y + 9, 2, 3);

  // Berries (occasional)
  if ((i * 43) % 7 === 0) {
    ctx.fillStyle = "#d03020";
    ctx.fillRect(x + ((i * 7) % 8) + 3, y + ((i * 5) % 5) + 5, 2, 2);
    ctx.fillStyle = "#ff5040";
    ctx.fillRect(x + ((i * 7) % 8) + 3, y + ((i * 5) % 5) + 5, 1, 1);
  } else if ((i * 37) % 9 === 0) {
    ctx.fillStyle = "#2040c0";
    ctx.fillRect(x + ((i * 9) % 8) + 4, y + ((i * 7) % 5) + 4, 2, 2);
    ctx.fillStyle = "#5080ff";
    ctx.fillRect(x + ((i * 9) % 8) + 4, y + ((i * 7) % 5) + 4, 1, 1);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Grass ground
  ctx.fillStyle = "#3a8820";
  ctx.fillRect(x, y, 16, 16);

  // Roots
  ctx.fillStyle = "#2a1806";
  ctx.fillRect(x + 4, y + 14, 2, 2);
  ctx.fillRect(x + 10, y + 14, 2, 2);

  // Trunk - 4px wide
  ctx.fillStyle = "#3a2008";
  ctx.fillRect(x + 6, y + 9, 4, 7);
  // Trunk highlight (left edge)
  ctx.fillStyle = "#5a3010";
  ctx.fillRect(x + 6, y + 9, 1, 7);
  // Trunk shadow (right edge)
  ctx.fillStyle = "#2a1406";
  ctx.fillRect(x + 9, y + 9, 1, 7);

  // Bottom crown layer - widest
  ctx.fillStyle = "#144008";
  ctx.fillRect(x + 1, y + 7, 14, 4);
  ctx.fillStyle = "#1c5810";
  ctx.fillRect(x + 2, y + 6, 12, 4);

  // Shadow under bottom crown
  ctx.fillStyle = "#0a2806";
  ctx.fillRect(x + 1, y + 10, 14, 1);

  // Middle crown layer
  ctx.fillStyle = "#267018";
  ctx.fillRect(x + 3, y + 3, 10, 5);
  ctx.fillStyle = "#30881e";
  ctx.fillRect(x + 4, y + 2, 8, 4);

  // Top crown layer - narrowest
  ctx.fillStyle = "#3ca028";
  ctx.fillRect(x + 5, y, 6, 4);
  ctx.fillRect(x + 6, y - 1 > y ? y : y, 4, 2);

  // Crown highlights
  ctx.fillStyle = "#50c030";
  ctx.fillRect(x + 5, y + 1, 2, 2);
  ctx.fillRect(x + 4, y + 4, 2, 1);
  ctx.fillRect(x + 3, y + 6, 1, 2);

  // Crown shadow (bottom of each layer)
  ctx.fillStyle = "#0a2806";
  ctx.fillRect(x + 3, y + 6, 10, 1);
}

function drawForestFloor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  // Dense canopy base
  ctx.fillStyle = "#1e6310";
  ctx.fillRect(x, y, 16, 16);

  // Canopy layers - very detailed
  ctx.fillStyle = "#0c2408";
  ctx.fillRect(x, y + 11, 16, 5);

  ctx.fillStyle = "#144010";
  ctx.fillRect(x + 1, y + 8, 14, 5);

  ctx.fillStyle = "#1a5a10";
  ctx.fillRect(x, y + 5, 16, 5);

  ctx.fillStyle = "#246c18";
  ctx.fillRect(x, y + 2, 16, 4);

  ctx.fillStyle = "#2e7c1e";
  ctx.fillRect(x + 1, y, 14, 3);

  // Dappled light (5 dots)
  const dlx = (i * 13) % 10;
  const dly = (i * 7) % 6;
  ctx.fillStyle = "#80c040";
  ctx.fillRect(x + dlx + 1, y + dly + 1, 2, 1);
  ctx.fillRect(x + ((dlx + 6) % 12) + 1, y + ((dly + 4) % 8) + 1, 1, 1);
  ctx.fillStyle = "#60a030";
  ctx.fillRect(x + ((dlx + 3) % 11) + 1, y + ((dly + 6) % 7) + 2, 2, 1);
  ctx.fillRect(x + ((dlx + 8) % 10) + 1, y + ((dly + 2) % 9) + 1, 1, 2);
  ctx.fillRect(x + ((dlx + 5) % 12) + 1, y + ((dly + 9) % 6) + 2, 1, 1);

  // Moss on edges
  ctx.fillStyle = "#306010";
  ctx.fillRect(x, y + 3, 1, 5);
  ctx.fillRect(x + 15, y + 5, 1, 4);
  ctx.fillRect(x + 2, y, 1, 2);
  ctx.fillRect(x + 12, y + 1, 1, 2);

  // Partial trunks at bottom
  ctx.fillStyle = "#3a2008";
  ctx.fillRect(x + 3, y + 13, 2, 3);
  ctx.fillRect(x + 10, y + 12, 2, 4);
  ctx.fillStyle = "#5a3010";
  ctx.fillRect(x + 3, y + 13, 1, 3);
  ctx.fillRect(x + 10, y + 12, 1, 4);

  // Dense shadow center
  ctx.fillStyle = "#0c2408";
  ctx.fillRect(x + 5, y + 7, 6, 3);
}

function drawDenseForest(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  // Very dark canopy
  ctx.fillStyle = "#0e3208";
  ctx.fillRect(x, y, 16, 16);

  ctx.fillStyle = "#081a04";
  ctx.fillRect(x, y + 10, 16, 6);
  ctx.fillRect(x + 4, y + 6, 8, 5);

  ctx.fillStyle = "#0a2006";
  ctx.fillRect(x + 1, y + 4, 14, 8);

  ctx.fillStyle = "#122e0a";
  ctx.fillRect(x, y + 1, 16, 5);

  ctx.fillStyle = "#1a3e10";
  ctx.fillRect(x + 2, y, 12, 3);

  // Very sparse dappled light (just 1-2 weak dots)
  const dlx = (i * 17) % 9;
  const dly = (i * 11) % 5;
  ctx.fillStyle = "#4a8020";
  ctx.fillRect(x + dlx + 2, y + dly + 2, 1, 1);
  if ((i * 23) % 3 === 0) {
    ctx.fillStyle = "#3a6018";
    ctx.fillRect(x + ((dlx + 7) % 10) + 1, y + ((dly + 5) % 6) + 2, 1, 1);
  }

  // Fungus pixels
  if ((i * 29) % 5 === 0) {
    // Purple mushroom
    ctx.fillStyle = "#8040a0";
    ctx.fillRect(x + ((i * 7) % 10) + 2, y + 13, 3, 2);
    ctx.fillStyle = "#c070e0";
    ctx.fillRect(x + ((i * 7) % 10) + 2, y + 13, 3, 1);
    ctx.fillStyle = "#f0e8f4";
    ctx.fillRect(x + ((i * 7) % 10) + 3, y + 14, 1, 1);
  } else if ((i * 31) % 7 === 0) {
    // White mushroom
    ctx.fillStyle = "#c0c0b0";
    ctx.fillRect(x + ((i * 11) % 9) + 3, y + 12, 2, 3);
    ctx.fillStyle = "#e8e8d8";
    ctx.fillRect(x + ((i * 11) % 9) + 2, y + 12, 4, 1);
  }

  // Dark trunks
  ctx.fillStyle = "#2a1406";
  ctx.fillRect(x + 2, y + 11, 2, 5);
  ctx.fillRect(x + 11, y + 10, 2, 6);
}

function drawRock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  ctx.fillStyle = "#606060";
  ctx.fillRect(x, y, 16, 16);

  // Rock face - main shape (rounded on top-left)
  ctx.fillStyle = "#686868";
  ctx.fillRect(x + 1, y + 1, 13, 13);
  ctx.fillRect(x + 2, y, 11, 1);
  ctx.fillRect(x, y + 2, 1, 11);

  // Highlight top-left
  ctx.fillStyle = "#a0a0a0";
  ctx.fillRect(x + 2, y + 1, 6, 1);
  ctx.fillRect(x + 1, y + 2, 1, 5);
  ctx.fillStyle = "#909090";
  ctx.fillRect(x + 3, y + 2, 4, 1);
  ctx.fillRect(x + 2, y + 3, 1, 3);
  ctx.fillRect(x + 4, y + 3, 3, 2);

  // Shadow bottom-right
  ctx.fillStyle = "#404040";
  ctx.fillRect(x + 14, y + 3, 2, 12);
  ctx.fillRect(x + 3, y + 14, 12, 2);
  ctx.fillStyle = "#505050";
  ctx.fillRect(x + 12, y + 3, 2, 11);
  ctx.fillRect(x + 3, y + 12, 10, 2);

  // Cracks
  ctx.fillStyle = "#383838";
  if ((i * 19) % 3 === 0) {
    ctx.fillRect(x + ((i * 5) % 8) + 3, y + 4, 1, 5);
    ctx.fillRect(x + ((i * 5) % 8) + 4, y + 7, 3, 1);
  }
  if ((i * 23) % 4 === 0) {
    ctx.fillRect(x + ((i * 7) % 7) + 4, y + 6, 4, 1);
    ctx.fillRect(x + ((i * 7) % 7) + 5, y + 5, 1, 2);
  }

  // Moss on edges
  ctx.fillStyle = "#408030";
  if ((i * 11) % 3 === 0) {
    ctx.fillRect(x + 1, y + 8, 2, 3);
    ctx.fillRect(x + 2, y + 7, 1, 2);
  }
  if ((i * 13) % 4 === 0) {
    ctx.fillRect(x + 3, y + 13, 4, 2);
    ctx.fillStyle = "#50a040";
    ctx.fillRect(x + 4, y + 13, 2, 1);
  }
}

function drawCliff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  // Top rock section
  ctx.fillStyle = "#7a7060";
  ctx.fillRect(x, y, 16, 9);

  // Stratification bands
  ctx.fillStyle = "#706858";
  ctx.fillRect(x, y + 3, 16, 1);
  ctx.fillStyle = "#68604e";
  ctx.fillRect(x, y + 6, 16, 1);
  ctx.fillStyle = "#807868";
  ctx.fillRect(x, y + 1, 16, 1);

  // Highlight top
  ctx.fillStyle = "#989080";
  ctx.fillRect(x, y, 16, 1);
  ctx.fillRect(x, y + 1, 1, 2);

  // Cliff face shadow
  ctx.fillStyle = "#4a4038";
  ctx.fillRect(x, y + 9, 16, 7);

  ctx.fillStyle = "#3a3028";
  ctx.fillRect(x + 1, y + 11, 14, 5);

  // Crack on cliff face
  ctx.fillStyle = "#2a2018";
  if ((i * 7) % 3 === 0) {
    ctx.fillRect(x + ((i * 9) % 12) + 2, y + 9, 1, 6);
    ctx.fillRect(x + ((i * 9) % 12) + 2, y + 12, 2, 1);
  }

  // Water/foam at base
  ctx.fillStyle = "rgba(180,220,240,0.6)";
  ctx.fillRect(x, y + 14, 16, 2);
  ctx.fillStyle = "rgba(220,240,255,0.8)";
  ctx.fillRect(x + (i % 8), y + 14, 4, 1);
  ctx.fillRect(x + ((i * 3) % 10) + 3, y + 15, 3, 1);
}

function drawCoral(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
  ts: number,
): void {
  // Underwater base
  ctx.fillStyle = "#1a608a";
  ctx.fillRect(x, y, 16, 16);

  // Sandy bottom
  ctx.fillStyle = "rgba(200,168,74,0.4)";
  ctx.fillRect(x + 1, y + 11, 14, 5);

  // Coral formations
  ctx.fillStyle = "#e05030";
  ctx.fillRect(x + ((i * 7) % 8) + 1, y + 8, 2, 4);
  ctx.fillRect(x + ((i * 7) % 8), y + 7, 4, 2);
  ctx.fillRect(x + ((i * 7) % 8) - 1 + 1, y + 6, 2, 2);

  ctx.fillStyle = "#d84828";
  ctx.fillRect(x + ((i * 11) % 7) + 5, y + 9, 2, 3);
  ctx.fillRect(x + ((i * 11) % 7) + 4, y + 8, 4, 2);

  // Coral highlights
  ctx.fillStyle = "#ff8060";
  ctx.fillRect(x + ((i * 7) % 8) + 1, y + 7, 1, 1);
  ctx.fillRect(x + ((i * 11) % 7) + 5, y + 9, 1, 1);

  // White coral
  if ((i * 17) % 4 === 0) {
    ctx.fillStyle = "#f0f0e8";
    ctx.fillRect(x + ((i * 13) % 9) + 3, y + 10, 1, 3);
    ctx.fillRect(x + ((i * 13) % 9) + 2, y + 10, 3, 1);
  }

  // Animated fish (small)
  const fishX = Math.round(x + 4 + Math.sin(ts * 0.0004 + i * 0.5) * 4);
  const fishY = Math.round(y + 4 + Math.cos(ts * 0.0003 + i * 0.3) * 2);
  if (fishX >= x && fishX < x + 14 && fishY >= y && fishY < y + 10) {
    ctx.fillStyle = "#f08020";
    ctx.fillRect(fishX, fishY, 3, 2);
    ctx.fillStyle = "#ff9030";
    ctx.fillRect(fishX, fishY, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillRect(fishX + 2, fishY, 1, 1);
  }

  // Water ripple overlay
  const wy = Math.round(y + 2 + Math.sin(ts * 0.0005 + i * 0.18) * 1.5);
  ctx.fillStyle = "rgba(34,120,168,0.5)";
  ctx.fillRect(x, wy, 16, 1);
}

function drawSwamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
  ts: number,
): void {
  // Dark greenish base
  ctx.fillStyle = "#3a4820";
  ctx.fillRect(x, y, 16, 16);

  // Stagnant water patches
  ctx.fillStyle = "#2a3818";
  const wpx = (i * 9) % 12;
  const wpy = (i * 7) % 10;
  ctx.fillRect(x + wpx, y + wpy, 4, 3);
  ctx.fillRect(x + ((wpx + 7) % 12), y + ((wpy + 5) % 10), 3, 3);

  // Mud
  ctx.fillStyle = "#4a3c18";
  ctx.fillRect(x, y + 12, 16, 4);
  ctx.fillRect(x + 2, y + 10, 12, 3);

  // Murky water texture
  ctx.fillStyle = "#1e2c10";
  ctx.fillRect(x + ((i * 5) % 13) + 1, y + ((i * 7) % 12) + 1, 2, 1);
  ctx.fillRect(x + ((i * 11) % 12) + 2, y + ((i * 5) % 11) + 2, 1, 2);

  // Animated bubbles
  const bubT = Math.floor(ts * 0.001 + i * 0.5) % 16;
  ctx.fillStyle = "#5a6838";
  ctx.fillRect(x + ((i * 7) % 12) + 2, y + 12 - (bubT % 10), 2, 2);
  ctx.fillStyle = "#7a8858";
  ctx.fillRect(x + ((i * 7) % 12) + 2, y + 12 - (bubT % 10), 1, 1);

  // Aquatic plants
  ctx.fillStyle = "#2a5818";
  ctx.fillRect(x + ((i * 3) % 10) + 2, y + 6, 1, 5);
  ctx.fillRect(x + ((i * 3) % 10) + 1, y + 5, 3, 2);
  ctx.fillRect(x + ((i * 13) % 10) + 4, y + 7, 1, 4);
  ctx.fillRect(x + ((i * 13) % 10) + 3, y + 6, 3, 1);

  // Lighter plant tips
  ctx.fillStyle = "#3a7028";
  ctx.fillRect(x + ((i * 3) % 10) + 1, y + 5, 1, 1);
  ctx.fillRect(x + ((i * 13) % 10) + 4, y + 6, 1, 1);
}

function drawSeed(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  // Soil base
  drawSoil(ctx, x, y, i);

  // Seed shape - oval 5x4
  ctx.fillStyle = "#c09030";
  ctx.fillRect(x + 5, y + 5, 5, 1);
  ctx.fillRect(x + 4, y + 6, 7, 2);
  ctx.fillRect(x + 5, y + 8, 5, 1);

  // Highlight
  ctx.fillStyle = "#e0b840";
  ctx.fillRect(x + 5, y + 5, 2, 1);
  ctx.fillRect(x + 5, y + 6, 1, 2);

  // Shadow
  ctx.fillStyle = "#a07020";
  ctx.fillRect(x + 8, y + 7, 2, 2);
  ctx.fillRect(x + 7, y + 8, 3, 1);

  // Germination crack
  ctx.fillStyle = "#58c032";
  ctx.fillRect(x + 7, y + 4, 1, 2);
}

function drawSprout(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  i: number,
): void {
  // Soil base
  drawSoil(ctx, x, y, i);

  // Stem
  ctx.fillStyle = "#58c032";
  ctx.fillRect(x + 7, y + 6, 2, 8);

  // Left leaf - triangular
  ctx.fillStyle = "#50b828";
  ctx.fillRect(x + 4, y + 8, 3, 2);
  ctx.fillRect(x + 3, y + 6, 4, 3);
  ctx.fillRect(x + 4, y + 5, 2, 2);

  // Left leaf highlight
  ctx.fillStyle = "#70e048";
  ctx.fillRect(x + 3, y + 6, 1, 2);
  ctx.fillRect(x + 4, y + 5, 1, 1);

  // Left leaf shadow
  ctx.fillStyle = "#388018";
  ctx.fillRect(x + 5, y + 9, 2, 1);

  // Right leaf - triangular
  ctx.fillStyle = "#50b828";
  ctx.fillRect(x + 9, y + 8, 3, 2);
  ctx.fillRect(x + 9, y + 6, 4, 3);
  ctx.fillRect(x + 10, y + 5, 2, 2);

  // Right leaf highlight
  ctx.fillStyle = "#70e048";
  ctx.fillRect(x + 9, y + 6, 1, 1);

  // Right leaf shadow
  ctx.fillStyle = "#388018";
  ctx.fillRect(x + 9, y + 9, 3, 1);

  // Dew drop (occasional)
  if ((i * 41) % 5 === 0) {
    ctx.fillStyle = "rgba(200,240,255,0.9)";
    ctx.fillRect(x + 4, y + 5, 1, 1);
  }
}

// ─── Animal Sprite Renderers (10×10 px, detailed) ────────────────────────────

function drawInsect(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
): void {
  const cx = px + 5;
  const cy = py + 6;
  const wingFlap = Math.sin(ts * 0.01) > 0;

  // Wings (semitransparent blue-green)
  ctx.fillStyle = "rgba(100,200,180,0.7)";
  if (wingFlap) {
    ctx.fillRect(cx - 5, cy - 3, 4, 3);
    ctx.fillRect(cx + 1, cy - 3, 4, 3);
    ctx.fillRect(cx - 4, cy - 1, 3, 2);
    ctx.fillRect(cx + 1, cy - 1, 3, 2);
  } else {
    ctx.fillRect(cx - 5, cy - 1, 4, 3);
    ctx.fillRect(cx + 1, cy - 1, 4, 3);
  }
  // Wing venation
  ctx.fillStyle = "rgba(60,160,140,0.5)";
  if (wingFlap) {
    ctx.fillRect(cx - 4, cy - 2, 1, 2);
    ctx.fillRect(cx + 3, cy - 2, 1, 2);
  }

  // Body segments
  ctx.fillStyle = "#608820";
  ctx.fillRect(cx - 1, cy - 1, 2, 4); // abdomen
  ctx.fillStyle = "#80b000";
  ctx.fillRect(cx - 1, cy - 3, 2, 2); // thorax
  ctx.fillStyle = "#a0c830";
  ctx.fillRect(cx - 1, cy - 5, 2, 2); // head

  // Eyes
  ctx.fillStyle = "#f04020";
  ctx.fillRect(cx - 1, cy - 5, 1, 1);
  ctx.fillRect(cx, cy - 5, 1, 1);

  // Antennae
  ctx.fillStyle = "#506018";
  ctx.fillRect(cx - 2, cy - 7, 1, 3);
  ctx.fillRect(cx - 3, cy - 8, 1, 1);
  ctx.fillRect(cx + 1, cy - 7, 1, 3);
  ctx.fillRect(cx + 2, cy - 8, 1, 1);

  // 6 legs
  ctx.fillStyle = "#506018";
  // Front pair
  ctx.fillRect(cx - 3, cy - 2, 2, 1);
  ctx.fillRect(cx + 1, cy - 2, 2, 1);
  // Mid pair
  ctx.fillRect(cx - 3, cy, 2, 1);
  ctx.fillRect(cx + 1, cy, 2, 1);
  // Back pair
  ctx.fillRect(cx - 3, cy + 2, 2, 1);
  ctx.fillRect(cx + 1, cy + 2, 2, 1);
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
): void {
  const cx = px + 5;
  const cy = py + 6;
  const flapUp = Math.sin(ts * 0.006 + px * 0.1) > 0;

  // Wing (detailed, with plumes)
  ctx.fillStyle = "#9090c8";
  if (flapUp) {
    ctx.fillRect(cx - 5, cy - 3, 5, 3);
    ctx.fillRect(cx + 2, cy - 3, 5, 3);
    // Plume tips
    ctx.fillStyle = "#c0c0e8";
    ctx.fillRect(cx - 6, cy - 2, 2, 1);
    ctx.fillRect(cx + 6, cy - 2, 2, 1);
    ctx.fillRect(cx - 5, cy - 4, 1, 1);
    ctx.fillRect(cx + 5, cy - 4, 1, 1);
  } else {
    ctx.fillRect(cx - 5, cy + 1, 5, 2);
    ctx.fillRect(cx + 2, cy + 1, 5, 2);
    // Plume tips
    ctx.fillStyle = "#c0c0e8";
    ctx.fillRect(cx - 6, cy + 2, 2, 1);
    ctx.fillRect(cx + 6, cy + 2, 2, 1);
  }

  // Body
  ctx.fillStyle = "#d8d8f8";
  ctx.fillRect(cx - 2, cy - 1, 4, 3);

  // Chest stripe
  ctx.fillStyle = "#e8a030";
  ctx.fillRect(cx - 1, cy, 2, 2);

  // Head
  ctx.fillStyle = "#f0f0ff";
  ctx.fillRect(cx, cy - 3, 3, 3);

  // Crown
  ctx.fillStyle = "#7070a8";
  ctx.fillRect(cx + 1, cy - 5, 1, 3);
  ctx.fillRect(cx, cy - 4, 1, 1);
  ctx.fillRect(cx + 2, cy - 4, 1, 1);

  // Beak
  ctx.fillStyle = "#f0a020";
  ctx.fillRect(cx + 3, cy - 2, 2, 1);
  ctx.fillStyle = "#d08010";
  ctx.fillRect(cx + 3, cy - 1, 2, 1);

  // Eye
  ctx.fillStyle = "#000000";
  ctx.fillRect(cx + 1, cy - 3, 1, 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx + 2, cy - 3, 1, 1);

  // Tail
  ctx.fillStyle = "#8080b8";
  ctx.fillRect(cx - 3, cy, 2, 2);
  ctx.fillRect(cx - 4, cy + 1, 1, 2);
}

function drawMammal(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
): void {
  const cx = px + 5;
  const cy = py + 7;

  // Fluffy tail
  ctx.fillStyle = "#7a5030";
  ctx.fillRect(cx - 6, cy - 2, 3, 2);
  ctx.fillRect(cx - 7, cy - 3, 2, 2);
  ctx.fillRect(cx - 6, cy - 4, 2, 2);
  ctx.fillStyle = "#a07050";
  ctx.fillRect(cx - 6, cy - 2, 2, 1);
  ctx.fillRect(cx - 6, cy - 3, 1, 1);

  // Body (fluffy, rounded)
  ctx.fillStyle = "#9a6020";
  ctx.fillRect(cx - 3, cy - 3, 6, 4);
  ctx.fillRect(cx - 2, cy - 4, 5, 2);

  // Belly (lighter)
  ctx.fillStyle = "#c09050";
  ctx.fillRect(cx - 2, cy - 2, 4, 2);

  // Head
  ctx.fillStyle = "#b07030";
  ctx.fillRect(cx + 2, cy - 5, 4, 4);

  // Snout
  ctx.fillStyle = "#c89050";
  ctx.fillRect(cx + 4, cy - 3, 3, 2);

  // Nose
  ctx.fillStyle = "#e08060";
  ctx.fillRect(cx + 6, cy - 3, 1, 1);

  // Ears (pointy)
  ctx.fillStyle = "#c08040";
  ctx.fillRect(cx + 2, cy - 8, 1, 3);
  ctx.fillRect(cx + 5, cy - 8, 1, 3);
  ctx.fillStyle = "#f0a0a0";
  ctx.fillRect(cx + 2, cy - 7, 1, 1);
  ctx.fillRect(cx + 5, cy - 7, 1, 1);

  // Big eye
  ctx.fillStyle = "#201010";
  ctx.fillRect(cx + 3, cy - 4, 2, 2);
  ctx.fillStyle = "#604010";
  ctx.fillRect(cx + 4, cy - 4, 1, 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx + 3, cy - 4, 1, 1);

  // Legs
  ctx.fillStyle = "#7a4818";
  ctx.fillRect(cx - 2, cy, 2, 2);
  ctx.fillRect(cx + 1, cy, 2, 2);
  ctx.fillRect(cx + 3, cy, 1, 2);
}

function drawPredator(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
): void {
  const cx = px + 5;
  const cy = py + 7;

  // Long tail
  ctx.fillStyle = "#380c0c";
  ctx.fillRect(cx - 7, cy - 2, 4, 2);
  ctx.fillRect(cx - 8, cy - 3, 2, 2);
  ctx.fillStyle = "#501818";
  ctx.fillRect(cx - 7, cy - 2, 3, 1);

  // Muscular body
  ctx.fillStyle = "#4a1010";
  ctx.fillRect(cx - 3, cy - 4, 7, 5);
  ctx.fillRect(cx - 2, cy - 5, 6, 2);

  // Stripes on body
  ctx.fillStyle = "#301010";
  ctx.fillRect(cx - 1, cy - 4, 1, 4);
  ctx.fillRect(cx + 1, cy - 4, 1, 3);
  ctx.fillRect(cx + 3, cy - 4, 1, 4);

  // Head (angular)
  ctx.fillStyle = "#5a1818";
  ctx.fillRect(cx + 2, cy - 6, 5, 5);
  ctx.fillRect(cx + 3, cy - 7, 3, 2);

  // Ears
  ctx.fillStyle = "#6a2020";
  ctx.fillRect(cx + 2, cy - 9, 1, 3);
  ctx.fillRect(cx + 6, cy - 9, 1, 3);
  ctx.fillStyle = "#902030";
  ctx.fillRect(cx + 2, cy - 8, 1, 1);
  ctx.fillRect(cx + 6, cy - 8, 1, 1);

  // Snout with teeth
  ctx.fillStyle = "#7a3030";
  ctx.fillRect(cx + 6, cy - 4, 3, 2);
  // Teeth
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(cx + 7, cy - 2, 1, 2);
  ctx.fillRect(cx + 8, cy - 2, 1, 1);

  // Glowing red eyes
  ctx.fillStyle = "#ff3000";
  ctx.fillRect(cx + 3, cy - 6, 2, 2);
  ctx.fillRect(cx + 6, cy - 6, 2, 2);
  ctx.fillStyle = "#ff8050";
  ctx.fillRect(cx + 3, cy - 6, 1, 1);
  ctx.fillRect(cx + 6, cy - 6, 1, 1);

  // Legs
  ctx.fillStyle = "#3a0c0c";
  ctx.fillRect(cx - 2, cy, 2, 3);
  ctx.fillRect(cx + 1, cy, 2, 3);
  ctx.fillRect(cx + 3, cy, 2, 3);

  // Claws
  ctx.fillStyle = "#c0c0a0";
  ctx.fillRect(cx - 2, cy + 3, 1, 1);
  ctx.fillRect(cx + 1, cy + 3, 1, 1);
  ctx.fillRect(cx + 3, cy + 3, 1, 1);
}

// ─── Render Frame ─────────────────────────────────────────────────────────────

function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  rainDrops: Array<{ x: number; y: number; speed: number }>,
  timestamp: number,
  camX: number,
  camY: number,
): void {
  const { tiles, animals, tickInDay, weather } = state;

  // Clear viewport
  ctx.fillStyle = "#0a1020";
  ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);

  // Compute visible tile range
  const tileMinX = Math.max(0, Math.floor(camX / TILE_SIZE));
  const tileMinY = Math.max(0, Math.floor(camY / TILE_SIZE));
  const tileMaxX = Math.min(
    GRID_W - 1,
    Math.ceil((camX + VIEWPORT_W) / TILE_SIZE),
  );
  const tileMaxY = Math.min(
    GRID_H - 1,
    Math.ceil((camY + VIEWPORT_H) / TILE_SIZE),
  );

  // Draw visible tiles
  for (let ty = tileMinY; ty <= tileMaxY; ty++) {
    for (let tx = tileMinX; tx <= tileMaxX; tx++) {
      const i = ty * GRID_W + tx;
      const tile = tiles[i];
      const sx = tx * TILE_SIZE - camX;
      const sy = ty * TILE_SIZE - camY;

      switch (tile.type) {
        case TileType.DEEP_WATER:
          drawDeepWater(ctx, sx, sy, i, timestamp);
          break;
        case TileType.SHALLOW_WATER:
          drawShallowWater(ctx, sx, sy, i, timestamp);
          break;
        case TileType.CORAL:
          drawCoral(ctx, sx, sy, i, timestamp);
          break;
        case TileType.SAND:
          drawSand(ctx, sx, sy, i);
          break;
        case TileType.SOIL:
          drawSoil(ctx, sx, sy, i);
          break;
        case TileType.FERTILE_SOIL:
          drawFertileSoil(ctx, sx, sy, i);
          break;
        case TileType.GRASS:
          drawGrass(ctx, sx, sy, i);
          break;
        case TileType.BUSH:
          drawBush(ctx, sx, sy, i);
          break;
        case TileType.TREE:
          drawTree(ctx, sx, sy);
          break;
        case TileType.FOREST_FLOOR:
          drawForestFloor(ctx, sx, sy, i);
          break;
        case TileType.DENSE_FOREST:
          drawDenseForest(ctx, sx, sy, i);
          break;
        case TileType.ROCK:
          drawRock(ctx, sx, sy, i);
          break;
        case TileType.CLIFF:
          drawCliff(ctx, sx, sy, i);
          break;
        case TileType.SWAMP:
          drawSwamp(ctx, sx, sy, i, timestamp);
          break;
        case TileType.SEED:
          drawSeed(ctx, sx, sy, i);
          break;
        case TileType.SPROUT:
          drawSprout(ctx, sx, sy, i);
          break;
        default:
          ctx.fillStyle = TILE_COLORS[tile.type] ?? "#000";
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Draw visible animals
  for (const animal of animals) {
    const sx = animal.x * TILE_SIZE - camX;
    const sy = animal.y * TILE_SIZE - camY;
    if (sx < -16 || sx > VIEWPORT_W || sy < -16 || sy > VIEWPORT_H) continue;

    switch (animal.kind) {
      case "insect":
        drawInsect(ctx, sx, sy, timestamp);
        break;
      case "bird":
        drawBird(ctx, sx, sy, timestamp);
        break;
      case "mammal":
        drawMammal(ctx, sx, sy);
        break;
      case "predator":
        drawPredator(ctx, sx, sy);
        break;
    }
  }

  // Day/night overlay
  const dayProgress = tickInDay / TICKS_PER_DAY;
  let overlayColor = "";
  let overlayAlpha = 0;

  if (dayProgress < 0.1) {
    overlayColor = "10,20,40";
    overlayAlpha = 0.55 * (1 - dayProgress / 0.1);
  } else if (dayProgress < 0.2) {
    overlayColor = "240,160,60";
    overlayAlpha = ((dayProgress - 0.1) / 0.1) * 0.2;
  } else if (dayProgress < 0.45) {
    overlayAlpha = 0;
  } else if (dayProgress < 0.55) {
    overlayColor = "255,200,100";
    overlayAlpha = 0.04;
  } else if (dayProgress < 0.7) {
    overlayColor = "255,120,40";
    overlayAlpha = ((dayProgress - 0.55) / 0.15) * 0.32;
  } else if (dayProgress < 0.8) {
    overlayColor = "180,60,20";
    overlayAlpha = 0.32 - ((dayProgress - 0.7) / 0.1) * 0.12;
  } else if (dayProgress < 0.9) {
    overlayColor = "10,20,40";
    overlayAlpha = ((dayProgress - 0.8) / 0.1) * 0.55;
  } else {
    overlayColor = "10,20,40";
    overlayAlpha = 0.55;
  }

  if (overlayAlpha > 0) {
    ctx.fillStyle = `rgba(${overlayColor},${overlayAlpha})`;
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
  }

  // Rain effect
  if (weather === "rainy") {
    ctx.strokeStyle = "rgba(160,200,240,0.35)";
    ctx.lineWidth = 1;
    for (const drop of rainDrops) {
      const rx = drop.x - (camX % VIEWPORT_W);
      const ry = drop.y;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 3, ry + 8);
      ctx.stroke();
    }
  }
}

// ─── Minimap ──────────────────────────────────────────────────────────────────

function renderMinimap(
  mmCtx: CanvasRenderingContext2D,
  tiles: IslandTile[],
  camX: number,
  camY: number,
): void {
  mmCtx.clearRect(0, 0, GRID_W, GRID_H);

  for (let i = 0; i < tiles.length; i++) {
    const tx = i % GRID_W;
    const ty = Math.floor(i / GRID_W);
    mmCtx.fillStyle = TILE_COLORS[tiles[i].type] ?? "#000";
    mmCtx.fillRect(tx, ty, 1, 1);
  }

  // Viewport rect
  const vx = camX / TILE_SIZE;
  const vy = camY / TILE_SIZE;
  const vw = VIEWPORT_W / TILE_SIZE;
  const vh = VIEWPORT_H / TILE_SIZE;

  mmCtx.strokeStyle = "rgba(255,255,255,0.8)";
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(vx, vy, vw, vh);
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface HudCounts {
  day: number;
  plants: number;
  insects: number;
  birds: number;
  mammals: number;
  predators: number;
  weather: "sunny" | "rainy";
  dayProgress: number;
}

interface Props {
  onSaveRecord: (state: SimState) => void;
}

export function SimulatorCanvas({ onSaveRecord }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const simStateRef = useRef<SimState>(initSimState(Date.now() & 0x7fffffff));
  const speedRef = useRef<number>(4);
  const rainDropsRef = useRef<Array<{ x: number; y: number; speed: number }>>(
    [],
  );
  const rafRef = useRef<number>(0);
  const tickAccRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const cameraRef = useRef<{ x: number; y: number }>({
    x: (WORLD_W - VIEWPORT_W) / 2,
    y: (WORLD_H - VIEWPORT_H) / 2,
  });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    mx: number;
    my: number;
    cx: number;
    cy: number;
  }>({
    mx: 0,
    my: 0,
    cx: 0,
    cy: 0,
  });
  const zoomRef = useRef<number>(1);
  const minimapFrameRef = useRef<number>(0);

  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("normal");
  const [hudCounts, setHudCounts] = useState<HudCounts>({
    day: 1,
    plants: 0,
    insects: 0,
    birds: 0,
    mammals: 0,
    predators: 0,
    weather: "sunny",
    dayProgress: 0,
  });
  const [pastRunsOpen, setPastRunsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hudUpdateCounterRef = useRef(0);

  // Init rain drops
  useEffect(() => {
    const drops: Array<{ x: number; y: number; speed: number }> = [];
    for (let i = 0; i < 120; i++) {
      drops.push({
        x: Math.random() * VIEWPORT_W,
        y: Math.random() * VIEWPORT_H,
        speed: Math.random() * 3 + 2,
      });
    }
    rainDropsRef.current = drops;
  }, []);

  // Main render/simulation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    function clampCamera(cam: { x: number; y: number }) {
      const z = zoomRef.current;
      const vpW = VIEWPORT_W / z;
      const vpH = VIEWPORT_H / z;
      cam.x = Math.max(0, Math.min(cam.x, WORLD_W - vpW));
      cam.y = Math.max(0, Math.min(cam.y, WORLD_H - vpH));
    }

    function loop(timestamp: number) {
      const dt = Math.min(timestamp - lastTimeRef.current, 100);
      lastTimeRef.current = timestamp;

      const tickRate = speedRef.current;
      const msPerTick = 1000 / tickRate;

      tickAccRef.current += dt;

      while (tickAccRef.current >= msPerTick) {
        tickAccRef.current -= msPerTick;
        simulationTick(simStateRef.current);

        if (simStateRef.current.weather === "rainy") {
          for (const drop of rainDropsRef.current) {
            drop.y += drop.speed;
            drop.x -= 1;
            if (drop.y > VIEWPORT_H) {
              drop.y = -8;
              drop.x = Math.random() * VIEWPORT_W;
            }
          }
        }
      }

      if (ctx) {
        const cam = cameraRef.current;
        clampCamera(cam);

        // Apply zoom via transform
        ctx.save();
        const z = zoomRef.current;
        ctx.scale(z, z);
        renderFrame(
          ctx,
          simStateRef.current,
          rainDropsRef.current,
          timestamp,
          cam.x,
          cam.y,
        );
        ctx.restore();
      }

      // Update HUD every 10 frames
      hudUpdateCounterRef.current++;
      if (hudUpdateCounterRef.current >= 10) {
        hudUpdateCounterRef.current = 0;
        const state = simStateRef.current;
        const { grass, bush, tree } = countVegetation(state.tiles);
        const plantCount = grass + bush + tree;
        const ac = countAnimals(state.animals);
        setHudCounts({
          day: state.day,
          plants: plantCount,
          insects: ac.insects,
          birds: ac.birds,
          mammals: ac.mammals,
          predators: ac.predators,
          weather: state.weather,
          dayProgress: state.tickInDay / TICKS_PER_DAY,
        });
      }

      // Update minimap every 30 frames
      minimapFrameRef.current++;
      if (minimapFrameRef.current >= 30) {
        minimapFrameRef.current = 0;
        const mmCanvas = minimapRef.current;
        if (mmCanvas) {
          const mmCtx = mmCanvas.getContext("2d");
          if (mmCtx) {
            renderMinimap(
              mmCtx,
              simStateRef.current.tiles,
              cameraRef.current.x,
              cameraRef.current.y,
            );
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Mouse drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = {
        mx: e.clientX,
        my: e.clientY,
        cx: cameraRef.current.x,
        cy: cameraRef.current.y,
      };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDraggingRef.current) return;
      const z = zoomRef.current;
      const dx = (e.clientX - dragStartRef.current.mx) / z;
      const dy = (e.clientY - dragStartRef.current.my) / z;
      cameraRef.current.x = dragStartRef.current.cx - dx;
      cameraRef.current.y = dragStartRef.current.cy - dy;
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoomRef.current = Math.max(0.5, Math.min(2, zoomRef.current + delta));
  }, []);

  const handleSpeedChange = useCallback((s: "slow" | "normal" | "fast") => {
    setSpeed(s);
    speedRef.current = SPEED_TICKS[s];
  }, []);

  const handleNewIsland = useCallback(() => {
    onSaveRecord(simStateRef.current);
    const newSeed = Date.now() & 0x7fffffff;
    simStateRef.current = initSimState(newSeed);
    // Re-center camera
    cameraRef.current = {
      x: (WORLD_W - VIEWPORT_W) / 2,
      y: (WORLD_H - VIEWPORT_H) / 2,
    };
    tickAccRef.current = 0;
  }, [onSaveRecord]);

  // Camera scroll buttons
  const scrollCamera = useCallback((dx: number, dy: number) => {
    cameraRef.current.x += dx * TILE_SIZE * 3;
    cameraRef.current.y += dy * TILE_SIZE * 3;
  }, []);

  // Minimap click to move camera
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      cameraRef.current.x = mx * TILE_SIZE - VIEWPORT_W / 2;
      cameraRef.current.y = my * TILE_SIZE - VIEWPORT_H / 2;
    },
    [],
  );

  const timeOfDayIcon = () => {
    const p = hudCounts.dayProgress;
    if (p < 0.15 || p > 0.85) return "🌙";
    if (p < 0.3 || p > 0.7) return "🌅";
    return "☀️";
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#060e1c",
      }}
    >
      {/* Main viewport canvas */}
      <canvas
        ref={canvasRef}
        width={VIEWPORT_W}
        height={VIEWPORT_H}
        data-ocid="simulator.canvas_target"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          imageRendering: "pixelated",
          width: "100vw",
          height: "100vh",
          cursor: isDragging ? "grabbing" : "crosshair",
        }}
      />

      {/* Top-left: Day & Weather */}
      <div
        className="hud-panel"
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "8px 14px",
          minWidth: 160,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 18 }}>{timeOfDayIcon()}</span>
          <div>
            <div className="hud-label">Simulação</div>
            <div className="hud-value" style={{ fontSize: 16 }}>
              Dia {hudCounts.day}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span style={{ fontSize: 16 }}>
              {hudCounts.weather === "rainy" ? "🌧" : "🌤"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="hud-label">Horário</span>
          <div className="time-bar">
            <div
              className="time-bar-fill"
              style={{ width: `${hudCounts.dayProgress * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Top-right: Population */}
      <div
        className="hud-panel"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          padding: "8px 14px",
          zIndex: 10,
        }}
      >
        <div className="hud-label" style={{ marginBottom: 6 }}>
          População
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 16px",
          }}
        >
          <PopCount icon="🌿" label="Plantas" value={hudCounts.plants} />
          <PopCount icon="🐛" label="Insetos" value={hudCounts.insects} />
          <PopCount icon="🐦" label="Pássaros" value={hudCounts.birds} />
          <PopCount icon="🐾" label="Mamíferos" value={hudCounts.mammals} />
          <PopCount icon="🐺" label="Predadores" value={hudCounts.predators} />
        </div>
      </div>

      {/* Camera scroll arrows */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 12,
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          className="arrow-btn"
          onClick={() => scrollCamera(0, -1)}
          data-ocid="controls.scroll_up.button"
        >
          ▲
        </button>
        <button
          type="button"
          className="arrow-btn"
          onClick={() => scrollCamera(-1, 0)}
          data-ocid="controls.scroll_left.button"
        >
          ◀
        </button>
        <button
          type="button"
          className="arrow-btn"
          onClick={() => scrollCamera(1, 0)}
          data-ocid="controls.scroll_right.button"
        >
          ▶
        </button>
        <button
          type="button"
          className="arrow-btn"
          onClick={() => scrollCamera(0, 1)}
          data-ocid="controls.scroll_down.button"
        >
          ▼
        </button>
      </div>

      {/* Bottom-center: Controls */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          zIndex: 10,
        }}
      >
        <span
          style={{
            color: "rgba(200,232,208,0.35)",
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.06em",
          }}
        >
          🖱 Arraste para explorar · Scroll para zoom
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            className="hud-panel"
            style={{ padding: "6px 10px", display: "flex", gap: 4 }}
          >
            <span
              className="hud-label"
              style={{ lineHeight: "22px", marginRight: 4 }}
            >
              Velocidade:
            </span>
            <button
              type="button"
              className={`speed-btn ${speed === "slow" ? "active" : ""}`}
              onClick={() => handleSpeedChange("slow")}
              data-ocid="controls.speed_slow.button"
            >
              🐌 Lento
            </button>
            <button
              type="button"
              className={`speed-btn ${speed === "normal" ? "active" : ""}`}
              onClick={() => handleSpeedChange("normal")}
              data-ocid="controls.speed_normal.button"
            >
              ▶ Normal
            </button>
            <button
              type="button"
              className={`speed-btn ${speed === "fast" ? "active" : ""}`}
              onClick={() => handleSpeedChange("fast")}
              data-ocid="controls.speed_fast.button"
            >
              ⚡ Rápido
            </button>
          </div>
          <button
            type="button"
            className="action-btn"
            onClick={handleNewIsland}
            data-ocid="controls.new_island.button"
          >
            🏝 Nova Ilha
          </button>
        </div>
      </div>

      {/* Bottom-right: Past Runs */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          className="action-btn"
          onClick={() => setPastRunsOpen((v) => !v)}
          data-ocid="controls.past_runs.button"
        >
          📜 Histórico
        </button>
      </div>

      {/* Bottom-left: Minimap */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 60,
          zIndex: 10,
          border: "1px solid rgba(72,180,120,0.3)",
          borderRadius: 4,
          overflow: "hidden",
          background: "rgba(8,15,28,0.7)",
        }}
      >
        <canvas
          ref={minimapRef}
          width={GRID_W}
          height={GRID_H}
          onClick={handleMinimapClick}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              handleMinimapClick(
                e as unknown as React.MouseEvent<HTMLCanvasElement>,
              );
          }}
          tabIndex={0}
          role="button"
          aria-label="Minimapa - clique para navegar"
          data-ocid="simulator.map_marker"
          style={{
            display: "block",
            width: GRID_W,
            height: GRID_H,
            imageRendering: "pixelated",
            cursor: "pointer",
          }}
        />
      </div>

      {/* Past Runs Panel */}
      {pastRunsOpen && <PastRunsPanel onClose={() => setPastRunsOpen(false)} />}
    </div>
  );
}

// ─── PopCount ─────────────────────────────────────────────────────────────────

function PopCount({
  icon,
  label,
  value,
}: { icon: string; label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <div>
        <div className="hud-label">{label}</div>
        <div className="hud-value">{value}</div>
      </div>
    </div>
  );
}

// ─── Past Runs Panel ──────────────────────────────────────────────────────────

function PastRunsPanel({ onClose }: { onClose: () => void }) {
  const { actor, isFetching } = useActor();
  const { data: records, isLoading } = useQuery<SimulationRecord[]>({
    queryKey: ["pastRuns"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getLast10Records();
    },
    enabled: !!actor && !isFetching,
    staleTime: 10000,
  });

  return (
    <div className="past-runs-panel" data-ocid="past_runs.panel">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px 8px",
          borderBottom: "1px solid rgba(72,180,120,0.2)",
        }}
      >
        <span
          style={{
            color: "var(--hud-accent)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          📜 Histórico de Simulações
        </span>
        <button
          type="button"
          onClick={onClose}
          data-ocid="past_runs.close_button"
          style={{
            background: "none",
            border: "none",
            color: "rgba(200,232,208,0.5)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 4px",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "8px 0" }}>
        {isLoading ? (
          <div
            data-ocid="past_runs.loading_state"
            style={{
              padding: "20px",
              textAlign: "center",
              color: "rgba(200,232,208,0.5)",
              fontSize: 12,
            }}
          >
            Carregando...
          </div>
        ) : !records || records.length === 0 ? (
          <div
            data-ocid="past_runs.empty_state"
            style={{
              padding: "20px",
              textAlign: "center",
              color: "rgba(200,232,208,0.4)",
              fontSize: 12,
            }}
          >
            Nenhuma simulação salva ainda.
            <br />
            <span style={{ fontSize: 10, opacity: 0.7 }}>
              Gere uma nova ilha para registrar.
            </span>
          </div>
        ) : (
          records.map((rec, i) => (
            <RunRecord key={rec.seed.toString()} record={rec} index={i + 1} />
          ))
        )}
      </div>
    </div>
  );
}

function RunRecord({
  record,
  index,
}: { record: SimulationRecord; index: number }) {
  return (
    <div
      data-ocid={`past_runs.item.${index}`}
      style={{
        padding: "8px 14px",
        borderBottom: "1px solid rgba(72,180,120,0.08)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "2px 12px",
      }}
    >
      <div style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
        <span
          style={{ color: "var(--hud-accent)", fontSize: 11, fontWeight: 700 }}
        >
          🏝 Ilha #{record.seed.toString().slice(-6)}
        </span>
        <span
          style={{
            color: "rgba(200,232,208,0.4)",
            fontSize: 10,
            marginLeft: 8,
          }}
        >
          {Number(record.daysElapsed)} dias
        </span>
      </div>
      <RecordStat
        icon="🌿"
        label="Plantas"
        value={Number(record.peakPlantCount)}
      />
      <RecordStat
        icon="🐛"
        label="Insetos"
        value={Number(record.peakInsectCount)}
      />
      <RecordStat
        icon="🐦"
        label="Pássaros"
        value={Number(record.peakBirdCount)}
      />
      <RecordStat
        icon="🐾"
        label="Mamíferos"
        value={Number(record.peakMammalCount)}
      />
      <RecordStat
        icon="🐺"
        label="Predadores"
        value={Number(record.peakPredatorCount)}
      />
    </div>
  );
}

function RecordStat({
  icon,
  label,
  value,
}: { icon: string; label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span
        style={{
          color: "rgba(200,232,208,0.45)",
          fontSize: 9,
          textTransform: "uppercase",
        }}
      >
        {label}:
      </span>
      <span
        style={{
          color: "rgba(200,232,208,0.8)",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

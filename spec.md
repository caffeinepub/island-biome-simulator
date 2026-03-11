# Island Biome Simulator

## Current State
- Canvas-based top-down RPG pixel art island simulator
- 160x120 tile grid (2560x1920 world), tile size 16px
- Day/night cycle (tickInDay / TICKS_PER_DAY), weather (sunny/rainy)
- Plants grow in stages: seed → sprout → grass → bush → tree → forest
- Animals: insect, bird, mammal, predator with caps and basic AI
- HUD: top-left day/weather/time bar, top-right population counts
- Camera: drag, scroll wheel zoom, arrow scroll buttons
- Minimap (bottom-right)
- Speed controls (slow/normal/fast) + new island button
- Simulation records saved to backend

## Requested Changes (Diff)

### Add
- Population history chart panel: line chart showing last 200 days of each species (plants, insects, birds, mammals, predators). Toggle button to show/hide.
- Seasons system: 4 seasons (spring=days 1-90, summer=91-180, autumn=181-270, winter=271-360, then loops). Each season affects tile tint overlay and spawn/growth rates:
  - Spring: slight green tint, faster growth
  - Summer: warm/bright, normal
  - Autumn: orange/yellow tint
  - Winter: blue/grey tint, slower growth, less animals
- Day/night lighting overlay on canvas: subtle dark-blue overlay at night (dayProgress < 0.15 or > 0.85), warm orange at dawn/dusk (0.15-0.25 and 0.75-0.85)
- Tile legend panel: collapsible sidebar showing each TileType with its pixel art color swatch and name (in Portuguese)
- Season indicator in the top-left HUD panel

### Modify
- Population HUD to show season icon/name
- simulationTick to update season based on day number
- Canvas render loop to apply day/night and season color overlay
- Speed controls UI: more polished pill buttons
- History data collection: every day push counts to a rolling array (max 200 entries)

### Remove
- Nothing

## Implementation Plan
1. Add `season` field and `history` array to SimState
2. Compute season from `state.day % 360`
3. Collect population history snapshot once per day in the game loop
4. Apply canvas overlay (globalAlpha + fillStyle) after tile rendering for day/night and season
5. Build PopulationChart component using SVG line paths from history data
6. Add toggle button to show/hide chart panel (bottom-right or side panel)
7. Add TileLegend collapsible panel (left sidebar or modal)
8. Update top-left HUD to show season emoji + name
9. Polish speed controls and general HUD styling

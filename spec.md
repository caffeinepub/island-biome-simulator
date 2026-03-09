# Island Biome Simulator

## Current State
- Mapa de 80x60 tiles com tiles de 16x16px (canvas 1280x960)
- Pixel art no estilo SNES com tiles desenhados via Canvas API
- Simulação de ecossistema: plantas, animais, ciclo dia/noite, clima
- HUD com painel de população e controles de velocidade

## Requested Changes (Diff)

### Add
- Mapa muito maior: aumentar para 160x120 tiles (grid 2x maior em cada dimensão)
- Tiles de 16x16 mantidos, canvas resultante de 2560x1920 (escalonado para tela)
- Câmera com scroll suave (pan) controlada por arrastar ou botões de direção
- Minimap no canto para orientação
- Efeito de scroll automático para câmera centrada na ilha ao iniciar
- Variedades de tile com sub-variantes RPG (rocha, penhasco, praia com pedras, água com recife de coral, solo fértil, floresta densa)
- Novos tipos de tile: ROCK (rocha), CLIFF (penhasco/litoral), CORAL (recife submarino), FERTILE_SOIL (solo fértil escuro), DENSE_FOREST (floresta densa)
- Sprites de animais maiores/mais detalhados (8x8 ao invés de 5x5)
- Efeito de vinheta ao redor da tela para estilo cinematográfico

### Modify
- islandGen.ts: GRID_W de 80 para 160, GRID_H de 60 para 120
- islandGen.ts: adicionar novos TileType (ROCK, CLIFF, CORAL, FERTILE_SOIL, DENSE_FOREST)
- islandGen.ts: geração de ilha melhorada com mais variação de biomas e terrenos
- SimulatorCanvas.tsx: implementar câmera com viewport + pan por drag
- SimulatorCanvas.tsx: renderizar apenas os tiles visíveis (culling)
- SimulatorCanvas.tsx: melhorar TODOS os drawTile com pixel art muito mais detalhado estilo RPG (Chrono Trigger / FFVI)
- SimulatorCanvas.tsx: tiles de água com profundidade e variações de cor
- SimulatorCanvas.tsx: areia com textura de seixos e conchas
- SimulatorCanvas.tsx: floresta com sombras, perspectiva isométrica suave e profundidade
- SimulatorCanvas.tsx: adicionar minimap no canto inferior esquerdo
- Aumentar ANIMAL_CAPS proporcionalmente ao novo tamanho do mapa

### Remove
- Nada removido

## Implementation Plan
1. Atualizar islandGen.ts: novos GRID_W/H, TileTypes, geração de bioma mais rica
2. Atualizar SimulatorCanvas.tsx: câmera com viewport/pan/drag, culling de tiles
3. Reescrever todas as funções drawTile com pixel art RPG muito mais rico
4. Adicionar minimap
5. Ajustar ANIMAL_CAPS e lógica de spawn para o mapa maior
6. Validar e publicar

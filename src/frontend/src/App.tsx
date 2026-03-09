import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { SimulatorCanvas } from "./components/SimulatorCanvas";
import type { SimState } from "./components/SimulatorCanvas";
import { useActor } from "./hooks/useActor";

function AppInner() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  const handleSaveRecord = useCallback(
    async (state: SimState) => {
      if (!actor) return;
      try {
        await actor.saveSimulationRecord(
          BigInt(state.seed),
          BigInt(state.day),
          BigInt(state.peakPlants),
          BigInt(state.peakInsects),
          BigInt(state.peakBirds),
          BigInt(state.peakMammals),
          BigInt(state.peakPredators),
        );
        // Invalidate past runs cache
        queryClient.invalidateQueries({ queryKey: ["pastRuns"] });
      } catch (err) {
        console.error("Failed to save simulation record:", err);
      }
    },
    [actor, queryClient],
  );

  return <SimulatorCanvas onSaveRecord={handleSaveRecord} />;
}

export default function App() {
  return <AppInner />;
}

import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface SimulationRecord {
    peakPredatorCount: bigint;
    daysElapsed: bigint;
    seed: bigint;
    peakPlantCount: bigint;
    peakMammalCount: bigint;
    timestamp: Time;
    peakBirdCount: bigint;
    peakInsectCount: bigint;
}
export type Time = bigint;
export interface backendInterface {
    getLast10Records(): Promise<Array<SimulationRecord>>;
    saveSimulationRecord(seed: bigint, daysElapsed: bigint, peakPlantCount: bigint, peakInsectCount: bigint, peakBirdCount: bigint, peakMammalCount: bigint, peakPredatorCount: bigint): Promise<void>;
}

import Time "mo:core/Time";
import List "mo:core/List";

actor {
  type SimulationRecord = {
    seed : Nat;
    daysElapsed : Nat;
    peakPlantCount : Nat;
    peakInsectCount : Nat;
    peakBirdCount : Nat;
    peakMammalCount : Nat;
    peakPredatorCount : Nat;
    timestamp : Time.Time;
  };

  let records = List.empty<SimulationRecord>();

  public shared ({ caller }) func saveSimulationRecord(seed : Nat, daysElapsed : Nat, peakPlantCount : Nat, peakInsectCount : Nat, peakBirdCount : Nat, peakMammalCount : Nat, peakPredatorCount : Nat) : async () {
    let newRecord : SimulationRecord = {
      seed;
      daysElapsed;
      peakPlantCount;
      peakInsectCount;
      peakBirdCount;
      peakMammalCount;
      peakPredatorCount;
      timestamp = Time.now();
    };
    records.add(newRecord);
  };

  public query ({ caller }) func getLast10Records() : async [SimulationRecord] {
    var count = 0;
    records.values().takeWhile(func(_) { count += 1; count <= 10 }).toArray();
  };
};

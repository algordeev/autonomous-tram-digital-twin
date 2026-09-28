#pragma once

#include <optional>
#include <string_view>

namespace tram {

enum class JunctionPhase {
  road_green,
  road_amber,
  all_red_to_tram,
  tram_green,
  tram_amber,
  all_red_to_road,
};

struct PriorityParameters {
  double detection_distance_m = 85.0;
  double minimum_road_green_s = 10.0;
  double amber_s = 3.0;
  double all_red_s = 1.5;
  double minimum_tram_green_s = 6.0;
  double clearance_hold_s = 1.5;
};

struct JunctionObservation {
  double simulation_time_s = 0.0;
  std::optional<double> westbound_distance_m;
  std::optional<double> eastbound_distance_m;
  bool tram_in_conflict_zone = false;
  bool active_tram_fully_cleared = false;
};

struct JunctionCommand {
  JunctionPhase phase = JunctionPhase::road_green;
  std::string_view signal_state = "GGrr";
  bool road_allowed = true;
  bool tram_allowed = false;
  bool tram_grant_latched = false;
};

class PriorityController {
 public:
  explicit PriorityController(PriorityParameters parameters = {});

  JunctionCommand update(const JunctionObservation& observation);
  JunctionCommand command() const;
  void reset(double simulation_time_s = 0.0);

 private:
  bool has_approaching_tram(const JunctionObservation& observation) const;
  void transition(JunctionPhase next, double simulation_time_s);

  PriorityParameters parameters_;
  JunctionPhase phase_ = JunctionPhase::road_green;
  double phase_started_s_ = 0.0;
  std::optional<double> clearance_started_s_;
  bool tram_entered_ = false;
};

}  // namespace tram

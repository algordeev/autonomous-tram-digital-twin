#include "tram/depot_controller.hpp"
#include "tram/priority_controller.hpp"
#include "tram/service_controller.hpp"
#include "tram/stop_controller.hpp"
#include "tram/track_graph.hpp"
#include "tram/vehicle_dynamics.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

constexpr double kStepSeconds = 0.1;
constexpr double kCrossingX = 125.0;
constexpr double kStopLineOffset = 22.0;
constexpr double kConflictHalfWidth = 12.0;
constexpr double kSafetyGap = 32.0;

struct TramVehicle {
  std::string id;
  std::string route;
  std::string service_group;
  tram::TrackPosition track;
  tram::RouteChoices choices;
  double starts_at = 0.0;
  bool eastbound = true;
  tram::StopController stop_controller;
  tram::ServiceController service_controller;
  bool passenger_service = true;
  tram::VehicleState state{};
  bool was_inside = false;
  tram::StopServiceCommand stop_command{};
  tram::ServiceCommand service_command{};
  std::optional<tram::DepotController> depot_controller;
  tram::DepotCommand depot_command{};
};

struct RoadVehicle {
  std::string id;
  double x;
  double y;
  double direction;
  double speed_mps;
};

tram::TrackGraph make_network() {
  tram::TrackGraph graph;
  graph.add_segment("E0", "west", "switch-east",
                    {{-230, -18}, {-90, -18}});
  graph.add_segment("E-straight", "switch-east", "merge-east",
                    {{-90, -18}, {70, -18}});
  graph.add_segment("E-branch", "switch-east", "merge-east",
                    {{-90, -18}, {-35, -78}, {25, -78}, {70, -18}});
  graph.add_segment("E2", "merge-east", "east",
                    {{70, -18}, {230, -18}});
  graph.add_turnout("KRS-E", "switch-east", "E-straight", "E-branch");
  graph.add_segment("E-depot-in", "merge-east", "depot-yard",
                    {{70, -18}, {105, -55}, {105, -112}});
  graph.add_segment("E-depot-return", "depot-yard", "west",
                    {{105, -112}, {-155, -112}, {-230, -18}});
  graph.add_turnout("KRS-DEPOT-E", "merge-east", "E2", "E-depot-in");

  graph.add_segment("W0", "east", "switch-west",
                    {{230, 18}, {70, 18}});
  graph.add_segment("W-straight", "switch-west", "merge-west",
                    {{70, 18}, {-90, 18}});
  graph.add_segment("W-branch", "switch-west", "merge-west",
                    {{70, 18}, {25, 78}, {-35, 78}, {-90, 18}});
  graph.add_segment("W2", "merge-west", "west",
                    {{-90, 18}, {-230, 18}});
  graph.add_turnout("KRS-W", "switch-west", "W-straight", "W-branch");
  return graph;
}

std::vector<tram::StopDefinition> make_stops() {
  return {
      {"STOP-KRS-E2", "Route 2 →", "E-straight", 82.0,
       10.0},
      {"STOP-KRS-E21", "Route 21", "E-branch", 112.0,
       8.0},
      {"STOP-KRS-W2", "Route 2 ←", "W-straight", 82.0,
       10.0},
      {"STOP-KRS-W21", "Route 21", "W-branch", 112.0,
       8.0},
  };
}

std::vector<tram::ServicePlan> make_service_plans() {
  return {
      {"R2-CW", "2", "clockwise", 2, 22.0, 125.0, 10.3, 11.3},
      {"R2-CCW", "2", "counterclockwise", 2, 24.0, 125.0, 10.3, 11.3},
      {"R21-CHP", "21", "to Chyorny Prud", 2, 28.0, 135.0, 10.0, 11.0},
      {"R21-PARK", "21", "to Park Dubki", 2, 28.0, 135.0, 10.0, 11.0},
  };
}

const tram::ServicePlan& service_plan(
    const std::vector<tram::ServicePlan>& plans,
    const std::string& id) {
  const auto found = std::find_if(
      plans.begin(), plans.end(),
      [&id](const tram::ServicePlan& plan) { return plan.id == id; });
  if (found == plans.end()) throw std::out_of_range("unknown service plan");
  return *found;
}

double distance_to_stop(const tram::TrackGraph& graph,
                        const TramVehicle& vehicle) {
  const auto& stop = vehicle.stop_controller.definition();
  return graph.distance_ahead(
                  vehicle.track, {stop.segment_id, stop.offset_m},
                  vehicle.choices)
      .value_or(std::numeric_limits<double>::infinity());
}

double distance_to_depot(const tram::TrackGraph& graph,
                         const TramVehicle& vehicle) {
  const auto& depot_track = graph.segment("E-depot-in");
  return graph.distance_ahead(vehicle.track,
                              {"E-depot-in", depot_track.length_m},
                              vehicle.choices)
      .value_or(std::numeric_limits<double>::infinity());
}

bool is_active(const TramVehicle& vehicle, double time) {
  return time >= vehicle.starts_at;
}

bool is_on_network(const TramVehicle& vehicle, double time) {
  return is_active(vehicle, time) &&
         (!vehicle.depot_controller.has_value() ||
          vehicle.depot_controller->state() != tram::DepotState::in_depot);
}

std::optional<double> same_service_gap(
    const tram::TrackGraph& graph,
    const TramVehicle& vehicle,
    const std::vector<TramVehicle>& trams,
    double time) {
  std::optional<double> closest;
  for (const auto& other : trams) {
    if (other.id == vehicle.id || other.service_group != vehicle.service_group ||
        !is_on_network(other, time) || !other.passenger_service) {
      continue;
    }
    const auto distance =
        graph.distance_ahead(vehicle.track, other.track, vehicle.choices);
    if (distance.has_value() && distance.value() > 1e-6 &&
        (!closest.has_value() || distance.value() < closest.value())) {
      closest = distance;
    }
  }
  return closest;
}

bool at_track_end(const tram::TrackGraph& graph, const TramVehicle& vehicle) {
  const auto& segment = graph.segment(vehicle.track.segment_id);
  return vehicle.track.offset_m >= segment.length_m - 1e-6 &&
         !graph.next_segment(vehicle.track.segment_id, vehicle.choices).has_value();
}

tram::TrackPoint position_of(const tram::TrackGraph& graph,
                             const TramVehicle& vehicle) {
  return graph.point_at(vehicle.track);
}

std::optional<double> approach_distance(const tram::TrackGraph& graph,
                                        const TramVehicle& vehicle,
                                        double time) {
  if (!is_on_network(vehicle, time) || at_track_end(graph, vehicle)) {
    return std::nullopt;
  }
  const auto point = position_of(graph, vehicle);
  if (std::abs(point.y) > 40.0 ||
      vehicle.track.segment_id.find("depot") != std::string::npos) {
    return std::nullopt;
  }
  if (vehicle.eastbound && point.x <= kCrossingX - kConflictHalfWidth) {
    return kCrossingX - kConflictHalfWidth - point.x;
  }
  if (!vehicle.eastbound && point.x >= kCrossingX + kConflictHalfWidth) {
    return point.x - kCrossingX - kConflictHalfWidth;
  }
  return std::nullopt;
}

bool inside_conflict(const tram::TrackGraph& graph,
                     const TramVehicle& vehicle,
                     double time) {
  if (!is_on_network(vehicle, time)) return false;
  const auto point = position_of(graph, vehicle);
  return std::abs(point.x - kCrossingX) < kConflictHalfWidth &&
         std::abs(point.y) < 36.0;
}

double signal_limited_speed(const tram::TrackGraph& graph,
                            const TramVehicle& vehicle,
                            double time,
                            bool tram_allowed) {
  if (!is_on_network(vehicle, time) || at_track_end(graph, vehicle)) return 0.0;
  const auto point = position_of(graph, vehicle);
  const double stop_line = vehicle.eastbound
                               ? kCrossingX - kStopLineOffset
                               : kCrossingX + kStopLineOffset;
  const double distance = vehicle.eastbound ? stop_line - point.x
                                             : point.x - stop_line;
  if (!tram_allowed && distance > -2.0 && distance < 65.0) return 0.0;
  return 11.5;
}

double leader_limited_speed(const tram::TrackGraph& graph,
                            const TramVehicle& vehicle,
                            const std::vector<tram::TrackPosition>& others,
                            double target_speed) {
  const double free_distance = graph.safe_advance_distance(
      vehicle.track, others, 1'000.0, kSafetyGap, vehicle.choices);
  if (free_distance >= 70.0) return target_speed;
  const double comfortable_speed = std::sqrt(std::max(0.0, 1.8 * free_distance));
  return std::min(target_speed, comfortable_speed);
}

void update_road_vehicle(RoadVehicle& vehicle, bool road_allowed) {
  const double proposed = vehicle.y +
                          vehicle.direction * vehicle.speed_mps * kStepSeconds;
  const double line = vehicle.direction > 0.0 ? -22.0 : 22.0;
  const bool crosses_line = vehicle.direction > 0.0
                                ? vehicle.y < line && proposed >= line
                                : vehicle.y > line && proposed <= line;
  const bool held_at_line = std::abs(vehicle.y - line) < 0.05;
  if (!road_allowed && (crosses_line || held_at_line)) {
    vehicle.y = line;
    return;
  }
  vehicle.y = proposed;
  if (vehicle.y > 220.0) vehicle.y = -220.0;
  if (vehicle.y < -220.0) vehicle.y = 220.0;
}

void write_vehicle(std::ostream& output,
                   const std::string& id,
                   const std::string& route,
                   const std::string& service_group,
                   double x,
                   double y,
                   double angle,
                   double speed,
                   const std::string& edge,
                   const std::string& status,
                   bool doors_open,
                   const std::string& stop_id,
                   const std::string& regulation,
                   double scheduled_start,
                   const std::string& depot_state = "none",
                   const std::string& destination = "",
                   bool passenger_service = true,
                   const std::string& depot_id = "") {
  output << "{\"id\":\"" << id << "\",\"route\":\"" << route
         << "\",\"serviceGroup\":\"" << service_group
         << "\",\"x\":" << x << ",\"y\":" << y
         << ",\"angle\":" << angle << ",\"speedMps\":" << speed
         << ",\"edge\":\"" << edge << "\",\"status\":\"" << status
         << "\",\"doorsOpen\":" << (doors_open ? "true" : "false")
         << ",\"stopId\":\"" << stop_id << "\",\"regulation\":\""
         << regulation << "\",\"scheduledStart\":" << scheduled_start
         << ",\"depotState\":\"" << depot_state
         << "\",\"destination\":\"" << destination
         << "\",\"passengerService\":"
         << (passenger_service ? "true" : "false")
         << ",\"depotId\":\"" << depot_id << "\"}";
}

void write_network(std::ostream& output,
                   const tram::TrackGraph& graph,
                   const std::vector<tram::StopDefinition>& stops,
                   const std::vector<tram::ServicePlan>& service_plans) {
  output << "\"network\":{\"crossing\":{\"x\":" << kCrossingX
         << ",\"y\":0},\"tracks\":[";
  bool first = true;
  for (const auto& segment : graph.segments()) {
    if (!first) output << ',';
    first = false;
    const bool branch = segment.id.find("branch") != std::string::npos ||
                        segment.id.find("depot") != std::string::npos;
    output << "{\"id\":\"" << segment.id << "\",\"kind\":\""
           << (branch ? "branch" : "main") << "\",\"points\":[";
    for (std::size_t index = 0; index < segment.geometry.size(); ++index) {
      if (index > 0) output << ',';
      output << '[' << segment.geometry[index].x << ','
             << segment.geometry[index].y << ']';
    }
    output << "]}";
  }
  output << "],\"turnouts\":[";
  first = true;
  for (const auto& turnout : graph.turnouts()) {
    if (!first) output << ',';
    first = false;
    const auto incoming = std::find_if(
        graph.segments().begin(), graph.segments().end(),
        [&turnout](const tram::TrackSegment& segment) {
          return segment.to_node == turnout.node_id;
        });
    const auto point = incoming == graph.segments().end()
                           ? tram::TrackPoint{}
                           : incoming->geometry.back();
    output << "{\"id\":\"" << turnout.id << "\",\"x\":" << point.x
           << ",\"y\":" << point.y << ",\"straight\":\""
           << turnout.straight_segment_id << "\",\"diverging\":\""
           << turnout.diverging_segment_id << "\",\"selected\":\""
           << tram::turnout_position_name(turnout.position) << "\"}";
  }
  output << "],\"stops\":[";
  first = true;
  for (const auto& stop : stops) {
    if (!first) output << ',';
    first = false;
    const auto point = graph.point_at({stop.segment_id, stop.offset_m});
    output << "{\"id\":\"" << stop.id << "\",\"name\":\"" << stop.name
           << "\",\"segment\":\"" << stop.segment_id << "\",\"offsetM\":"
           << stop.offset_m << ",\"x\":" << point.x << ",\"y\":" << point.y
           << ",\"dwellSeconds\":" << stop.dwell_seconds << '}';
  }
  output << "],\"servicePlans\":[";
  first = true;
  for (const auto& plan : service_plans) {
    if (!first) output << ',';
    first = false;
    output << "{\"id\":\"" << plan.id << "\",\"route\":\"" << plan.route
           << "\",\"direction\":\"" << plan.direction << "\",\"fleetSize\":"
           << plan.fleet_size << ",\"plannedHeadwaySeconds\":"
           << plan.planned_headway_seconds << ",\"nominalSpacingM\":"
           << plan.nominal_spacing_m << '}';
  }
  output << "],\"depots\":[{\"id\":\"DEPOT-1\",\"name\":\"Tram depot\","
            "\"x\":105,\"y\":-112,\"capacity\":6}]},";
}

void write_service_statistics(
    std::ostream& output,
    const std::vector<tram::ServicePlan>& plans,
    const std::vector<TramVehicle>& trams,
    const std::unordered_map<std::string, tram::HeadwayStatistics>& statistics,
    double time) {
  output << "\"services\":[";
  bool first = true;
  for (const auto& plan : plans) {
    if (!first) output << ',';
    first = false;
    const auto found = statistics.find(plan.id);
    const auto average = found == statistics.end()
                             ? std::optional<double>{}
                             : found->second.actual_average_seconds();
    const auto active = std::count_if(
        trams.begin(), trams.end(), [&plan, time](const TramVehicle& vehicle) {
          return vehicle.service_group == plan.id && is_active(vehicle, time) &&
                 vehicle.passenger_service;
        });
    output << "{\"id\":\"" << plan.id << "\",\"plannedHeadwaySeconds\":"
           << plan.planned_headway_seconds << ",\"actualAverageHeadwaySeconds\":";
    if (average.has_value()) output << average.value();
    else output << "null";
    output << ",\"activeTrams\":" << active << '}';
  }
  output << "],";
}

void write_depot_statistics(std::ostream& output,
                            const std::vector<TramVehicle>& trams,
                            double time) {
  int in_depot = 0;
  int outbound = 0;
  int inbound = 0;
  int passenger = 0;
  for (const auto& vehicle : trams) {
    if (!is_active(vehicle, time)) continue;
    if (!vehicle.depot_controller.has_value()) {
      if (vehicle.passenger_service) ++passenger;
      continue;
    }
    switch (vehicle.depot_controller->state()) {
      case tram::DepotState::in_depot: ++in_depot; break;
      case tram::DepotState::outbound: ++outbound; break;
      case tram::DepotState::inbound: ++inbound; break;
      case tram::DepotState::passenger_service: ++passenger; break;
    }
  }
  output << "\"depot\":{\"id\":\"DEPOT-1\",\"inDepot\":" << in_depot
         << ",\"outbound\":" << outbound << ",\"inbound\":" << inbound
         << ",\"passengerService\":" << passenger << "},";
}

}  // namespace

int main(int argc, char** argv) {
  const std::string output_path =
      argc > 1 ? argv[1] : "native-track-graph-replay.json";
  std::ofstream output(output_path);
  if (!output) {
    std::cerr << "Cannot open replay output: " << output_path << '\n';
    return 1;
  }

  auto graph = make_network();
  const auto stops = make_stops();
  const auto service_plans = make_service_plans();
  tram::PriorityController controller;
  const tram::RouteChoices east_straight{
      {"KRS-E", tram::TurnoutPosition::straight},
      {"KRS-DEPOT-E", tram::TurnoutPosition::straight}};
  const tram::RouteChoices east_branch{
      {"KRS-E", tram::TurnoutPosition::diverging},
      {"KRS-DEPOT-E", tram::TurnoutPosition::straight}};
  const tram::RouteChoices west_straight{
      {"KRS-W", tram::TurnoutPosition::straight}};
  const tram::RouteChoices west_branch{
      {"KRS-W", tram::TurnoutPosition::diverging}};
  std::vector<TramVehicle> trams{
      {"tram_2_lead", "2", "R2-CW", {"E0", 80.0}, east_straight, 0.0,
       true, tram::StopController{stops[0]},
       tram::ServiceController{service_plan(service_plans, "R2-CW"), 0.0}},
      {"tram_2_follow", "2", "R2-CW", {"E0", 20.0}, east_straight, 22.0,
       true, tram::StopController{stops[0]},
       tram::ServiceController{service_plan(service_plans, "R2-CW"), 22.0}},
      {"tram_2_opposite", "2", "R2-CCW", {"W0", 55.0}, west_straight,
       4.0, false, tram::StopController{stops[2]},
       tram::ServiceController{service_plan(service_plans, "R2-CCW"), 4.0}},
      {"tram_2_opposite_follow", "2", "R2-CCW", {"W0", 5.0},
       west_straight, 28.0, false, tram::StopController{stops[2]},
       tram::ServiceController{service_plan(service_plans, "R2-CCW"), 28.0}},
      {"tram_21_branch", "21", "R21-CHP", {"E0", 30.0}, east_branch,
       10.0, true, tram::StopController{stops[1]},
       tram::ServiceController{service_plan(service_plans, "R21-CHP"), 10.0}},
      {"tram_21_branch_follow", "21", "R21-CHP", {"E0", 0.0},
       east_branch, 38.0, true, tram::StopController{stops[1]},
       tram::ServiceController{service_plan(service_plans, "R21-CHP"), 38.0}},
      {"tram_21_park", "21", "R21-PARK", {"W0", 25.0}, west_branch,
       16.0, false, tram::StopController{stops[3]},
       tram::ServiceController{service_plan(service_plans, "R21-PARK"), 16.0}},
      {"tram_21_park_follow", "21", "R21-PARK", {"W0", 0.0}, west_branch,
       44.0, false, tram::StopController{stops[3]},
       tram::ServiceController{service_plan(service_plans, "R21-PARK"), 44.0}},
      {"tram_2_depot_spare", "2", "R2-CW", {"E-depot-return", 0.0},
       east_straight, 0.0, true, tram::StopController{stops[0]},
       tram::ServiceController{service_plan(service_plans, "R2-CW"), 42.0}},
  };
  trams[0].depot_controller.emplace(tram::DepotAssignment{
      "DEPOT-1", "2 · clockwise", "Krasnoselskaya", 0.0, 18.0, false});
  trams.back().depot_controller.emplace(tram::DepotAssignment{
      "DEPOT-1", "2 · clockwise", "Krasnoselskaya", 42.0, 1.0e12, true});
  for (auto& vehicle : trams) {
    if (vehicle.depot_controller.has_value()) {
      vehicle.depot_command = vehicle.depot_controller->command();
      vehicle.passenger_service = vehicle.depot_command.passenger_service;
    }
  }
  std::unordered_map<std::string, tram::HeadwayStatistics> headway_statistics;
  for (const auto& plan : service_plans) {
    headway_statistics.emplace(plan.id, tram::HeadwayStatistics{});
  }
  std::vector<RoadVehicle> cars{
      {"car_ns_1", kCrossingX - 10.0, -155.0, 1.0, 6.5},
      {"car_ns_2", kCrossingX - 10.0, -215.0, 1.0, 6.5},
      {"car_sn_1", kCrossingX + 10.0, 145.0, -1.0, 6.0},
      {"car_sn_2", kCrossingX + 10.0, 205.0, -1.0, 6.0},
  };

  output << std::fixed << std::setprecision(3)
         << "{\"schemaVersion\":1,\"source\":\"C++ native rail core\","
            "\"junction\":\"KRS-TRIANGLE\",";
  write_network(output, graph, stops, service_plans);
  output << "\"frames\":[";

  bool first_frame = true;
  for (int tick = 0; tick <= 1'200; ++tick) {
    const double time = tick * kStepSeconds;
    std::optional<double> westbound;
    std::optional<double> eastbound;
    bool any_inside = false;
    bool any_cleared = false;

    for (auto& vehicle : trams) {
      if (vehicle.depot_controller.has_value()) {
        const bool at_depot_end =
            vehicle.track.segment_id == "E-depot-in" &&
            vehicle.track.offset_m >=
                graph.segment("E-depot-in").length_m - 0.05 &&
            vehicle.state.speed_mps < 0.05;
        vehicle.depot_command = vehicle.depot_controller->update(
            {time, vehicle.track.segment_id == "E0", at_depot_end,
             vehicle.stop_command.event == "departed"});
        vehicle.passenger_service = vehicle.depot_command.passenger_service;
        if (vehicle.depot_controller->state() == tram::DepotState::inbound) {
          vehicle.choices["KRS-DEPOT-E"] = tram::TurnoutPosition::diverging;
        }
      }
      if (vehicle.track.segment_id.rfind("E", 0) == 0) vehicle.eastbound = true;
      if (vehicle.track.segment_id.rfind("W", 0) == 0) vehicle.eastbound = false;
      const auto distance = approach_distance(graph, vehicle, time);
      if (distance.has_value()) {
        auto& target = vehicle.eastbound ? westbound : eastbound;
        if (!target.has_value() || distance.value() < target.value()) {
          target = distance;
        }
      }
      const bool inside = inside_conflict(graph, vehicle, time);
      any_inside = any_inside || inside;
      any_cleared = any_cleared || (vehicle.was_inside && !inside);
    }

    const auto command = controller.update(
        {time, westbound, eastbound, any_inside, any_cleared});
    const auto original_trams = trams;
    std::vector<tram::TrackPosition> original_positions;
    for (const auto& vehicle : trams) {
      if (is_on_network(vehicle, time)) original_positions.push_back(vehicle.track);
    }

    for (auto& vehicle : trams) {
      if (!is_on_network(vehicle, time)) {
        vehicle.state = {0.0, 0.0};
        continue;
      }
      const bool inside_before_move = inside_conflict(graph, vehicle, time);
      std::vector<tram::TrackPosition> other_positions;
      for (const auto& position : original_positions) {
        if (position.segment_id == vehicle.track.segment_id &&
            std::abs(position.offset_m - vehicle.track.offset_m) < 1e-9) {
          continue;
        }
        other_positions.push_back(position);
      }
      double target_speed = signal_limited_speed(
          graph, vehicle, time, command.tram_allowed);
      if (vehicle.passenger_service) {
        vehicle.service_command = vehicle.service_controller.update(
            {time, same_service_gap(graph, vehicle, original_trams, time)});
        target_speed =
            std::min(target_speed, vehicle.service_command.target_speed_mps);
      } else {
        vehicle.service_command = {true, 9.0, tram::RegulationState::on_time};
        target_speed = std::min(target_speed, 9.0);
      }
      target_speed = leader_limited_speed(graph, vehicle, other_positions,
                                          target_speed);
      if (vehicle.passenger_service) {
        vehicle.stop_command = vehicle.stop_controller.update(
            {distance_to_stop(graph, vehicle), vehicle.state.speed_mps,
             kStepSeconds, target_speed, true});
        target_speed =
            std::min(target_speed, vehicle.stop_command.target_speed_mps);
        if (vehicle.stop_command.event == "departed") {
          headway_statistics.at(vehicle.service_group).record_departure(time);
        }
      } else {
        vehicle.stop_command = {target_speed,
                                std::numeric_limits<double>::infinity(), false,
                                tram::StopServiceState::skipped, std::nullopt};
      }
      double depot_distance = std::numeric_limits<double>::infinity();
      if (vehicle.depot_controller.has_value() &&
          vehicle.depot_controller->state() == tram::DepotState::inbound) {
        depot_distance = distance_to_depot(graph, vehicle);
        if (depot_distance < 55.0) {
          target_speed = std::min(
              target_speed, std::sqrt(std::max(0.0, 1.4 * depot_distance)));
        }
      }
      const auto step = tram::integrate_vehicle_dynamics(
          vehicle.state, tram::VehicleCommand{target_speed, false, 0.0},
          kStepSeconds);
      const double allowed_distance = graph.safe_advance_distance(
          vehicle.track, other_positions, step.distance_m, kSafetyGap,
          vehicle.choices);
      const double stop_limited_distance =
          std::min({allowed_distance, vehicle.stop_command.max_advance_m,
                    depot_distance});
      const double previous_speed = vehicle.state.speed_mps;
      const double next_speed = stop_limited_distance + 1e-9 < step.distance_m
                                    ? stop_limited_distance / kStepSeconds
                                    : step.speed_mps;
      vehicle.state =
          {next_speed, (next_speed - previous_speed) / kStepSeconds};
      vehicle.track =
          graph.advance(vehicle.track, stop_limited_distance, vehicle.choices);
      vehicle.was_inside = inside_before_move;
    }
    for (auto& vehicle : cars) {
      update_road_vehicle(vehicle, command.road_allowed);
    }

    if (tick % 2 != 0) continue;
    if (!first_frame) output << ',';
    first_frame = false;
    output << "{\"time\":" << time << ",\"signal\":\""
           << command.signal_state << "\",";
    write_service_statistics(output, service_plans, trams,
                             headway_statistics, time);
    write_depot_statistics(output, trams, time);
    output << "\"vehicles\":[";
    bool first_vehicle = true;
    for (const auto& vehicle : trams) {
      if (!is_active(vehicle, time)) continue;
      if (!first_vehicle) output << ',';
      first_vehicle = false;
      const auto point = graph.point_at(vehicle.track);
      const auto depot_state = vehicle.depot_controller.has_value()
                                   ? tram::depot_state_name(
                                         vehicle.depot_controller->state())
                                   : "passenger_service";
      const auto destination = vehicle.depot_controller.has_value()
                                   ? vehicle.depot_command.destination
                                   : vehicle.route;
      const auto depot_id = vehicle.depot_controller.has_value()
                                ? vehicle.depot_controller->assignment().depot_id
                                : "";
      write_vehicle(output, vehicle.id, vehicle.route, vehicle.service_group,
                    point.x, point.y,
                    graph.heading_degrees(vehicle.track),
                    vehicle.state.speed_mps, vehicle.track.segment_id,
                    tram::stop_service_state_name(vehicle.stop_controller.state()),
                    vehicle.stop_command.doors_open,
                    vehicle.stop_controller.definition().id,
                    tram::regulation_state_name(vehicle.service_command.state),
                    vehicle.starts_at, depot_state, destination,
                    vehicle.passenger_service, depot_id);
    }
    for (const auto& vehicle : cars) {
      if (!first_vehicle) output << ',';
      first_vehicle = false;
      write_vehicle(output, vehicle.id, "road", "road", vehicle.x, vehicle.y,
                    vehicle.direction > 0.0 ? 180.0 : 0.0,
                    vehicle.speed_mps,
                    vehicle.direction > 0.0 ? "road-north-south"
                                            : "road-south-north",
                    "moving", false, "", "none", 0.0);
    }
    output << "]}";
  }
  output << "]}\n";
  std::cout << "C++ rail-network replay written to " << output_path << '\n';
}

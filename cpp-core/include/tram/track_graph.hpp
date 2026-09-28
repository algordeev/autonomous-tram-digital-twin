#pragma once

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace tram {

struct TrackPoint {
  double x = 0.0;
  double y = 0.0;
};

struct TrackSegment {
  std::string id;
  std::string from_node;
  std::string to_node;
  std::vector<TrackPoint> geometry;
  double length_m = 0.0;
};

enum class TurnoutPosition {
  straight,
  diverging,
};

struct Turnout {
  std::string id;
  std::string node_id;
  std::string straight_segment_id;
  std::string diverging_segment_id;
  TurnoutPosition position = TurnoutPosition::straight;
};

struct TrackPosition {
  std::string segment_id;
  double offset_m = 0.0;
};

using RouteChoices = std::unordered_map<std::string, TurnoutPosition>;

class TrackGraph {
 public:
  void add_segment(std::string id,
                   std::string from_node,
                   std::string to_node,
                   std::vector<TrackPoint> geometry);
  void add_turnout(std::string id,
                   std::string node_id,
                   std::string straight_segment_id,
                   std::string diverging_segment_id,
                   TurnoutPosition initial = TurnoutPosition::straight);
  void set_turnout(const std::string& id, TurnoutPosition position);

  const TrackSegment& segment(const std::string& id) const;
  const std::vector<TrackSegment>& segments() const;
  const std::vector<Turnout>& turnouts() const;
  std::optional<std::string> next_segment(
      const std::string& current_segment_id,
      const RouteChoices& choices = {}) const;

  TrackPosition advance(const TrackPosition& position,
                        double distance_m,
                        const RouteChoices& choices = {}) const;
  TrackPoint point_at(const TrackPosition& position) const;
  double heading_degrees(const TrackPosition& position) const;
  std::optional<double> distance_ahead(
      const TrackPosition& follower,
      const TrackPosition& leader,
      const RouteChoices& follower_choices = {}) const;
  double safe_advance_distance(
      const TrackPosition& follower,
      const std::vector<TrackPosition>& other_trams,
      double requested_distance_m,
      double safety_gap_m,
      const RouteChoices& follower_choices = {}) const;

 private:
  const Turnout* turnout_at(const std::string& node_id) const;

  std::vector<TrackSegment> segments_;
  std::vector<Turnout> turnouts_;
  std::unordered_map<std::string, std::size_t> segment_index_;
  std::unordered_map<std::string, std::size_t> turnout_index_;
  std::unordered_map<std::string, std::vector<std::string>> outgoing_;
};

const char* turnout_position_name(TurnoutPosition position);

}  // namespace tram

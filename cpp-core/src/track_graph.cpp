#include "tram/track_graph.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <unordered_set>

namespace tram {
namespace {

constexpr double kEpsilon = 1e-9;

double point_distance(const TrackPoint& first, const TrackPoint& second) {
  return std::hypot(second.x - first.x, second.y - first.y);
}

double geometry_length(const std::vector<TrackPoint>& geometry) {
  double length = 0.0;
  for (std::size_t index = 1; index < geometry.size(); ++index) {
    length += point_distance(geometry[index - 1], geometry[index]);
  }
  return length;
}

}  // namespace

void TrackGraph::add_segment(std::string id,
                             std::string from_node,
                             std::string to_node,
                             std::vector<TrackPoint> geometry) {
  if (id.empty() || segment_index_.count(id) != 0) {
    throw std::invalid_argument("track segment id must be unique");
  }
  if (geometry.size() < 2) {
    throw std::invalid_argument("track segment needs at least two points");
  }
  const double length = geometry_length(geometry);
  if (!(length > 0.0)) {
    throw std::invalid_argument("track segment length must be positive");
  }
  const std::string segment_id = id;
  const std::string origin = from_node;
  segment_index_[segment_id] = segments_.size();
  segments_.push_back({std::move(id), std::move(from_node),
                       std::move(to_node), std::move(geometry), length});
  outgoing_[origin].push_back(segment_id);
}

void TrackGraph::add_turnout(std::string id,
                             std::string node_id,
                             std::string straight_segment_id,
                             std::string diverging_segment_id,
                             TurnoutPosition initial) {
  if (id.empty() || turnout_index_.count(id) != 0) {
    throw std::invalid_argument("turnout id must be unique");
  }
  const auto outgoing = outgoing_.find(node_id);
  if (outgoing == outgoing_.end() ||
      std::find(outgoing->second.begin(), outgoing->second.end(),
                straight_segment_id) == outgoing->second.end() ||
      std::find(outgoing->second.begin(), outgoing->second.end(),
                diverging_segment_id) == outgoing->second.end()) {
    throw std::invalid_argument("turnout branches must leave the turnout node");
  }
  turnout_index_[id] = turnouts_.size();
  turnouts_.push_back({std::move(id), std::move(node_id),
                       std::move(straight_segment_id),
                       std::move(diverging_segment_id), initial});
}

void TrackGraph::set_turnout(const std::string& id, TurnoutPosition position) {
  const auto found = turnout_index_.find(id);
  if (found == turnout_index_.end()) {
    throw std::out_of_range("unknown turnout: " + id);
  }
  turnouts_[found->second].position = position;
}

const TrackSegment& TrackGraph::segment(const std::string& id) const {
  const auto found = segment_index_.find(id);
  if (found == segment_index_.end()) {
    throw std::out_of_range("unknown track segment: " + id);
  }
  return segments_[found->second];
}

const std::vector<TrackSegment>& TrackGraph::segments() const {
  return segments_;
}

const std::vector<Turnout>& TrackGraph::turnouts() const { return turnouts_; }

const Turnout* TrackGraph::turnout_at(const std::string& node_id) const {
  const auto found = std::find_if(
      turnouts_.begin(), turnouts_.end(),
      [&node_id](const Turnout& turnout) { return turnout.node_id == node_id; });
  return found == turnouts_.end() ? nullptr : &*found;
}

std::optional<std::string> TrackGraph::next_segment(
    const std::string& current_segment_id,
    const RouteChoices& choices) const {
  const auto& current = segment(current_segment_id);
  const auto outgoing = outgoing_.find(current.to_node);
  if (outgoing == outgoing_.end() || outgoing->second.empty()) {
    return std::nullopt;
  }
  if (const auto* turnout = turnout_at(current.to_node)) {
    const auto choice = choices.find(turnout->id);
    const auto position =
        choice == choices.end() ? turnout->position : choice->second;
    return position == TurnoutPosition::straight
               ? turnout->straight_segment_id
               : turnout->diverging_segment_id;
  }
  return outgoing->second.front();
}

TrackPosition TrackGraph::advance(const TrackPosition& position,
                                  double distance_m,
                                  const RouteChoices& choices) const {
  TrackPosition result = position;
  result.offset_m = std::clamp(result.offset_m, 0.0,
                               segment(result.segment_id).length_m);
  double remaining = std::max(0.0, distance_m);
  std::size_t hops = 0;
  while (remaining > kEpsilon) {
    const auto& current = segment(result.segment_id);
    const double available = current.length_m - result.offset_m;
    if (remaining <= available + kEpsilon) {
      result.offset_m = std::min(current.length_m,
                                 result.offset_m + remaining);
      break;
    }
    remaining -= available;
    const auto next = next_segment(result.segment_id, choices);
    if (!next.has_value() || ++hops > segments_.size() + 1) {
      result.offset_m = current.length_m;
      break;
    }
    result.segment_id = next.value();
    result.offset_m = 0.0;
  }
  return result;
}

TrackPoint TrackGraph::point_at(const TrackPosition& position) const {
  const auto& track = segment(position.segment_id);
  double remaining = std::clamp(position.offset_m, 0.0, track.length_m);
  for (std::size_t index = 1; index < track.geometry.size(); ++index) {
    const auto& start = track.geometry[index - 1];
    const auto& end = track.geometry[index];
    const double part = point_distance(start, end);
    if (remaining <= part || index + 1 == track.geometry.size()) {
      const double ratio = part > 0.0 ? std::clamp(remaining / part, 0.0, 1.0)
                                      : 0.0;
      return {start.x + (end.x - start.x) * ratio,
              start.y + (end.y - start.y) * ratio};
    }
    remaining -= part;
  }
  return track.geometry.back();
}

double TrackGraph::heading_degrees(const TrackPosition& position) const {
  const auto& track = segment(position.segment_id);
  double remaining = std::clamp(position.offset_m, 0.0, track.length_m);
  for (std::size_t index = 1; index < track.geometry.size(); ++index) {
    const auto& start = track.geometry[index - 1];
    const auto& end = track.geometry[index];
    const double part = point_distance(start, end);
    if (remaining <= part || index + 1 == track.geometry.size()) {
      constexpr double kPi = 3.14159265358979323846;
      return 90.0 - std::atan2(end.y - start.y, end.x - start.x) *
                        180.0 / kPi;
    }
    remaining -= part;
  }
  return 90.0;
}

std::optional<double> TrackGraph::distance_ahead(
    const TrackPosition& follower,
    const TrackPosition& leader,
    const RouteChoices& follower_choices) const {
  const auto& follower_segment = segment(follower.segment_id);
  if (follower.segment_id == leader.segment_id &&
      leader.offset_m + kEpsilon >= follower.offset_m) {
    return std::max(0.0, leader.offset_m - follower.offset_m);
  }

  double distance = follower_segment.length_m - follower.offset_m;
  std::string current = follower.segment_id;
  std::unordered_set<std::string> visited;
  visited.insert(current);
  for (std::size_t hop = 0; hop <= segments_.size(); ++hop) {
    const auto next = next_segment(current, follower_choices);
    if (!next.has_value()) return std::nullopt;
    if (next.value() == leader.segment_id) {
      return distance + std::clamp(
                            leader.offset_m, 0.0,
                            segment(leader.segment_id).length_m);
    }
    if (!visited.insert(next.value()).second) return std::nullopt;
    distance += segment(next.value()).length_m;
    current = next.value();
  }
  return std::nullopt;
}

double TrackGraph::safe_advance_distance(
    const TrackPosition& follower,
    const std::vector<TrackPosition>& other_trams,
    double requested_distance_m,
    double safety_gap_m,
    const RouteChoices& follower_choices) const {
  double allowed = std::max(0.0, requested_distance_m);
  for (const auto& other : other_trams) {
    if (other.segment_id == follower.segment_id &&
        std::abs(other.offset_m - follower.offset_m) <= kEpsilon) {
      continue;
    }
    const auto distance = distance_ahead(follower, other, follower_choices);
    if (!distance.has_value()) continue;
    allowed = std::min(allowed,
                       std::max(0.0, distance.value() - safety_gap_m));
  }
  return allowed;
}

const char* turnout_position_name(TurnoutPosition position) {
  return position == TurnoutPosition::straight ? "straight" : "diverging";
}

}  // namespace tram

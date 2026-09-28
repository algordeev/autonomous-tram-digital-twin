#include "tram/track_graph.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

namespace {

tram::TrackGraph make_triangle() {
  tram::TrackGraph graph;
  graph.add_segment("approach", "west", "switch", {{0, 0}, {100, 0}});
  graph.add_segment("straight", "switch", "merge", {{100, 0}, {200, 0}});
  graph.add_segment("branch", "switch", "merge",
                    {{100, 0}, {145, 50}, {200, 0}});
  graph.add_segment("exit", "merge", "east", {{200, 0}, {300, 0}});
  graph.add_turnout("SW-1", "switch", "straight", "branch");
  return graph;
}

void test_turnout_selects_both_real_paths() {
  auto graph = make_triangle();
  const tram::TrackPosition start{"approach", 95.0};
  const auto straight = graph.advance(start, 20.0);
  assert(straight.segment_id == "straight");
  assert(std::abs(straight.offset_m - 15.0) < 1e-9);

  tram::RouteChoices branch_choice{{"SW-1", tram::TurnoutPosition::diverging}};
  const auto branch = graph.advance(start, 20.0, branch_choice);
  assert(branch.segment_id == "branch");
  assert(std::abs(branch.offset_m - 15.0) < 1e-9);
  assert(graph.point_at(graph.advance(start, 55.0, branch_choice)).y > 20.0);
}

void test_diverged_tram_is_not_a_false_leader() {
  const auto graph = make_triangle();
  const tram::TrackPosition follower{"approach", 90.0};
  const tram::TrackPosition branch_leader{"branch", 30.0};
  const tram::TrackPosition straight_leader{"straight", 45.0};
  tram::RouteChoices straight_choice{{"SW-1", tram::TurnoutPosition::straight}};
  assert(!graph.distance_ahead(follower, branch_leader, straight_choice).has_value());
  assert(std::abs(graph.distance_ahead(follower, straight_leader, straight_choice).value() -
                  55.0) < 1e-9);
}

void test_safety_gap_prevents_overtaking_across_segments() {
  const auto graph = make_triangle();
  const tram::TrackPosition follower{"approach", 80.0};
  const tram::TrackPosition leader{"straight", 25.0};
  tram::RouteChoices straight_choice{{"SW-1", tram::TurnoutPosition::straight}};
  const double allowed = graph.safe_advance_distance(
      follower, {leader}, 50.0, 30.0, straight_choice);
  assert(std::abs(allowed - 15.0) < 1e-9);
  const auto next = graph.advance(follower, allowed, straight_choice);
  assert(next.segment_id == "approach");
  assert(std::abs(next.offset_m - 95.0) < 1e-9);
}

}  // namespace

int main() {
  test_turnout_selects_both_real_paths();
  test_diverged_tram_is_not_a_false_leader();
  test_safety_gap_prevents_overtaking_across_segments();
  std::cout << "track_graph_test: all checks passed\n";
}

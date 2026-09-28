#include "tram/depot_controller.hpp"

#include <utility>

namespace tram {

DepotController::DepotController(DepotAssignment assignment)
    : assignment_(std::move(assignment)),
      state_(assignment_.starts_in_depot ? DepotState::in_depot
                                        : DepotState::passenger_service),
      dispatched_once_(!assignment_.starts_in_depot) {}

DepotCommand DepotController::update(const DepotInput& input) {
  std::optional<std::string> event;
  if (state_ == DepotState::in_depot && !dispatched_once_ &&
      input.simulation_time_seconds >= assignment_.dispatch_time_seconds) {
    state_ = DepotState::outbound;
    dispatched_once_ = true;
    event = "dispatched_from_depot";
  } else if (state_ == DepotState::outbound && input.reached_line) {
    state_ = DepotState::passenger_service;
    event = "entered_passenger_service";
  } else if (state_ == DepotState::passenger_service &&
             input.simulation_time_seconds >=
                 assignment_.withdrawal_request_seconds &&
             input.at_service_boundary) {
    state_ = DepotState::inbound;
    event = "withdrawal_started";
  } else if (state_ == DepotState::inbound && input.reached_depot) {
    state_ = DepotState::in_depot;
    event = "returned_to_depot";
  }
  auto result = command();
  result.event = std::move(event);
  return result;
}

DepotCommand DepotController::command() const {
  DepotCommand result;
  result.state = state_;
  result.passenger_service = state_ == DepotState::passenger_service;
  result.movement_allowed = state_ != DepotState::in_depot;
  switch (state_) {
    case DepotState::in_depot:
      result.destination = "IN DEPOT";
      break;
    case DepotState::outbound:
      result.destination = "TO LINE";
      break;
    case DepotState::passenger_service:
      result.destination = assignment_.service_destination;
      break;
    case DepotState::inbound:
      result.destination = "TO DEPOT · via " + assignment_.final_passenger_stop;
      break;
  }
  return result;
}

const DepotAssignment& DepotController::assignment() const {
  return assignment_;
}

DepotState DepotController::state() const { return state_; }

const char* depot_state_name(DepotState state) {
  switch (state) {
    case DepotState::in_depot:
      return "in_depot";
    case DepotState::outbound:
      return "outbound";
    case DepotState::passenger_service:
      return "passenger_service";
    case DepotState::inbound:
      return "inbound";
  }
  return "passenger_service";
}

}  // namespace tram

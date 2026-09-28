#pragma once

#include <optional>
#include <string>

namespace tram {

enum class DepotState {
  in_depot,
  outbound,
  passenger_service,
  inbound,
};

struct DepotAssignment {
  std::string depot_id;
  std::string service_destination;
  std::string final_passenger_stop;
  double dispatch_time_seconds = 0.0;
  double withdrawal_request_seconds = 1.0e12;
  bool starts_in_depot = false;
};

struct DepotInput {
  double simulation_time_seconds = 0.0;
  bool reached_line = false;
  bool reached_depot = false;
  bool at_service_boundary = false;
};

struct DepotCommand {
  DepotState state = DepotState::passenger_service;
  bool passenger_service = true;
  bool movement_allowed = true;
  std::string destination;
  std::optional<std::string> event;
};

class DepotController {
 public:
  explicit DepotController(DepotAssignment assignment);

  DepotCommand update(const DepotInput& input);
  DepotCommand command() const;
  const DepotAssignment& assignment() const;
  DepotState state() const;

 private:
  DepotAssignment assignment_;
  DepotState state_ = DepotState::passenger_service;
  bool dispatched_once_ = false;
};

const char* depot_state_name(DepotState state);

}  // namespace tram

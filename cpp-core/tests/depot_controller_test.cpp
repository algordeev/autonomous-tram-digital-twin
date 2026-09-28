#include "tram/depot_controller.hpp"

#include <cassert>
#include <iostream>

int main() {
  tram::DepotController spare{{"DEPOT-1", "2 · clockwise",
                               "Krasnoselskaya", 30.0, 90.0, true}};
  auto command = spare.update({29.9, false, false, false});
  assert(command.state == tram::DepotState::in_depot);
  assert(!command.movement_allowed);
  assert(!command.passenger_service);

  command = spare.update({30.0, false, false, false});
  assert(command.state == tram::DepotState::outbound);
  assert(command.event == "dispatched_from_depot");
  assert(command.movement_allowed);
  assert(!command.passenger_service);

  command = spare.update({45.0, true, false, false});
  assert(command.state == tram::DepotState::passenger_service);
  assert(command.event == "entered_passenger_service");
  assert(command.passenger_service);

  command = spare.update({95.0, false, false, false});
  assert(command.state == tram::DepotState::passenger_service);
  command = spare.update({95.1, false, false, true});
  assert(command.state == tram::DepotState::inbound);
  assert(command.event == "withdrawal_started");
  assert(!command.passenger_service);
  assert(command.destination.find("Krasnoselskaya") != std::string::npos);

  command = spare.update({120.0, false, true, false});
  assert(command.state == tram::DepotState::in_depot);
  assert(command.event == "returned_to_depot");
  command = spare.update({121.0, false, true, false});
  assert(command.state == tram::DepotState::in_depot);
  assert(!command.event.has_value());

  tram::DepotController line_tram{{"DEPOT-1", "21 · Chyorny Prud",
                                   "Krasnoselskaya", 0.0, 10.0, false}};
  command = line_tram.update({10.0, false, false, false});
  assert(command.state == tram::DepotState::passenger_service);
  command = line_tram.update({10.1, false, false, true});
  assert(command.state == tram::DepotState::inbound);

  std::cout << "depot_controller_test: OK\n";
}

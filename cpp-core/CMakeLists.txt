cmake_minimum_required(VERSION 3.20)
project(autonomous_tram_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(tram_core
  src/core_c_api.cpp
  src/depot_controller.cpp
  src/priority_controller.cpp
  src/service_controller.cpp
  src/simulation_core.cpp
  src/stop_controller.cpp
  src/track_graph.cpp
  src/vehicle_dynamics.cpp
)
target_include_directories(tram_core PUBLIC include)
target_compile_options(tram_core PRIVATE -Wall -Wextra -Wpedantic)

add_executable(priority_controller_test tests/priority_controller_test.cpp)
target_link_libraries(priority_controller_test PRIVATE tram_core)

add_executable(vehicle_dynamics_test tests/vehicle_dynamics_test.cpp)
target_link_libraries(vehicle_dynamics_test PRIVATE tram_core)

add_executable(track_graph_test tests/track_graph_test.cpp)
target_link_libraries(track_graph_test PRIVATE tram_core)

add_executable(stop_controller_test tests/stop_controller_test.cpp)
target_link_libraries(stop_controller_test PRIVATE tram_core)

add_executable(service_controller_test tests/service_controller_test.cpp)
target_link_libraries(service_controller_test PRIVATE tram_core)

add_executable(depot_controller_test tests/depot_controller_test.cpp)
target_link_libraries(depot_controller_test PRIVATE tram_core)

add_executable(core_c_api_test tests/core_c_api_test.cpp)
target_link_libraries(core_c_api_test PRIVATE tram_core)

add_executable(native_runner src/native_runner.cpp)
target_link_libraries(native_runner PRIVATE tram_core)

enable_testing()
add_test(NAME core_c_api COMMAND core_c_api_test)
add_test(NAME depot_controller COMMAND depot_controller_test)
add_test(NAME priority_controller COMMAND priority_controller_test)
add_test(NAME service_controller COMMAND service_controller_test)
add_test(NAME stop_controller COMMAND stop_controller_test)
add_test(NAME track_graph COMMAND track_graph_test)
add_test(NAME vehicle_dynamics COMMAND vehicle_dynamics_test)

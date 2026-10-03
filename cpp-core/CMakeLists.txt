cmake_minimum_required(VERSION 3.20)
project(autonomous_tram_core LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
find_program(NODE_EXECUTABLE node REQUIRED)
add_library(tram_core src/operational_core.cpp)
target_include_directories(tram_core PUBLIC include)
target_compile_options(tram_core PRIVATE -Wall -Wextra -Wpedantic)
add_executable(operational_core_test tests/operational_core_test.cpp)
target_link_libraries(operational_core_test PRIVATE tram_core)
# Keep assertions enabled in Release builds too.
target_compile_options(operational_core_test PRIVATE -UNDEBUG)
add_custom_command(OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/native_bridge.cpp
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-native-bridge.mjs ${CMAKE_CURRENT_BINARY_DIR}/native_bridge.cpp
  DEPENDS include/tram/core_c_api.h scripts/generate-native-bridge.mjs scripts/core-abi.mjs)
add_executable(native_bridge ${CMAKE_CURRENT_BINARY_DIR}/native_bridge.cpp)
target_link_libraries(native_bridge PRIVATE tram_core)
enable_testing()
add_test(NAME operational_core COMMAND operational_core_test)
add_test(NAME native_wasm_parity COMMAND ${CMAKE_COMMAND} -E env TRAM_NATIVE_BRIDGE=$<TARGET_FILE:native_bridge>
  ${NODE_EXECUTABLE} --test ${CMAKE_CURRENT_SOURCE_DIR}/../tests/wasm-core.test.mjs)

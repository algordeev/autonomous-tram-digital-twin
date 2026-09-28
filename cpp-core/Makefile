CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic
BUILD_DIR := build
INCLUDES := -Iinclude

.PHONY: all test clean

CORE_SOURCES := src/core_c_api.cpp src/depot_controller.cpp src/priority_controller.cpp src/service_controller.cpp src/simulation_core.cpp src/stop_controller.cpp src/track_graph.cpp src/vehicle_dynamics.cpp

all: $(BUILD_DIR)/core_c_api_test $(BUILD_DIR)/depot_controller_test $(BUILD_DIR)/priority_controller_test $(BUILD_DIR)/service_controller_test $(BUILD_DIR)/stop_controller_test $(BUILD_DIR)/track_graph_test $(BUILD_DIR)/vehicle_dynamics_test $(BUILD_DIR)/native_runner

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/priority_controller_test: $(CORE_SOURCES) tests/priority_controller_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/vehicle_dynamics_test: $(CORE_SOURCES) tests/vehicle_dynamics_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/track_graph_test: $(CORE_SOURCES) tests/track_graph_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/stop_controller_test: $(CORE_SOURCES) tests/stop_controller_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/service_controller_test: $(CORE_SOURCES) tests/service_controller_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/depot_controller_test: $(CORE_SOURCES) tests/depot_controller_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/core_c_api_test: $(CORE_SOURCES) tests/core_c_api_test.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

$(BUILD_DIR)/native_runner: $(CORE_SOURCES) src/native_runner.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

test: $(BUILD_DIR)/core_c_api_test $(BUILD_DIR)/depot_controller_test $(BUILD_DIR)/priority_controller_test $(BUILD_DIR)/service_controller_test $(BUILD_DIR)/stop_controller_test $(BUILD_DIR)/track_graph_test $(BUILD_DIR)/vehicle_dynamics_test
	./$(BUILD_DIR)/core_c_api_test
	./$(BUILD_DIR)/depot_controller_test
	./$(BUILD_DIR)/priority_controller_test
	./$(BUILD_DIR)/service_controller_test
	./$(BUILD_DIR)/stop_controller_test
	./$(BUILD_DIR)/track_graph_test
	./$(BUILD_DIR)/vehicle_dynamics_test

clean:
	rm -rf $(BUILD_DIR)

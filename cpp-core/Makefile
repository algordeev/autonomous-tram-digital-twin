CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic
BUILD_DIR := build
INCLUDES := -Iinclude
CORE_SOURCE := src/operational_core.cpp
HEADERS := include/tram/core_c_api.h include/tram/control_parameters.hpp

.PHONY: all test clean wasm verify-wasm
all: $(BUILD_DIR)/operational_core_test $(BUILD_DIR)/native_bridge

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/native_bridge.cpp: $(HEADERS) scripts/generate-native-bridge.mjs scripts/core-abi.mjs | $(BUILD_DIR)
	node scripts/generate-native-bridge.mjs

$(BUILD_DIR)/native_bridge: $(CORE_SOURCE) $(BUILD_DIR)/native_bridge.cpp $(HEADERS)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(CORE_SOURCE) $(BUILD_DIR)/native_bridge.cpp -o $@

$(BUILD_DIR)/operational_core_test: $(CORE_SOURCE) tests/operational_core_test.cpp $(HEADERS) | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -UNDEBUG $(CORE_SOURCE) tests/operational_core_test.cpp -o $@

test: all
	./$(BUILD_DIR)/operational_core_test
	TRAM_NATIVE_BRIDGE=$(CURDIR)/$(BUILD_DIR)/native_bridge node --test ../tests/wasm-core.test.mjs

wasm:
	node scripts/compile-portable-wasm.mjs

verify-wasm:
	node scripts/compile-portable-wasm.mjs --check

clean:
	rm -rf $(BUILD_DIR)

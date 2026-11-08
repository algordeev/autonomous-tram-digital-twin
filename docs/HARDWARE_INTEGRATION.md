# Hardware Integration

## Goal

The web simulator should become a hardware-in-the-loop testbed without moving
network-wide logic onto a small microcontroller. The C++ authority provides the
shared behavioural boundary; adapters translate physical observations and
commands.

## Proposed split

| Component | Hardware | Responsibility |
| --- | --- | --- |
| Tram controller | ESP32 on each scale tram | RFID, odometry, distance sensing, door inputs, motor PWM and local fail-safe stop |
| Wayside controllers | ESP32 per turnout, signal or section | Turnout position, signal aspects, section occupancy and local interlocking |
| Edge computer | Raspberry Pi | Shared C++ authority, network graph, dispatch, optimiser, passenger model, logs and experiment control |
| Browser UI | Any computer | Observation, scenario setup and operator commands |
| MATLAB/Simulink | Workstation | Parameter identification and reference-model validation |

## Observation interface

A future adapter should timestamp and normalize:

- RFID or beacon identifier;
- wheel odometry and estimated speed;
- obstacle distance and confidence;
- door closed/obstruction state;
- traction and braking command feedback;
- current, voltage and calculated power;
- turnout/signal acknowledgement;
- communication health.

## Command interface

The authority may request:

- target speed or normalized traction/braking demand;
- emergency stop;
- door open/close enable;
- turnout route request;
- signal priority request;
- depot or passenger-service state.

Physical hardware must independently reject unsafe commands. Loss of host
communication must lead to a defined safe state.

## Suggested transport

Between the Raspberry Pi and the ESP32 controllers, a USB serial link with
framed JSON or compact binary messages is sufficient for the existing
prototype. Each message should include schema version, device ID,
sequence number, timestamp and checksum. Web Serial can support demonstrations;
a native gateway is preferable for repeatable research logging.

## Hardware-in-the-loop stages

1. Replay recorded sensor logs through the C++ authority.
2. Connect one physical tram while infrastructure remains simulated.
3. Connect physical readers, turnout and signal controllers.
4. Run synchronized physical and virtual vehicles with state comparison.
5. Inject communication loss, stuck sensor, obstacle and turnout faults.

## Success criteria

- The control loop (observation in, authority step, command out) completes in
  less than 50 ms, the core's fixed step, in at least 99% of steps.
- The safety oracle records 0 violations under injected faults.
- An operator reset procedure exists, with a physical reset button.

## Operator reset

Some faults latch until a person has checked the track. An unexpected entry
into a crossing latches all-red, and the core keeps it latched; a manual signal
command cannot clear it. The reset procedure is:

1. The operator inspects the affected crossing or turnout and confirms that it
   is clear and that tram positions match the reported state.
2. The operator presses the physical reset button on the edge computer.
3. The edge computer resets the affected subsystem and logs the reset with a
   timestamp and the latched fault.

The button only acknowledges an inspected fault. It cannot release an occupied
grant or a locked turnout, and the controllers stay in their safe state until
the reset completes.

## Safety disclaimer

The present software is a research prototype. A real tram requires certified
braking, redundant perception, independent interlocking, secure communication
and formal safety assurance. Raspberry Pi, ESP32 and other Arduino-class
hardware are appropriate for a scale model only, not direct full-size vehicle
control.

# Hardware Integration

## Goal

The web simulator should become a hardware-in-the-loop testbed without moving
network-wide logic onto a small microcontroller. The C++ authority provides the
shared behavioural boundary; adapters translate physical observations and
commands.

## Proposed split

| Component | Responsibility |
| --- | --- |
| Tram microcontroller | RFID, odometry, distance sensing, door inputs, motor PWM and local fail-safe stop |
| Wayside controllers | Turnout position, signal aspects, section occupancy and local interlocking |
| Host/edge computer | Network graph, dispatch, passenger model, energy optimization, logs and experiment control |
| Browser UI | Observation, scenario setup and operator commands |
| MATLAB/Simulink | Parameter identification and reference-model validation |

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

For the existing prototype, a USB serial link with framed JSON or compact binary
messages is sufficient. Each message should include schema version, device ID,
sequence number, timestamp and checksum. Web Serial can support demonstrations;
a native gateway is preferable for repeatable research logging.

## Hardware-in-the-loop stages

1. Replay recorded sensor logs through the C++ authority.
2. Connect one physical tram while infrastructure remains simulated.
3. Connect physical readers, turnout and signal controllers.
4. Run synchronized physical and virtual vehicles with state comparison.
5. Inject communication loss, stuck sensor, obstacle and turnout faults.

## Safety disclaimer

The present software is a research prototype. A real tram requires certified
braking, redundant perception, independent interlocking, secure communication
and formal safety assurance. Arduino hardware is appropriate for a scale model,
not direct full-size vehicle control.

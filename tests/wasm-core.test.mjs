import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { abiFunctions, abiVersion } from "../cpp-core/scripts/core-abi.mjs";

// Each test records the WASM calls and replays the exact scenario in one native
// process. Fresh native process = fresh WASM instance, including singleton state.
let traces = [];
test.beforeEach(() => { traces = []; });
test.afterEach(() => {
  if (!process.env.TRAM_NATIVE_BRIDGE) return;
  for (const trace of traces) {
    const input = trace.map(({ name, args }) => `${name} ${args.join(" ")}`).join("\n") + "\n";
    const result = spawnSync(process.env.TRAM_NATIVE_BRIDGE, [], {
      input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error ?? "Native bridge failed"));
    const actual = result.stdout.trim().split("\n").map(Number);
    assert.equal(actual.length, trace.length, "native call count");
    trace.forEach(({ name, expected }, index) => {
      const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
      assert.ok(Number.isFinite(actual[index]) && Math.abs(actual[index] - expected) <= tolerance,
        `native/WASM mismatch at call ${index} ${name}: ${actual[index]} vs ${expected}`);
    });
  }
});
async function loadCore() {
  const bytes = await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url));
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const { exports } = await WebAssembly.instantiate(module, {});
  assert.deepEqual(WebAssembly.Module.exports(module).filter(({ kind }) => kind === "function").map(({ name }) => name).sort(),
    abiFunctions.map(({ name }) => name).sort(), "header and binary export lists must agree");
  const trace = [];
  traces.push(trace);
  const wrapped = Object.fromEntries(abiFunctions.map(({ name, result }) => [name, (...args) => {
    const value = exports[name](...args);
    trace.push({ name, args, expected: result === "void" ? 0 : value });
    return value;
  }]));
  assert.equal(wrapped.tram_core_abi_version(), abiVersion);
  return wrapped;
}
function line(ex,h,r,y){ex.tram_core_route_meta(h,r,r<2?2:21,r%2);ex.tram_core_add_route_point(h,r,0,y);ex.tram_core_add_route_point(h,r,1000,y);ex.tram_core_add_route_point(h,r,0,y);}
test("C++ ABI 12 owns the four-direction 2+21 fleet",async()=>{const ex=await loadCore(),h=ex.tram_core_create();assert.equal(ex.tram_core_begin_network(h,4,10,2),1);for(let r=0;r<4;r++)line(ex,h,r,r*20);const counts=[3,2,3,2];let i=0;counts.forEach((count,r)=>{for(let j=0;j<count;j++)assert.equal(ex.tram_core_configure_tram(h,i++,r,(j+.2)/count),1);});ex.tram_core_set_zone_route(h,0,0,200);ex.tram_core_set_zone_route(h,0,1,200);ex.tram_core_set_zone_route(h,1,2,400);ex.tram_core_set_zone_route(h,1,3,400);for(let tick=0;tick<400;tick++)assert.equal(ex.tram_core_step(h,.05),1);assert.ok(Math.abs(ex.tram_core_time(h)-20)<1e-8);assert.equal(ex.tram_core_tram_count(h),10);for(let t=0;t<10;t++)assert.ok(Number.isFinite(ex.tram_core_vehicle_x_at(h,t)));assert.ok(ex.tram_core_consumed_wh(h)>0);});
test("headway is route-specific and braking regenerates",async()=>{const ex=await loadCore(),h=ex.tram_core_create();ex.tram_core_begin_network(h,2,2,0);line(ex,h,0,0);line(ex,h,1,20);ex.tram_core_configure_tram(h,0,0,.08);ex.tram_core_configure_tram(h,1,1,.08);for(let tick=0;tick<200;tick++)ex.tram_core_step(h,.05);assert.ok(ex.tram_core_vehicle_speed_at(h,0)>0);assert.ok(ex.tram_core_vehicle_speed_at(h,1)>0,"another route must not trigger headway braking");ex.tram_core_set_target_speed(h,0);for(let tick=0;tick<300;tick++)ex.tram_core_step(h,.05);assert.ok(ex.tram_core_regenerated_wh(h)>0);});
test("browser headway helpers execute inside C++ WASM",async()=>{const ex=await loadCore();assert.equal(ex.tram_core_uniform_headway(6000,6,30),1000);assert.equal(ex.tram_core_uniform_headway(100,10,30),30);assert.equal(ex.tram_core_headway_speed_factor(30,30,100),0);assert.equal(ex.tram_core_headway_speed_factor(100,30,100),1);assert.ok(Math.abs(ex.tram_core_headway_speed_factor(65,30,100)-.5)<1e-9);});
test("C++ releases a terminal hold only at the target time interval",async()=>{const ex=await loadCore();assert.equal(ex.tram_core_terminal_interval_hold(899,900),1);assert.equal(ex.tram_core_terminal_interval_hold(900,900),0);assert.equal(ex.tram_core_terminal_interval_hold(920,900),0);});
test("C++ assigns the two Izmir terminal berths and reports capacity",async()=>{const ex=await loadCore();assert.equal(ex.tram_core_terminal_berth(0),1);assert.equal(ex.tram_core_terminal_berth(1),2);assert.equal(ex.tram_core_terminal_berth(3),0);assert.equal(ex.tram_core_parallel_terminal_bypass(1,1),1);assert.equal(ex.tram_core_parallel_terminal_bypass(1,3),0);});
test("C++ assigns unique terminal and depot departure slots",async()=>{const ex=await loadCore();const first=ex.tram_core_departure_slot(7*3600+44*60,7*3600,15*60,-1);assert.equal(first,7*3600+45*60);const second=ex.tram_core_departure_slot(7*3600+44*60,7*3600,15*60,first+15*60);assert.equal(second,8*3600);assert.equal(ex.tram_core_departure_on_time(59,60),1);assert.equal(ex.tram_core_departure_on_time(61,60),0);});
test("C++ WASM is the stateful authority for vehicle dynamics and energy",async()=>{const ex=await loadCore();assert.equal(ex.tram_core_authority_begin(2),1);assert.equal(ex.tram_core_authority_sync(0,0,0,0,0,0,0,0,0,0,0,0),1);for(let tick=0;tick<200;tick++)assert.equal(ex.tram_core_authority_step(0,11.1,0,0,0,.05),1);assert.ok(ex.tram_core_authority_speed(0)>0);assert.ok(ex.tram_core_authority_distance(0)>0);assert.ok(ex.tram_core_authority_consumed(0)>0);assert.ok(ex.tram_core_authority_traction_energy(0)>0);ex.tram_core_authority_override_motion(0,0,0);assert.equal(ex.tram_core_authority_speed(0),0);});
test("C++ WASM aligns a smooth stop with the platform",async()=>{const ex=await loadCore();ex.tram_core_authority_begin(1);ex.tram_core_authority_sync(0,8,0,0,0,0,0,0,0,0,0,0);ex.tram_core_station_sync(0,1,0);ex.tram_core_station_step(0,2,0,0);assert.equal(ex.tram_core_station_phase(0),1,"moving tram must remain on approach");assert.ok(ex.tram_core_station_approach_speed(80,15)>0);assert.ok(ex.tram_core_station_approach_speed(.35,15)<.01);for(let tick=0;tick<300;tick++)ex.tram_core_authority_step(0,0,0,0,0,.05);ex.tram_core_station_step(0,20,0,0);assert.equal(ex.tram_core_station_phase(0),1,"doors must stay closed before alignment");ex.tram_core_station_step(0,20,0,1);assert.equal(ex.tram_core_station_phase(0),2);assert.equal(ex.tram_core_station_event(0),1);ex.tram_core_station_step(0,32,0,1);assert.equal(ex.tram_core_station_phase(0),0);assert.equal(ex.tram_core_station_event(0),2);ex.tram_core_signal_begin(1);ex.tram_core_signal_sync(0,2,5,0,0,1,0,0,0,-1,0);ex.tram_core_signal_step(0,19,-1,-1,0,0,1,10,1,20);assert.equal(ex.tram_core_signal_phase(0),2,"green must remain latched while occupied");ex.tram_core_signal_observe(0,0,0,1,20);ex.tram_core_signal_step(0,20,-1,-1,0,0,1,10,1,20);assert.equal(ex.tram_core_signal_phase(0),3,"clearance begins only after the rear clears");});

test("C++ speed profile and passenger mass affect authority",async()=>{const ex=await loadCore();const curve=ex.tram_core_speed_profile_target(40/3.6,30,.65,-1,0,.72);assert.ok(curve>15/3.6&&curve<17/3.6);const approach=ex.tram_core_speed_profile_target(40/3.6,30,.65,-1,80,.72);assert.ok(approach>curve&&approach<=40/3.6);ex.tram_core_authority_begin(2);for(const i of [0,1])ex.tram_core_authority_sync(i,0,0,0,0,0,0,0,0,0,0,0);for(let tick=0;tick<100;tick++){ex.tram_core_authority_step(0,11.1,0,0,0,.05);ex.tram_core_authority_step(1,11.1,0,0,110,.05);}assert.ok(ex.tram_core_authority_speed(0)>ex.tram_core_authority_speed(1),"loaded tram should accelerate more slowly under the same force limits");});
test("C++ predictive eco-driving selects coast and braking envelopes",async()=>{const ex=await loadCore();ex.tram_core_authority_begin(1);ex.tram_core_authority_sync(0,11,0,0,0,0,0,0,0,0,0,0);const far=ex.tram_core_predictive_eco_target(0,1,11,11.1,800,0,0,40,1);assert.equal(ex.tram_core_authority_eco_mode(0),0);assert.equal(far,11.1);const coast=ex.tram_core_predictive_eco_target(0,1,11,11.1,100,0,0,40,1);assert.equal(ex.tram_core_authority_eco_mode(0),1);assert.ok(coast<11);const brake=ex.tram_core_predictive_eco_target(0,1,11,11.1,50,0,0,40,1);assert.equal(ex.tram_core_authority_eco_mode(0),2);assert.ok(brake<11);});
test("C++ eco approach stays latched instead of accelerating before a station",async()=>{const ex=await loadCore();ex.tram_core_authority_begin(1);ex.tram_core_authority_sync(0,11,0,0,0,0,0,0,0,0,0,0);const entry=ex.tram_core_predictive_eco_target(0,1,11,11.1,100,1.5,0,40,1);assert.equal(ex.tram_core_authority_eco_mode(0),1);assert.ok(entry<11);const near=ex.tram_core_predictive_eco_target(0,1,1.8,11.1,60,1.5,0,40,1);assert.equal(ex.tram_core_authority_eco_mode(0),1);assert.ok(near>=1.5);assert.ok(near<2);});
test("C++ WASM owns turnout locks and depot service transitions",async()=>{const ex=await loadCore();ex.tram_core_switch_begin(1);ex.tram_core_switch_sync(0,0,-1);assert.equal(ex.tram_core_switch_request(0,1,3,1),1);assert.equal(ex.tram_core_switch_state(0),1);assert.equal(ex.tram_core_switch_locked_by(0),3);assert.equal(ex.tram_core_switch_request(0,0,4,1),0,"another tram must queue while locked");ex.tram_core_switch_release(0,3);assert.equal(ex.tram_core_switch_locked_by(0),-1);ex.tram_core_authority_begin(1);ex.tram_core_depot_sync(0,0);assert.equal(ex.tram_core_depot_command(0,1),1);assert.equal(ex.tram_core_depot_observe(0,1,0,0,0),2);assert.equal(ex.tram_core_depot_observe(0,0,1,0,0),3);assert.equal(ex.tram_core_depot_command(0,2),4);assert.equal(ex.tram_core_depot_observe(0,0,0,1,1),0);});
test("C++ WASM owns traction-section balancing and peak guidance",async()=>{const ex=await loadCore();assert.equal(ex.tram_core_power_begin(1,2,1),1);ex.tram_core_power_configure_section(0,1000);ex.tram_core_power_sync_vehicle(0,0,10,0,0,0,0);ex.tram_core_power_sync_vehicle(1,0,0,8,6,0,0);assert.equal(ex.tram_core_power_step(.05),1);assert.ok(ex.tram_core_power_section_reused_wh(0)>0);assert.ok(ex.tram_core_power_section_grid_wh(0)>0);assert.ok(ex.tram_core_power_vehicle_accepted(1)>0);ex.tram_core_power_sync_vehicle(0,0,20,0,0,0,0);ex.tram_core_power_sync_vehicle(1,0,0,8,6,ex.tram_core_power_vehicle_accepted(1),ex.tram_core_power_vehicle_rejected(1));ex.tram_core_power_step(.05);const target=ex.tram_core_power_target(0,0,0,1,20,2,12);assert.ok(target<12);assert.equal(ex.tram_core_power_guidance(0),2);assert.equal(ex.tram_core_power_interventions(),1);});
test("VYCON SOC controller keeps 15 percent reserve and shaves only grid peaks",async()=>{const ex=await loadCore();ex.tram_core_power_begin(1,1,1);ex.tram_core_power_configure_section(0,1000);ex.tram_core_power_configure_flywheel(0,2,125,520.833,.95,.95,.35);const initial=ex.tram_core_power_section_flywheel_energy(0);ex.tram_core_power_sync_vehicle(0,0,10,0,0,0,0);ex.tram_core_power_step(.05);assert.ok(ex.tram_core_power_section_flywheel_energy(0)<initial);assert.ok(ex.tram_core_power_section_flywheel_discharge_power(0)>0);assert.equal(ex.tram_core_power_section_flywheel_mode(0),6);for(let step=0;step<500;step++){ex.tram_core_power_sync_vehicle(0,0,20+step*10,0,0,0,0);ex.tram_core_power_step(.05);}const reserve=2*520.833*.15;assert.ok(ex.tram_core_power_section_flywheel_energy(0)>=reserve-1e-6);assert.ok(ex.tram_core_power_section_flywheel_losses_wh(0)>0);});
test("VYCON controller forecasts braking and actively opens headroom above 80 percent",async()=>{const ex=await loadCore();ex.tram_core_power_begin(1,1,1);ex.tram_core_power_configure_section(0,1000);ex.tram_core_power_configure_flywheel(0,2,125,520.833,.95,.95,.85);const initial=ex.tram_core_power_section_flywheel_energy(0);ex.tram_core_power_target(0,0,0,1,0,12,4);ex.tram_core_power_sync_vehicle(0,0,4,0,0,0,0);ex.tram_core_power_step(.05);assert.ok(ex.tram_core_power_section_forecast_regeneration(0)>0);assert.equal(ex.tram_core_power_section_flywheel_target_grid(0),0);assert.ok(ex.tram_core_power_section_flywheel_discharge_power(0)>0);assert.ok(ex.tram_core_power_section_flywheel_energy(0)<initial);assert.equal(ex.tram_core_power_section_flywheel_mode(0),6);});

test("curve envelopes remain accurate across small and large square roots", async () => {
  const ex = await loadCore();
  for (const radius of [1e-12, 30, 1e6, 1e12]) {
    const actual = ex.tram_core_speed_profile_target(1e9, radius, 1, -1, 0, 0);
    assert.ok(Math.abs(actual - Math.sqrt(radius)) <= 1e-12 * Math.max(1, Math.sqrt(radius)));
  }
});

test("station dwell extensions and manual control preserve door state", async () => {
  const ex = await loadCore();
  ex.tram_core_authority_begin(1);
  ex.tram_core_authority_sync(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  ex.tram_core_station_sync(0, 1, 0);
  ex.tram_core_station_step(0, 10, 0, 1);
  assert.equal(ex.tram_core_station_until(0), 22);
  ex.tram_core_station_sync(0, 2, 45); // passenger demand / terminal hold
  ex.tram_core_station_step(0, 30, 0, 1);
  assert.equal(ex.tram_core_station_phase(0), 2);
  ex.tram_core_station_step(0, 50, 1, 1); // manual suppresses automatic release
  assert.equal(ex.tram_core_station_phase(0), 2);
  ex.tram_core_station_step(0, 50, 0, 1);
  assert.equal(ex.tram_core_station_event(0), 2);
});

test("shared conflict zone holds the other route until its owner clears", async () => {
  const ex = await loadCore(), h = ex.tram_core_create();
  ex.tram_core_begin_network(h, 2, 2, 1);
  line(ex, h, 0, 0); line(ex, h, 1, 20);
  ex.tram_core_configure_tram(h, 0, 0, .08);
  ex.tram_core_configure_tram(h, 1, 1, .08);
  ex.tram_core_set_zone_route(h, 0, 0, 200);
  ex.tram_core_set_zone_route(h, 0, 1, 200);
  for (let tick = 0; tick < 200; tick++) ex.tram_core_step(h, .05);
  assert.equal(ex.tram_core_zone_owner(h, 0), 0);
  assert.ok(ex.tram_core_vehicle_speed_at(h, 0) > 0);
  assert.equal(ex.tram_core_vehicle_speed_at(h, 1), 0);
});

function signalStep(ex, now, tram = -1, signal = -1, waiting = 0, invalid = 0) {
  assert.equal(ex.tram_core_signal_step(0, now, tram, signal, waiting, invalid, 1, 3, 1, 8), 1);
}
function initializeSignal(ex) {
  ex.tram_core_signal_begin(1);
  assert.equal(ex.tram_core_signal_sync(0, 0, 0, -1, -1, 0, 0, 0, 0, -1, 0), 1);
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test("live sync cannot replace motion, accumulated energy, grants or switch locks", async () => {
  const ex = await loadCore();
  ex.tram_core_authority_begin(1);
  ex.tram_core_authority_sync(0, 4, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0);
  ex.tram_core_authority_step(0, 11, 0, 0, 0, .05);
  const speed = ex.tram_core_authority_speed(0), energy = ex.tram_core_authority_consumed(0);
  assert.equal(ex.tram_core_authority_sync(0, 20, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0), 0);
  assert.equal(ex.tram_core_authority_speed(0), speed);
  assert.equal(ex.tram_core_authority_consumed(0), energy);
  assert.equal(ex.tram_core_authority_override_motion(0, speed + 1, 0), 0);
  assert.equal(ex.tram_core_authority_override_motion(0, 0, 0), 1);
  initializeSignal(ex);
  signalStep(ex, 0, 0, 0); signalStep(ex, 1);
  assert.equal(ex.tram_core_signal_sync(0, 0, 0, -1, -1, 0, 0, 0, 0, -1, 0), 0);
  assert.equal(ex.tram_core_signal_active_tram(0), 0);
  ex.tram_core_switch_begin(1); ex.tram_core_switch_sync(0, 0, -1);
  ex.tram_core_switch_request(0, 1, 0, 0);
  assert.equal(ex.tram_core_switch_sync(0, 0, -1), 0);
  assert.equal(ex.tram_core_switch_locked_by(0), 0);
});

test("every control mode preserves a turnout lock, including its owner", async () => {
  const ex = await loadCore();
  for (const cooperative of [0, 1]) {
    ex.tram_core_switch_begin(1); ex.tram_core_switch_sync(0, 0, -1);
    assert.equal(ex.tram_core_switch_request(0, 1, 3, cooperative), 1);
    for (const mode of [0, 1]) {
      assert.equal(ex.tram_core_switch_toggle(0, mode), 0);
      assert.equal(ex.tram_core_switch_request(0, 0, 3, mode), 0);
      assert.equal(ex.tram_core_switch_request(0, 1, 4, mode), 0);
      assert.equal(ex.tram_core_switch_request(0, 1, 3, mode), 1);
      ex.tram_core_switch_release(0, 4);
      assert.equal(ex.tram_core_switch_state(0), 1);
      assert.equal(ex.tram_core_switch_locked_by(0), 3);
    }
    ex.tram_core_switch_release(0, 3);
    assert.equal(ex.tram_core_switch_toggle(0, cooperative), 1);
  }
});

test("manual grants drain the old approach and occupied route before clearance", async () => {
  const ex = await loadCore(); initializeSignal(ex);
  signalStep(ex, 0, 0, 0);
  ex.tram_core_signal_manual(0, 1, 1); // adversarial command during amber
  signalStep(ex, 1, 1, 1);
  assert.equal(ex.tram_core_signal_active_tram(0), 0);
  assert.equal(ex.tram_core_signal_active_signal(0), 0);
  ex.tram_core_signal_observe(0, 0, 0, 0, 2);
  signalStep(ex, 3, 1, 1);
  assert.equal(ex.tram_core_signal_active_signal(0), 0);
  assert.equal(ex.tram_core_signal_observe(0, 1, 1, 1, 3), 0, "foreign clear cannot release owner");
  ex.tram_core_signal_observe(0, 0, 0, 1, 4);
  signalStep(ex, 4); assert.equal(ex.tram_core_signal_phase(0), 3);
  signalStep(ex, 4.5); assert.equal(ex.tram_core_signal_phase(0), 3);
  signalStep(ex, 5); signalStep(ex, 5.1);
  assert.equal(ex.tram_core_signal_phase(0), 2);
  assert.equal(ex.tram_core_signal_active_signal(0), 1);
});

test("missing and duplicate clearance detectors fail closed with bounded timeout", async () => {
  const ex = await loadCore(); initializeSignal(ex);
  signalStep(ex, 0, 0, 0); signalStep(ex, 1);
  ex.tram_core_signal_observe(0, 0, 0, 0, 2);
  ex.tram_core_signal_observe(0, 0, 0, 0, 9); // duplicate entry must not restart timer
  ex.tram_core_signal_manual(0, 1, 1);
  signalStep(ex, 10, 1, 1);
  assert.equal(ex.tram_core_signal_fault(0), 1);
  assert.equal(ex.tram_core_signal_phase(0), 4);
  for (let now = 11; now < 100; now++) {
    ex.tram_core_signal_manual(0, now % 3, 1);
    signalStep(ex, now, 1, 1);
    assert.equal(ex.tram_core_signal_phase(0), 4);
    assert.equal(ex.tram_core_signal_active_tram(0), 0);
  }
  assert.equal(ex.tram_core_signal_observe(0, 1, 1, 1, 100), 0);
  signalStep(ex, 100); assert.equal(ex.tram_core_signal_phase(0), 4);
  ex.tram_core_signal_observe(0, 0, 0, 1, 101);
  signalStep(ex, 101); assert.equal(ex.tram_core_signal_phase(0), 3);
  assert.equal(ex.tram_core_signal_fault(0), 0);
});

test("an unexpected entry latches an all-red fault that a normal owner clear cannot erase", async () => {
  const ex = await loadCore(); initializeSignal(ex);
  signalStep(ex, 0, 0, 0); signalStep(ex, 1);
  ex.tram_core_signal_observe(0, 0, 0, 0, 2);
  assert.equal(ex.tram_core_signal_observe(0, 1, 1, 0, 3), 0);
  ex.tram_core_signal_observe(0, 0, 0, 1, 4);
  signalStep(ex, 100, 2, 2);
  assert.equal(ex.tram_core_signal_phase(0), 4);
  assert.equal(ex.tram_core_signal_fault(0), 2);
});

for (let seed = 1; seed <= 24; seed++) {
  test(`randomized interlock invariants and detector faults, seed ${seed}`, async () => {
    const ex = await loadCore(), random = seeded(seed);
    initializeSignal(ex);
    ex.tram_core_switch_begin(1); ex.tram_core_switch_sync(0, 0, -1);
    let occupant = null, enteredAt = 0, suppressClearUntil = 0;
    let entries = 0, faults = 0, grants = 0;
    for (let tick = 0; tick < 1000; tick++) {
      const now = tick * .25;
      const previousOwner = ex.tram_core_switch_locked_by(0), previousState = ex.tram_core_switch_state(0);
      const tram = Math.floor(random() * 4), desired = Math.floor(random() * 2), mode = Math.floor(random() * 2);
      if (random() < .3) ex.tram_core_switch_toggle(0, mode);
      else ex.tram_core_switch_request(0, desired, tram, mode);
      if (previousOwner >= 0) {
        assert.equal(ex.tram_core_switch_state(0), previousState, `locked switch moved: ${seed}/${tick}`);
        assert.equal(ex.tram_core_switch_locked_by(0), previousOwner);
      }
      if (random() < .2) {
        ex.tram_core_switch_release(0, tram);
        if (tram !== previousOwner && previousOwner >= 0) assert.equal(ex.tram_core_switch_locked_by(0), previousOwner);
      }
      if (random() < .12) ex.tram_core_signal_manual(0, Math.floor(random() * 3), Math.floor(random() * 2));
      if (random() < .04) {
        assert.equal(ex.tram_core_signal_sync(0, 0, 0, -1, -1, 0, 0, now, 0, -1, 0), 0);
        assert.equal(ex.tram_core_switch_sync(0, desired, -1), 0);
      }
      const phase = ex.tram_core_signal_phase(0), owner = ex.tram_core_signal_active_tram(0), signal = ex.tram_core_signal_active_signal(0);
      if (!occupant && phase === 2 && !ex.tram_core_signal_cleared(0) && random() < .3) {
        occupant = { tram: owner < 0 ? tram : owner, signal };
        assert.equal(ex.tram_core_signal_observe(0, occupant.tram, signal, 0, now), 1);
        enteredAt = now; entries++;
        suppressClearUntil = now + (random() < .3 ? 12 : 1);
      }
      if (occupant) {
        if (random() < .2) ex.tram_core_signal_observe(0, occupant.tram, occupant.signal, 0, now);
        if (random() < .15) assert.equal(ex.tram_core_signal_observe(0, (occupant.tram + 1) % 4, occupant.signal, 1, now), 0);
        if (now >= suppressClearUntil && random() < .3) {
          assert.equal(ex.tram_core_signal_observe(0, occupant.tram, occupant.signal, 1, now), 1);
          occupant = null;
        }
      }
      signalStep(ex, now, tram, Math.floor(random() * 2), 0, 1);
      if (ex.tram_core_signal_event(0) === 1) grants++;
      assert.equal(ex.tram_core_safety_invariants(), 0, `internal invariant: ${seed}/${tick}`);
      const currentPhase = ex.tram_core_signal_phase(0);
      if (occupant) {
        assert.equal(ex.tram_core_signal_active_tram(0), occupant.tram, `owner lost while occupied: ${seed}/${tick}`);
        assert.equal(ex.tram_core_signal_active_signal(0), occupant.signal);
        assert.ok(currentPhase === 2 || currentPhase === 4, `conflicting phase over occupied zone: ${seed}/${tick}`);
        if (now - enteredAt >= 8) {
          assert.equal(currentPhase, 4);
          assert.equal(ex.tram_core_signal_fault(0), 1);
          faults++;
        }
      }
      if (currentPhase === 4) assert.ok(ex.tram_core_signal_fault(0) > 0);
    }
    assert.ok(entries > 5 && faults > 0 && grants > 0, `seed ${seed} must exercise traffic, grants and missing-clear faults`);
  });
}

test("randomized fleet keeps one tram per geometric conflict zone on every step", async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const ex = await loadCore(), h = ex.tram_core_create(), random = seeded(seed + 100);
    ex.tram_core_begin_network(h, 2, 2, 1);
    line(ex, h, 0, 0); line(ex, h, 1, 20);
    ex.tram_core_set_zone_route(h, 0, 0, 200); ex.tram_core_set_zone_route(h, 0, 1, 200);
    ex.tram_core_configure_tram(h, 0, 0, .01 + random() * .05);
    ex.tram_core_configure_tram(h, 1, 1, .01 + random() * .05);
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 60 === 0) {
        ex.tram_core_set_target_speed(h, 8 + random() * 14);
        ex.tram_core_set_tram_manual(h, Math.floor(random() * 2), 1, random() < .1 ? 0 : 1);
      }
      ex.tram_core_step(h, .05 + random() * .45);
      assert.equal(ex.tram_core_safety_invariants(), 0, `internal fleet invariant: ${seed}/${tick}`);
      const positions = [0, 1].map((tram) => ex.tram_core_vehicle_distance_at(h, tram));
      const inside = positions.map((distance, tram) => ({ tram, distance: Math.min(Math.abs(distance - 200), 2000 - Math.abs(distance - 200)) })).filter(({ distance }) => distance <= 33);
      assert.ok(inside.length <= 1, `two trams inside zone: seed ${seed}, tick ${tick}, ${positions}`);
      if (inside.length) assert.equal(ex.tram_core_zone_owner(h, 0), inside[0].tram);
    }
  }
});

test("an empty manual green returns to auto through clearance instead of staying green forever", async () => {
  const ex = await loadCore(); initializeSignal(ex);
  ex.tram_core_signal_manual(0, 1, 0); signalStep(ex, 0);
  assert.equal(ex.tram_core_signal_phase(0), 2);
  ex.tram_core_signal_manual(0, 0, -1); signalStep(ex, 1);
  assert.equal(ex.tram_core_signal_phase(0), 3);
  signalStep(ex, 2);
  assert.equal(ex.tram_core_signal_phase(0), 0);
  signalStep(ex, 3, 1, 1);
  assert.equal(ex.tram_core_signal_active_tram(0), 1);
});

test("configuration rejects initially overlapping conflict-zone trams without mutating state", async () => {
  const ex = await loadCore(), h = ex.tram_core_create();
  ex.tram_core_begin_network(h, 2, 2, 1);
  line(ex, h, 0, 0); line(ex, h, 1, 20);
  ex.tram_core_set_zone_route(h, 0, 0, 200); ex.tram_core_set_zone_route(h, 0, 1, 200);
  assert.equal(ex.tram_core_configure_tram(h, 0, 0, .1), 1);
  assert.equal(ex.tram_core_configure_tram(h, 1, 1, .1), 0);
  assert.equal(ex.tram_core_safety_invariants(), 0);
  assert.equal(ex.tram_core_configure_tram(h, 1, 1, .05), 1);
  ex.tram_core_step(h, .05);
  assert.equal(ex.tram_core_configure_tram(h, 1, 1, .1), 0, "live position cannot be re-imported");
  assert.equal(ex.tram_core_set_zone_route(h, 0, 1, 100), 0, "live geometry cannot erase a reservation");
});

test("entry during amber fails closed even when the tram owns the approach reservation", async () => {
  const ex = await loadCore(); initializeSignal(ex);
  signalStep(ex, 0, 0, 0);
  assert.equal(ex.tram_core_signal_observe(0, 0, 0, 0, .5), 0);
  signalStep(ex, 1, 1, 1);
  assert.equal(ex.tram_core_signal_phase(0), 4);
  assert.equal(ex.tram_core_signal_fault(0), 2);
  assert.equal(ex.tram_core_safety_invariants(), 0);
});

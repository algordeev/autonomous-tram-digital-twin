// Freestanding C++20 operational core for the Nizhny Novgorod 2 + 21 network.
// Geometry is immutable input; all state changes and safety decisions live here.
extern "C" {
constexpr int MAX_ROUTES=4,MAX_POINTS=384,MAX_TRAMS=20,MAX_ZONES=8,MAX_POWER_SECTIONS=16;
constexpr int MAX_SIGNALS=12;
struct Point{double x,y;};
struct Route{Point points[MAX_POINTS];int count;double cumulative[MAX_POINTS],length;int line,direction;};
struct Tram{int active,route,service,dwell_ticks,manual_mode,manual_command;double distance,speed,acceleration,target_speed,consumed_wh,regenerated_wh;};
struct Zone{double at[MAX_ROUTES],half_width;int owner,release_ticks;};
struct CoreState{double time;int paused,route_count,tram_count,zone_count;Route routes[MAX_ROUTES];Tram trams[MAX_TRAMS];Zone zones[MAX_ZONES];};
static CoreState state{};
struct AuthorityVehicle{
 int initialized,mode,eco_mode,station_phase,station_event,service_state;
 double speed,acceleration,distance,traction_force,brake_force,resistance_force,station_until;
 double consumed,traction_energy,auxiliary_energy,mechanical_brake;
 double gross_regenerated,regenerated,rejected,downhill,climb;
};
static AuthorityVehicle authority[MAX_TRAMS]{};
static int authority_count=0;
struct AuthoritySignal{int initialized,phase,active_tram,active_signal,entered,cleared,manual_mode,manual_signal,pending,event;double until,granted_at;};
static AuthoritySignal authority_signals[MAX_SIGNALS]{};static int authority_signal_count=0;
struct AuthoritySwitch{int initialized,state,locked_by;};static AuthoritySwitch authority_switches[MAX_SIGNALS]{};static int authority_switch_count=0;
struct PowerSection{
 double max_power,traction_power,regeneration_power,reused_power,grid_power,reused_wh,grid_wh,rejected_wh,peak_grid_power;
 int flywheel_modules;double flywheel_power_kw,flywheel_capacity_wh,flywheel_energy_wh,flywheel_charge_eff,flywheel_discharge_eff;
 double flywheel_charge_power,flywheel_discharge_power,flywheel_charged_wh,flywheel_discharged_wh,flywheel_losses_wh;
 double forecast_traction_kw,forecast_regeneration_kw,flywheel_target_grid_kw;int flywheel_mode;
};
struct PowerVehicle{int section,guidance;double consumed,mechanical,gross,input_consumed,input_mechanical,input_gross,accepted,rejected,last_intervention,forecast_traction_kw,forecast_regeneration_kw;};
static PowerSection power_sections[MAX_POWER_SECTIONS]{};static PowerVehicle power_vehicles[MAX_TRAMS]{};
static int power_section_count=0,power_vehicle_count=0,power_strategy=1,power_interventions=0;static double power_network_peak=0;
static double absd(double x){return x<0?-x:x;}
static double clampd(double x,double lo,double hi){return x<lo?lo:(x>hi?hi:x);}
static double wrap(double x,double length){while(x>=length)x-=length;while(x<0)x+=length;return x;}
static double sqrt_newton(double x){if(x<=0)return 0;double r=x>1?x:1;for(int i=0;i<10;i++)r=.5*(r+x/r);return r;}
static double gap(const Tram&a,const Tram&b){return wrap(b.distance-a.distance,state.routes[a.route].length);}
static double cyclic(double a,double b,double l){double d=absd(a-b);return d<l-d?d:l-d;}

int tram_core_abi_version(){return 11;}
double tram_core_uniform_headway(double cycle_m,int active_count,double fallback_m){return active_count>0?(cycle_m/active_count>fallback_m?cycle_m/active_count:fallback_m):fallback_m;}
double tram_core_headway_speed_factor(double distance_m,double safety_m,double restore_at_m){return clampd((distance_m-safety_m)/((restore_at_m-safety_m)>1?(restore_at_m-safety_m):1),0,1);}
int tram_core_terminal_interval_hold(double elapsed_seconds,double target_seconds){return elapsed_seconds+1e-6<target_seconds?1:0;}
int tram_core_terminal_berth(int occupied_mask){if(!(occupied_mask&1))return 1;if(!(occupied_mask&2))return 2;return 0;}
int tram_core_parallel_terminal_bypass(int same_terminal,int occupied_mask){return same_terminal&&occupied_mask!=3?1:0;}
double tram_core_departure_slot(double clock_seconds,double window_start_seconds,double headway_seconds,double next_reserved_seconds){
 if(!(headway_seconds>0))return -1;
 const double relative=(clock_seconds-window_start_seconds)/headway_seconds;
 const long long nearest=(long long)(relative>=0?relative+.5:relative-.5);
 double slot=window_start_seconds+nearest*headway_seconds;
 if(next_reserved_seconds>=0&&slot<next_reserved_seconds)slot=next_reserved_seconds;
 return slot;
}
int tram_core_departure_on_time(double deviation_seconds,double tolerance_seconds){return absd(deviation_seconds)<=tolerance_seconds?1:0;}
int tram_core_authority_begin(int count){if(count<1||count>MAX_TRAMS)return 0;authority_count=count;for(int i=0;i<MAX_TRAMS;i++)authority[i]={};return 1;}
int tram_core_power_begin(int sections,int vehicles,int strategy){if(sections<0||sections>MAX_POWER_SECTIONS||vehicles<1||vehicles>MAX_TRAMS)return 0;power_section_count=sections;power_vehicle_count=vehicles;power_strategy=strategy?1:0;power_interventions=0;power_network_peak=0;for(int i=0;i<MAX_POWER_SECTIONS;i++)power_sections[i]={};for(int i=0;i<MAX_TRAMS;i++){power_vehicles[i]={};power_vehicles[i].section=-1;power_vehicles[i].last_intervention=-1e30;}return 1;}
int tram_core_power_configure_section(int i,double max_power){if(i<0||i>=power_section_count||max_power<0)return 0;power_sections[i].max_power=max_power;return 1;}
int tram_core_power_configure_flywheel(int i,int modules,double module_power_kw,double module_energy_wh,double charge_eff,double discharge_eff,double initial_soc){
 if(i<0||i>=power_section_count||modules<0||module_power_kw<0||module_energy_wh<0)return 0;PowerSection&p=power_sections[i];p.flywheel_modules=modules;p.flywheel_power_kw=modules*module_power_kw;p.flywheel_capacity_wh=modules*module_energy_wh;p.flywheel_charge_eff=clampd(charge_eff,0,1);p.flywheel_discharge_eff=clampd(discharge_eff,0,1);p.flywheel_energy_wh=p.flywheel_capacity_wh*clampd(initial_soc,0,1);return 1;
}
int tram_core_power_set_strategy(int strategy){power_strategy=strategy?1:0;for(int i=0;i<power_vehicle_count;i++)power_vehicles[i].guidance=0;return 1;}
double tram_core_power_target(int i,int section,int manual_mode,int in_service,double now,double speed,double target){if(i<0||i>=power_vehicle_count)return target;PowerVehicle&v=power_vehicles[i];v.guidance=0;v.forecast_traction_kw=section>=0&&target>speed?clampd((target-speed)*80,0,240):0;v.forecast_regeneration_kw=section>=0&&target<speed?clampd((speed-target)*90,0,240):0;if(!power_strategy||manual_mode||!in_service||target<=speed||section<0||section>=power_section_count)return target;PowerSection&s=power_sections[section];if(s.regeneration_power>=8||s.forecast_regeneration_kw>s.forecast_traction_kw+25){v.guidance=1;return target;}double soft=s.flywheel_modules>0?s.flywheel_target_grid_kw:s.max_power*.24;if(soft>420)soft=420;if(s.grid_power<soft)return target;double limited=speed+.75;if(limited>target)limited=target;if(now-v.last_intervention>=10){power_interventions++;v.last_intervention=now;}v.guidance=2;return limited;}
int tram_core_power_guidance(int i){return i>=0&&i<power_vehicle_count?power_vehicles[i].guidance:0;}
int tram_core_power_sync_vehicle(int i,int section,double consumed,double mechanical,double gross,double,double){if(i<0||i>=power_vehicle_count)return 0;PowerVehicle&v=power_vehicles[i];v.section=section;v.input_consumed=consumed;v.input_mechanical=mechanical;v.input_gross=gross;return 1;}
int tram_core_power_step(double dt){if(!(dt>0)||dt>1)return 0;double consumed[MAX_POWER_SECTIONS]{},gross[MAX_POWER_SECTIONS]{},mechanical[MAX_TRAMS]{},generated[MAX_TRAMS]{},predicted_traction[MAX_POWER_SECTIONS]{},predicted_regen[MAX_POWER_SECTIONS]{};for(int i=0;i<power_vehicle_count;i++){PowerVehicle&v=power_vehicles[i];int s=v.section;double dc=v.input_consumed-v.consumed,dm=v.input_mechanical-v.mechanical,dg=v.input_gross-v.gross;if(s>=0&&s<power_section_count){if(dc>0)consumed[s]+=dc;if(dg>0)gross[s]+=dg;predicted_traction[s]+=v.forecast_traction_kw;predicted_regen[s]+=v.forecast_regeneration_kw;}mechanical[i]=dm>0?dm:0;generated[i]=dg>0?dg:0;v.consumed=v.input_consumed;v.mechanical=v.input_mechanical;v.gross=v.input_gross;}
 double network=0;for(int s=0;s<power_section_count;s++){PowerSection&p=power_sections[s];double direct=consumed[s]<gross[s]?consumed[s]:gross[s],demand=consumed[s]-direct,surplus=gross[s]-direct,factor=3.6/dt;
  p.forecast_traction_kw=p.forecast_traction_kw*.72+predicted_traction[s]*.28;p.forecast_regeneration_kw=p.forecast_regeneration_kw*.72+predicted_regen[s]*.28;double charge_input=0,stored=0,discharge_output=0,withdrawn=0;if(p.flywheel_modules>0){double pulse_wh=p.flywheel_power_kw/factor,room=p.flywheel_capacity_wh-p.flywheel_energy_wh;if(room<0)room=0;charge_input=surplus<pulse_wh?surplus:pulse_wh;if(p.flywheel_charge_eff>0&&charge_input>room/p.flywheel_charge_eff)charge_input=room/p.flywheel_charge_eff;stored=charge_input*p.flywheel_charge_eff;p.flywheel_energy_wh+=stored;surplus-=charge_input;
   double soc=p.flywheel_capacity_wh>0?p.flywheel_energy_wh/p.flywheel_capacity_wh:0,reserve_wh=p.flywheel_capacity_wh*.15,target_kw=p.max_power*.24;if(target_kw>420)target_kw=420;p.flywheel_mode=3;if(soc<=.15){p.flywheel_mode=1;target_kw=p.max_power;}else if(soc<.40){p.flywheel_mode=2;target_kw=p.max_power*.35;}else if(soc>.80){p.flywheel_mode=4;target_kw=0;}if(p.forecast_regeneration_kw>p.forecast_traction_kw+25&&soc>.55){p.flywheel_mode=4;target_kw*=.55;}p.flywheel_target_grid_kw=target_kw;
   double desired=demand-target_kw/factor;if(desired<0)desired=0;double available=(p.flywheel_energy_wh-reserve_wh)*p.flywheel_discharge_eff;if(available<0)available=0;discharge_output=desired<pulse_wh?desired:pulse_wh;if(discharge_output>available)discharge_output=available;withdrawn=p.flywheel_discharge_eff>0?discharge_output/p.flywheel_discharge_eff:0;p.flywheel_energy_wh-=withdrawn;demand-=discharge_output;if(charge_input>0)p.flywheel_mode=5;else if(discharge_output>0)p.flywheel_mode=6;p.flywheel_charged_wh+=stored;p.flywheel_discharged_wh+=discharge_output;p.flywheel_losses_wh+=(charge_input-stored)+(withdrawn-discharge_output);}
  double accepted=direct+charge_input,grid=demand,rejected=surplus;p.traction_power=consumed[s]*factor;p.regeneration_power=gross[s]*factor;p.reused_power=direct*factor;p.grid_power=grid*factor;p.flywheel_charge_power=charge_input*factor;p.flywheel_discharge_power=discharge_output*factor;p.reused_wh+=direct;p.grid_wh+=grid;p.rejected_wh+=rejected;if(p.grid_power>p.peak_grid_power)p.peak_grid_power=p.grid_power;network+=p.grid_power;for(int i=0;i<power_vehicle_count;i++){PowerVehicle&v=power_vehicles[i];if(v.section!=s)continue;double share=gross[s]>0?accepted*(generated[i]/gross[s]):0;v.accepted+=share;v.rejected+=mechanical[i]>share?mechanical[i]-share:0;}}
 if(network>power_network_peak)power_network_peak=network;return 1;}
#define POWER_GETTER(name,field) double name(int i){return i>=0&&i<power_section_count?power_sections[i].field:0;}
POWER_GETTER(tram_core_power_section_traction,traction_power) POWER_GETTER(tram_core_power_section_regeneration,regeneration_power) POWER_GETTER(tram_core_power_section_reused,reused_power) POWER_GETTER(tram_core_power_section_grid,grid_power)
POWER_GETTER(tram_core_power_section_reused_wh,reused_wh) POWER_GETTER(tram_core_power_section_grid_wh,grid_wh) POWER_GETTER(tram_core_power_section_rejected_wh,rejected_wh) POWER_GETTER(tram_core_power_section_peak,peak_grid_power)
POWER_GETTER(tram_core_power_section_flywheel_energy,flywheel_energy_wh) POWER_GETTER(tram_core_power_section_flywheel_capacity,flywheel_capacity_wh) POWER_GETTER(tram_core_power_section_flywheel_charge_power,flywheel_charge_power) POWER_GETTER(tram_core_power_section_flywheel_discharge_power,flywheel_discharge_power)
POWER_GETTER(tram_core_power_section_flywheel_charged_wh,flywheel_charged_wh) POWER_GETTER(tram_core_power_section_flywheel_discharged_wh,flywheel_discharged_wh) POWER_GETTER(tram_core_power_section_flywheel_losses_wh,flywheel_losses_wh)
POWER_GETTER(tram_core_power_section_forecast_traction,forecast_traction_kw) POWER_GETTER(tram_core_power_section_forecast_regeneration,forecast_regeneration_kw) POWER_GETTER(tram_core_power_section_flywheel_target_grid,flywheel_target_grid_kw)
int tram_core_power_section_flywheel_mode(int i){return i>=0&&i<power_section_count?power_sections[i].flywheel_mode:0;}
double tram_core_power_vehicle_accepted(int i){return i>=0&&i<power_vehicle_count?power_vehicles[i].accepted:0;}double tram_core_power_vehicle_rejected(int i){return i>=0&&i<power_vehicle_count?power_vehicles[i].rejected:0;}double tram_core_power_network_peak(){return power_network_peak;}int tram_core_power_interventions(){return power_interventions;}
int tram_core_signal_begin(int count){if(count<0||count>MAX_SIGNALS)return 0;authority_signal_count=count;for(int i=0;i<MAX_SIGNALS;i++)authority_signals[i]={};return 1;}
int tram_core_switch_begin(int count){if(count<0||count>MAX_SIGNALS)return 0;authority_switch_count=count;for(int i=0;i<MAX_SIGNALS;i++){authority_switches[i]={};authority_switches[i].locked_by=-1;}return 1;}
int tram_core_switch_sync(int i,int state_value,int locked_by){if(i<0||i>=authority_switch_count)return 0;authority_switches[i]={1,state_value?1:0,locked_by};return 1;}
int tram_core_switch_toggle(int i,int cooperative){if(i<0||i>=authority_switch_count)return 0;AuthoritySwitch&s=authority_switches[i];if(cooperative&&s.locked_by>=0)return 0;s.state=s.state?0:1;return 1;}
int tram_core_switch_request(int i,int desired,int tram,int cooperative){if(i<0||i>=authority_switch_count)return 0;AuthoritySwitch&s=authority_switches[i];if(!cooperative){s.state=desired?1:0;s.locked_by=-1;return 1;}if(s.locked_by<0||s.locked_by==tram){s.state=desired?1:0;s.locked_by=tram;return 1;}return 0;}
int tram_core_switch_release(int i,int tram){if(i<0||i>=authority_switch_count)return 0;AuthoritySwitch&s=authority_switches[i];if(s.locked_by==tram)s.locked_by=-1;return 1;}
int tram_core_switch_state(int i){return i>=0&&i<authority_switch_count?authority_switches[i].state:0;}int tram_core_switch_locked_by(int i){return i>=0&&i<authority_switch_count?authority_switches[i].locked_by:-1;}
int tram_core_signal_sync(int i,int phase,double until,int active_tram,int active_signal,int entered,int cleared,double granted_at,int manual_mode,int manual_signal,int pending){if(i<0||i>=authority_signal_count)return 0;AuthoritySignal&s=authority_signals[i];s={1,phase,active_tram,active_signal,entered,cleared,manual_mode,manual_signal,pending,0,until,granted_at};return 1;}
int tram_core_signal_step(int i,double now,int candidate_tram,int candidate_signal,int still_waiting,int active_invalid,double amber,double green,double clearance,double timeout){
 if(i<0||i>=authority_signal_count||!authority_signals[i].initialized)return 0;AuthoritySignal&s=authority_signals[i];s.event=0;
 if(s.manual_mode==1){s.phase=2;s.until=0;s.active_signal=s.manual_signal;return 1;}
 if(s.manual_mode==2){if(s.entered&&!s.cleared){s.pending=1;s.phase=2;s.until=0;return 1;}s.pending=0;s.phase=0;s.until=0;s.active_tram=s.active_signal=-1;s.entered=s.cleared=0;return 1;}
 if(s.pending){if(!s.entered||s.cleared){s.pending=0;s.phase=0;s.until=0;s.active_tram=s.active_signal=-1;s.entered=s.cleared=0;s.granted_at=0;s.event=6;}return 1;}
 if(s.phase==0&&candidate_tram>=0){s.active_tram=candidate_tram;s.active_signal=candidate_signal;s.entered=s.cleared=0;s.granted_at=now;s.phase=1;s.until=now+amber;s.event=1;return 1;}
 if(s.until<=0||now<s.until)return 1;
 if(s.phase==1){s.phase=2;s.until=now+green;s.event=2;return 1;}
 if(s.phase==2){bool stale=!s.entered&&now-s.granted_at>=timeout&&!still_waiting&&active_invalid;if(stale){s.phase=3;s.until=now+clearance;s.event=3;return 1;}if(!s.cleared){s.until=now+.25;return 1;}s.phase=3;s.until=now+clearance;s.event=4;return 1;}
 if(s.phase==3){s.phase=0;s.until=0;s.active_tram=s.active_signal=-1;s.entered=s.cleared=0;s.granted_at=0;s.event=5;}return 1;
}
int tram_core_signal_phase(int i){return i>=0&&i<authority_signal_count?authority_signals[i].phase:0;}double tram_core_signal_until(int i){return i>=0&&i<authority_signal_count?authority_signals[i].until:0;}
int tram_core_signal_active_tram(int i){return i>=0&&i<authority_signal_count?authority_signals[i].active_tram:-1;}int tram_core_signal_active_signal(int i){return i>=0&&i<authority_signal_count?authority_signals[i].active_signal:-1;}
int tram_core_signal_entered(int i){return i>=0&&i<authority_signal_count?authority_signals[i].entered:0;}int tram_core_signal_cleared(int i){return i>=0&&i<authority_signal_count?authority_signals[i].cleared:0;}
double tram_core_signal_granted_at(int i){return i>=0&&i<authority_signal_count?authority_signals[i].granted_at:0;}int tram_core_signal_pending(int i){return i>=0&&i<authority_signal_count?authority_signals[i].pending:0;}int tram_core_signal_event(int i){return i>=0&&i<authority_signal_count?authority_signals[i].event:0;}
int tram_core_authority_sync(int i,double speed,double acceleration,double consumed,double traction_energy,double auxiliary_energy,double mechanical_brake,double gross_regenerated,double regenerated,double rejected,double downhill,double climb){
 if(i<0||i>=authority_count)return 0;AuthorityVehicle&v=authority[i];int station_phase=v.station_phase,service_state=v.service_state;double station_until=v.station_until;v={};v.station_phase=station_phase;v.station_until=station_until;v.service_state=service_state;v.initialized=1;v.speed=speed;v.acceleration=acceleration;v.consumed=consumed;v.traction_energy=traction_energy;v.auxiliary_energy=auxiliary_energy;v.mechanical_brake=mechanical_brake;v.gross_regenerated=gross_regenerated;v.regenerated=regenerated;v.rejected=rejected;v.downhill=downhill;v.climb=climb;return 1;
}
int tram_core_authority_override_motion(int i,double speed,double acceleration){if(i<0||i>=authority_count||!authority[i].initialized)return 0;authority[i].speed=speed;authority[i].acceleration=acceleration;return 1;}
int tram_core_station_sync(int i,int phase,double until){if(i<0||i>=authority_count)return 0;authority[i].station_phase=phase;authority[i].station_until=until;return 1;}
int tram_core_station_step(int i,double now,int manual,int aligned){if(i<0||i>=authority_count)return 0;AuthorityVehicle&v=authority[i];v.station_event=0;if(manual)return 1;if(v.station_phase==1&&aligned&&v.speed<=.12){v.station_phase=2;v.station_until=now+12;v.station_event=1;}else if(v.station_phase==2&&now>=v.station_until){v.station_phase=0;v.station_until=0;v.station_event=2;}return 1;}
int tram_core_station_phase(int i){return i>=0&&i<authority_count?authority[i].station_phase:0;}double tram_core_station_until(int i){return i>=0&&i<authority_count?authority[i].station_until:0;}int tram_core_station_event(int i){return i>=0&&i<authority_count?authority[i].station_event:0;}
int tram_core_depot_sync(int i,int state_value){if(i<0||i>=authority_count||state_value<0||state_value>4)return 0;authority[i].service_state=state_value;return 1;}
int tram_core_depot_command(int i,int command){if(i<0||i>=authority_count)return -1;int&s=authority[i].service_state;if(command==1&&s==0)s=1;else if(command==2&&s==3)s=4;else if(command==3&&s==1)s=0;return s;}
int tram_core_depot_observe(int i,int reached_portal,int reached_depot,int reached_line,int exit_clear){if(i<0||i>=authority_count)return -1;int&s=authority[i].service_state;if(s==1&&reached_portal)s=2;else if(s==2&&reached_depot)s=3;else if(s==4&&reached_line&&exit_clear)s=0;return s;}
int tram_core_depot_state(int i){return i>=0&&i<authority_count?authority[i].service_state:-1;}
double tram_core_speed_profile_target(double line_speed,double curve_radius,double lateral_acceleration,double infrastructure_speed,double distance_to_restriction,double approach_deceleration){
 const double line=line_speed>0?line_speed:0;double restriction=line;
 if(curve_radius>0&&lateral_acceleration>0){const double curve=sqrt_newton(curve_radius*lateral_acceleration);if(curve<restriction)restriction=curve;}
 if(infrastructure_speed>0&&infrastructure_speed<restriction)restriction=infrastructure_speed;
 if(distance_to_restriction<=0)return restriction;
 const double deceleration=approach_deceleration>0?approach_deceleration:.72;
 const double approach=sqrt_newton(restriction*restriction+2*deceleration*distance_to_restriction);
 return approach<line?approach:line;
}
double tram_core_predictive_eco_target(int i,int enabled,double speed,double authority_target,double distance_to_constraint,double constraint_speed,double grade,double passenger_count,double schedule_margin){
 if(i<0||i>=authority_count)return authority_target;AuthorityVehicle&v=authority[i];const int previous_eco_mode=v.eco_mode;v.eco_mode=0;
 if(!enabled||distance_to_constraint<0||distance_to_constraint>1000||speed<.25||schedule_margin<=.01)return authority_target;
 const double mass=27500+clampd(passenger_count,0,110)*75,slope=clampd(grade,-.12,.12);
 const double resistance=1100*(mass/27500)+32*speed+2.1*speed*speed;
 const double constraint=constraint_speed>0?constraint_speed:0;
 const double service_deceleration=.72,speed_delta=speed*speed-constraint*constraint;
 const double braking_distance=speed_delta>0?speed_delta/(2*service_deceleration):0;
 // Once the normal service-braking envelope is reached, leave pure coasting
 // and follow a monotonic speed curve down to the detector-crossing speed.
 // This applies to station approaches as well as zero-speed constraints.
 if(distance_to_constraint<=braking_distance+4){
  const double envelope=sqrt_newton(constraint*constraint+2*service_deceleration*(distance_to_constraint>0?distance_to_constraint:0));
  v.eco_mode=2;return envelope<authority_target?envelope:authority_target;
 }
 if(authority_target<speed-.2)return authority_target;
 double natural_deceleration=resistance/mass+9.80665*slope;
 if(natural_deceleration<.08)natural_deceleration=.08;
 double coast_distance=speed_delta>0?speed_delta/(2*natural_deceleration):0;
 // This is a short zero-traction lead-in to service braking, not a request to
 // crawl through the whole inter-stop run. Long theoretical coast distances
 // are deliberately capped so closely spaced urban stops retain a useful
 // cruise phase and acceptable journey time.
 const double maximum_coast_start=braking_distance+25;
 if(coast_distance>maximum_coast_start)coast_distance=maximum_coast_start;
 if(coast_distance<braking_distance+12)coast_distance=braking_distance+12;
 const double margin=clampd(schedule_margin,0,1);
 const double coast_start=braking_distance+(coast_distance-braking_distance)*margin;
 // Once a coast-to-stop approach has begun, keep it latched until the station
 // detector hands control to the platform-alignment authority. Without this
 // hysteresis, falling below the eco entry speed can briefly restore line-speed
 // authority and make the tram accelerate immediately before the stop.
 const bool latched_station_approach=previous_eco_mode!=0&&constraint>0&&distance_to_constraint<=220;
 if(distance_to_constraint<=coast_start||latched_station_approach){
  const double coast_acceleration=-(resistance/mass+9.80665*slope);
  double target=speed+coast_acceleration*1.4;if(target<constraint)target=constraint;
  v.eco_mode=1;return target<authority_target?target:authority_target;
 }
 return authority_target;
}
int tram_core_authority_step(int i,double target_speed,int emergency,double grade,double passenger_count,double dt){
 if(i<0||i>=authority_count||!(dt>0)||dt>1)return 0;AuthorityVehicle&v=authority[i];if(!v.initialized)return 0;
 const double empty_mass=27500,passenger_mass=75,mass=empty_mass+clampd(passenger_count,0,110)*passenger_mass,max_traction=32000,max_brake=52000,max_power=240000,max_acceleration=1.15,service_deceleration=1.25,emergency_deceleration=2.4,max_jerk=.9;
 const double drivetrain=.88,regen_efficiency=.86,receptivity=.82,auxiliary_power=4500;
 const double speed=v.speed>0?v.speed:0,target=target_speed>0?target_speed:0,error=target-speed;
 const double current=speed<=1e-6&&error>0?(v.acceleration>0?v.acceleration:0):v.acceleration;
 const bool emergency_brake=emergency!=0&&error<0;const double deceleration=emergency_brake?emergency_deceleration:service_deceleration;
 const double desired=emergency_brake?-emergency_deceleration:clampd(error/1.4,-deceleration,max_acceleration);
 const double jerk=max_jerk*dt,requested=clampd(desired,current-jerk,current+jerk);
 const double resistance=1100*(mass/empty_mass)+32*speed+2.1*speed*speed,slope=clampd(grade,-.12,.12),grade_force=mass*9.80665*slope;
 const double required=mass*requested+resistance+grade_force;double traction=0,brake=0,acceleration=requested;int mode=0;
 if(required>=0){const double power_force=max_power/(speed>1?speed:1);traction=required<max_traction?required:max_traction;if(traction>power_force)traction=power_force;acceleration=(traction-resistance-grade_force)/mass;if(traction>resistance+1)mode=1;}
 else{brake=-required<max_brake?-required:max_brake;acceleration=(-brake-resistance-grade_force)/mass;mode=emergency_brake?3:2;}
 double next=speed+acceleration*dt;if(next<0)next=0;if((error>=0&&next>target)||(error<0&&next<target)){next=target;acceleration=(next-speed)/dt;}
 const double average=(speed+next)*.5,distance=average*dt,traction_wh=(traction*average/drivetrain)*dt/3600,auxiliary_wh=auxiliary_power*dt/3600;
 const double mechanical_wh=brake*average*dt/3600,gross_wh=mechanical_wh*regen_efficiency,regenerated_wh=gross_wh*receptivity,rejected_wh=mechanical_wh-regenerated_wh;
 double gravitational=grade_force<0?-grade_force:grade_force;gravitational=gravitational*average*dt/3600;
 v.speed=next;v.acceleration=acceleration;v.distance=distance;v.traction_force=traction;v.brake_force=brake;v.resistance_force=resistance;v.mode=mode;
 v.consumed+=traction_wh+auxiliary_wh;v.traction_energy+=traction_wh;v.auxiliary_energy+=auxiliary_wh;v.mechanical_brake+=mechanical_wh;v.gross_regenerated+=gross_wh;v.regenerated+=regenerated_wh;v.rejected+=rejected_wh;if(slope<0)v.downhill+=gravitational;else if(slope>0)v.climb+=gravitational;return 1;
}
double tram_core_station_approach_speed(double distance_to_platform,double speed_limit){
 const double distance=distance_to_platform>0?distance_to_platform:0;
 // A conservative braking envelope.  The 0.72 m/s2 curve leaves authority
 // for the 0.9 m/s3 jerk limiter, while the final 0.35 m is reserved for
 // precise platform alignment rather than being crossed at crawl speed.
 const double target=__builtin_sqrt(2.0*.72*(distance>.35?distance-.35:0));
 return target<speed_limit?target:speed_limit;
}
double tram_core_resolve_target_speed(double speed_limit,int manual_mode,int manual_command,int station_phase,int blocked,double interval_factor,int dispatch_hold){if(dispatch_hold||blocked||station_phase==2||(manual_mode&&manual_command==0))return 0;if(manual_mode)return manual_command==1?(speed_limit<20.0/3.6?speed_limit:20.0/3.6):0;if(interval_factor>=0&&interval_factor<1)return speed_limit*interval_factor;return speed_limit;}
double tram_core_safe_move(double requested,double block_distance,double leader_distance,double physical_gap){double allowed=requested;if(block_distance>=0&&block_distance<=allowed+1.6){double d=block_distance-1.6;if(d<0)d=0;if(allowed>d)allowed=d;}if(leader_distance>=0){double d=leader_distance-physical_gap;if(d<0)d=0;if(allowed>d)allowed=d;}return allowed;}
#define AUTH_GETTER(name,field) double name(int i){return i>=0&&i<authority_count?authority[i].field:0;}
AUTH_GETTER(tram_core_authority_speed,speed) AUTH_GETTER(tram_core_authority_acceleration,acceleration) AUTH_GETTER(tram_core_authority_distance,distance)
AUTH_GETTER(tram_core_authority_traction_force,traction_force) AUTH_GETTER(tram_core_authority_brake_force,brake_force) AUTH_GETTER(tram_core_authority_resistance_force,resistance_force)
AUTH_GETTER(tram_core_authority_consumed,consumed) AUTH_GETTER(tram_core_authority_traction_energy,traction_energy) AUTH_GETTER(tram_core_authority_auxiliary_energy,auxiliary_energy)
AUTH_GETTER(tram_core_authority_mechanical_brake,mechanical_brake) AUTH_GETTER(tram_core_authority_gross_regenerated,gross_regenerated) AUTH_GETTER(tram_core_authority_regenerated,regenerated)
AUTH_GETTER(tram_core_authority_rejected,rejected) AUTH_GETTER(tram_core_authority_downhill,downhill) AUTH_GETTER(tram_core_authority_climb,climb)
int tram_core_authority_mode(int i){return i>=0&&i<authority_count?authority[i].mode:0;}
int tram_core_authority_eco_mode(int i){return i>=0&&i<authority_count?authority[i].eco_mode:0;}
void* tram_core_create(){state={};return reinterpret_cast<void*>(1);}
void tram_core_destroy(void*){}
void tram_core_reset(void*){int rc=state.route_count,tc=state.tram_count,zc=state.zone_count;for(int i=0;i<tc;i++){state.trams[i].speed=state.trams[i].acceleration=state.trams[i].consumed_wh=state.trams[i].regenerated_wh=0;state.trams[i].dwell_ticks=0;}for(int z=0;z<zc;z++){state.zones[z].owner=-1;state.zones[z].release_ticks=0;}state.time=0;state.paused=0;state.route_count=rc;state.tram_count=tc;state.zone_count=zc;}
int tram_core_set_paused(void*,int p){state.paused=p!=0;return 1;}
int tram_core_begin_network(void*,int rc,int tc,int zc){if(rc<1||rc>MAX_ROUTES||tc<1||tc>MAX_TRAMS||zc<0||zc>MAX_ZONES)return 0;state={};state.route_count=rc;state.tram_count=tc;state.zone_count=zc;for(int z=0;z<zc;z++){state.zones[z].owner=-1;state.zones[z].half_width=18;for(int r=0;r<MAX_ROUTES;r++)state.zones[z].at[r]=-1;}return 1;}
int tram_core_route_meta(void*,int r,int line,int dir){if(r<0||r>=state.route_count)return 0;state.routes[r].line=line;state.routes[r].direction=dir;return 1;}
int tram_core_add_route_point(void*,int route,double x,double y){if(route<0||route>=state.route_count)return 0;Route&r=state.routes[route];if(r.count>=MAX_POINTS)return 0;int i=r.count++;r.points[i]={x,y};r.cumulative[i]=i?r.cumulative[i-1]+sqrt_newton((x-r.points[i-1].x)*(x-r.points[i-1].x)+(y-r.points[i-1].y)*(y-r.points[i-1].y)):0;r.length=r.cumulative[i];return 1;}
int tram_core_configure_zone(void*,int z,double half){if(z<0||z>=state.zone_count)return 0;state.zones[z].half_width=half;return 1;}
int tram_core_set_zone_route(void*,int z,int r,double at){if(z<0||z>=state.zone_count||r<0||r>=state.route_count)return 0;state.zones[z].at[r]=at;return 1;}
int tram_core_configure_tram(void*,int i,int route,double fraction){if(i<0||i>=state.tram_count||route<0||route>=state.route_count||state.routes[route].length<=0)return 0;state.trams[i]={1,route,0,0,0,1,clampd(fraction,0,.999)*state.routes[route].length,0,0,11.1,0,0};return 1;}
int tram_core_set_target_speed(void*,double speed){for(int i=0;i<state.tram_count;i++)state.trams[i].target_speed=clampd(speed,0,22);return 1;}
int tram_core_set_tram_manual(void*,int i,int enabled,int command){if(i<0||i>=state.tram_count)return 0;state.trams[i].manual_mode=enabled!=0;state.trams[i].manual_command=command;return 1;}
int tram_core_set_tram_service(void*,int i,int service){if(i<0||i>=state.tram_count)return 0;state.trams[i].service=service;state.trams[i].active=service!=2;return 1;}

int tram_core_step(void*,double dt){
 if(!(dt>0)||dt>1)return 0;if(state.paused)return 1;
 // A crossing reservation survives until the complete 15 m tram clears.
 for(int z=0;z<state.zone_count;z++){Zone&zone=state.zones[z];if(zone.owner>=0){Tram&t=state.trams[zone.owner];double at=zone.at[t.route],len=state.routes[t.route].length;if(at<0||cyclic(t.distance,at,len)>zone.half_width+15){if(++zone.release_ticks>8){zone.owner=-1;zone.release_ticks=0;}}else zone.release_ticks=0;}}
 for(int i=0;i<state.tram_count;i++){Tram&t=state.trams[i];if(!t.active)continue;Route&r=state.routes[t.route];double target=t.target_speed;
  if(t.manual_mode)target=t.manual_command==0?0:(t.manual_command==2?3:t.target_speed);
  // No overtaking/headway recovery only within the same route and direction.
  double nearest=1e30;for(int j=0;j<state.tram_count;j++)if(i!=j&&state.trams[j].active&&state.trams[j].route==t.route){double g=gap(t,state.trams[j]);if(g>.01&&g<nearest)nearest=g;}
  if(nearest<22)target=0;else if(nearest<75)target*=clampd((nearest-22)/53,0,1);
  // Both directions request the same conflict zone; an entrant cannot get red.
  for(int z=0;z<state.zone_count;z++){Zone&zone=state.zones[z];double at=zone.at[t.route];if(at<0)continue;double ahead=wrap(at-t.distance,r.length);bool inside=cyclic(t.distance,at,r.length)<=zone.half_width+8;if(inside&&(zone.owner<0||zone.owner==i))zone.owner=i;if(ahead<65&&!inside){if(zone.owner<0)zone.owner=i;if(zone.owner!=i)target=0;}}
  double spacing=r.length/18,phase=wrap(t.distance,spacing),stop_ahead=spacing-phase;
  if(t.service==0&&t.dwell_ticks==0&&stop_ahead<45)target=target<stop_ahead/3?target:stop_ahead/3;
  if(t.service==0&&t.dwell_ticks==0&&phase<1.4&&t.speed<2)t.dwell_ticks=240;
  if(t.dwell_ticks>0){target=0;t.dwell_ticks--;}
  double error=target-t.speed,desired=clampd(error/1.4,-1.25,1.15),jerk=.9*dt;desired=clampd(desired,t.acceleration-jerk,t.acceleration+jerk);double old=t.speed;t.acceleration=desired;t.speed=clampd(t.speed+t.acceleration*dt,0,22);if((error>=0&&t.speed>target)||(error<0&&t.speed<target)){t.speed=target;t.acceleration=(t.speed-old)/dt;}
  double av=(old+t.speed)*.5,resistance=1100+32*av+2.1*av*av;if(t.acceleration>=0){double force=27500*t.acceleration+resistance;t.consumed_wh+=(force*av/.88+4500)*dt/3600;}else{double brake=-(27500*t.acceleration+resistance);if(brake>0)t.regenerated_wh+=brake*av*dt/3600*.86*.82;t.consumed_wh+=4500*dt/3600;}t.distance=wrap(t.distance+av*dt,r.length);
 }
 state.time+=dt;return 1;
}
static Point point_at(int i){Tram&t=state.trams[i];Route&r=state.routes[t.route];double d=t.distance;int p=1;while(p<r.count&&r.cumulative[p]<d)p++;if(p>=r.count)p=r.count-1;double a=r.cumulative[p-1],span=r.cumulative[p]-a,f=span>0?(d-a)/span:0;return{r.points[p-1].x+(r.points[p].x-r.points[p-1].x)*f,r.points[p-1].y+(r.points[p].y-r.points[p-1].y)*f};}
double tram_core_time(void*){return state.time;}int tram_core_tram_count(void*){return state.tram_count;}
double tram_core_vehicle_x_at(void*,int i){return i>=0&&i<state.tram_count?point_at(i).x:0;}double tram_core_vehicle_y_at(void*,int i){return i>=0&&i<state.tram_count?point_at(i).y:0;}
double tram_core_vehicle_speed_at(void*,int i){return i>=0&&i<state.tram_count?state.trams[i].speed:0;}double tram_core_vehicle_acceleration_at(void*,int i){return i>=0&&i<state.tram_count?state.trams[i].acceleration:0;}
double tram_core_consumed_wh_at(void*,int i){return i>=0&&i<state.tram_count?state.trams[i].consumed_wh:0;}double tram_core_regenerated_wh_at(void*,int i){return i>=0&&i<state.tram_count?state.trams[i].regenerated_wh:0;}
int tram_core_vehicle_route_at(void*,int i){return i>=0&&i<state.tram_count?state.trams[i].route:0;}int tram_core_vehicle_service_at(void*,int i){return i>=0&&i<state.tram_count?state.trams[i].service:0;}int tram_core_zone_owner(void*,int z){return z>=0&&z<state.zone_count?state.zones[z].owner:-1;}
double tram_core_vehicle_x(void*h){return tram_core_vehicle_x_at(h,0);}double tram_core_vehicle_y(void*h){return tram_core_vehicle_y_at(h,0);}double tram_core_vehicle_speed(void*h){return tram_core_vehicle_speed_at(h,0);}double tram_core_vehicle_acceleration(void*h){return tram_core_vehicle_acceleration_at(h,0);}
double tram_core_consumed_wh(void*){double s=0;for(int i=0;i<state.tram_count;i++)s+=state.trams[i].consumed_wh;return s;}double tram_core_regenerated_wh(void*){double s=0;for(int i=0;i<state.tram_count;i++)s+=state.trams[i].regenerated_wh;return s;}
}

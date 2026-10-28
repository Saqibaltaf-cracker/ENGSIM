# Engine Lab model and units

This is an educational, physics-motivated approximation. None of the presets,
torque curves, acoustic responses, temperature predictions, or damage limits are
calibrated against measured production-engine data. A generic preset is a starting
configuration, not a claim to reproduce a particular vehicle or recording.

## State and time

`stepEngine(state, config, vehicle, controls, dt)` mutates and returns one state.
Use a fixed 1/1000 s or 1/500 s time step, independent of rendering. Steps over
1/240 s are subdivided; direct calls over 0.25 s are capped to avoid a large
catch-up spiral. The worker is responsible for reporting any dropped wall time.
Internal simulation time advances only by integrated steps. Audio, cylinder
animation, gauges, and graph samples must consume this same state.

Geometry uses millimeters, swept volume uses liters, speed uses m/s, temperature
uses °C, gauge boost uses bar, manifold absolute pressure uses kPa, torque uses
N·m, power uses kW, and rod load uses kN. Four-stroke cycle phase is 0–720 crank
degrees. `firingAngles[cylinder - 1]` defines each cylinder's firing TDC; it is the
authoritative timing input. `firingOrder` is also validated against that timing.
Cylinder numbering begins at 1. For two-bank presets, odd labels are on the left
bank and even labels on the right; changing the firing order without updating
angles intentionally produces a validation warning.

Every step enumerates all TDC crossings, including wrap-around and multiple
cycles, with interpolated simulation timestamps. The start boundary is excluded
and end boundary included to prevent duplicates. `firingEvents` is replaced each
step, so callers rendering less frequently must aggregate events between frames.
`energy` is dimensionless acoustic excitation (0.03–2), not a calibrated energy in
joules. Spark advance changes the mean efficiency envelope; the acoustic pulse
reference remains combustion TDC rather than a predicted exhaust-valve opening.

## Torque, airflow and energy

Swept volume is `N × π/4 × bore² × stroke`. A generic full-load brake torque
envelope starts from estimated BMEP: `torque = BMEP × swept volume / (4π)` for a
four-stroke. A smooth volumetric-efficiency curve depends on cam duration and
lift, overlap, intake-runner length and area, throttle-body area, exhaust flow
restriction, pipe length, muffling/backpressure, and valvetrain speed. Compression
ratio scales an ideal-Otto-style efficiency factor. Fuel/AFR and spark advance
modify efficiency; there is no chemical kinetics or knock model. Friction grows
with displacement and speed; closed-throttle pumping contributes negative torque.
An idle bypass governor changes real modeled throttle rather than imposing RPM.

Manifold filling uses a first-order response scaled by manifold volume and engine
volume. Turbo boost is a capped RPM/throttle envelope with first-order spool and
faster pressure release on lift-off. Supercharged pressure follows engine speed
with a parasitic drive penalty. Intercooling changes the estimated charge-density
gain. These are not compressor/turbine performance maps. Wastegate behavior is
represented only by the boost target cap; compressor surge, turbo count, boost
control PID, intercooler heat soak, and fuel delivery limits are not resolved.

Net shaft torque integrates `I × dω/dt = combustion − friction − pumping − clutch
load`. A modest crank-phase ripple uses the configured firing TDCs; it is not a
thermodynamic in-cylinder pressure solve. Layout/bank angle are geometric/acoustic
descriptors: they do not predict imbalance, crank bending or torsional vibration.
Power is `torque × rpm × 2π / 60 / 1000` kW. Engine inertia affects acceleration,
not the steady-state dyno curve. A starter adds bounded torque; an engine must
crank above 300 RPM to ignite, and stalls below 210 RPM without the starter.

## Drivetrain

Gear ratio times final drive converts wheel speed into a crank target. A bounded
viscous clutch torque couples the rotating engine to vehicle inertia and transfers
wheel force through efficiency and tire radius. Manual clutch is 0 disengaged,
1 engaged. A locked clutch at standstill can stall, especially with brakes applied.
Automatic mode uses a low-speed slipping-converter approximation and brief
disengagement during shifts; it is not a hydrodynamic torque converter model.

Vehicle acceleration is `(wheel force − rolling resistance − aerodynamic drag −
brakes) / mass`. Drag uses `½ρCdAv²` with ρ=1.225 kg/m³, rolling resistance is
`Crr × mass × g`. Motion is forward only. Tire slip, traction limits, slopes,
differentials and suspension are omitted. Neutral/clutch release disconnects wheel
torque while allowing engine RPM to change independently.

## Temperature, stress, and protection

Temperature integrates lumped heat from running/power against a speed-dependent
cooling conductance. There are no separate coolant, oil, piston, intake and exhaust
thermal states. Mean piston speed is `2 × stroke × rpm / 60`. Peak reciprocating
acceleration is estimated as `r × ω² × (1 + r/l)`, and inertial rod tensile force
as `reciprocating mass × acceleration`. Rod force omits gas-pressure loading,
bending, buckling, fatigue cycles, bolts, lubrication and resonance.

Stress is the maximum fraction of configured piston-speed, rod-force, valvetrain,
and temperature limits. These limits are user assumptions rather than calculated
material strengths. Protective mode cuts combustion at redline or stress >= 1.
Experimental mode permits overspeed and accumulates a dimensionless damage value
proportional to `(stress − 1)² × time`; reaching 1 stops combustion. This is an
illustrative failure rule, not a certified engineering or remaining-life estimate.

## Dyno

`generateDyno` samples the same live torque, boost and stress functions at 100-RPM
intervals, including exact redline. Conditions are wide-open throttle, fully spooled
steady-state induction, specified AFR/ignition, no accessory/drivetrain load, and
90 °C for the stress envelope. This is an estimated steady-state brake dyno, not a
time-resolved sweep, measured curve, or accelerating inertia dyno. Rendering may
reveal the samples progressively, but those samples must remain labeled estimates.

## Largest uncertainties and improvements

Volumetric efficiency/BMEP and loss maps dominate torque accuracy. Actual exhaust
paths, port timing, gas temperature and damping dominate acoustic fidelity. Fuel
quality, combustion phasing/knock, compressor maps, thermal masses and measured
component strengths dominate boost and failure accuracy. Credible calibration
would require measured torque/airflow/boost curves, pressure traces and sound data
for a documented engine, plus comparison tests across RPM/load and transient
conditions. The linked sources explain concepts; they do not validate these maps.

The current integrator handles four-stroke engines only. Other cycle types should
introduce a cycle-specific TDC/event generator and volume/work conversion before
changing audio or visual phase interpretation.

# Engine Lab

A browser-based engine exploration workspace built with React, TypeScript, Vite, a fixed-step simulation Web Worker, and a Web Audio AudioWorklet. All engine performance, acoustic, thermal and mechanical predictions are **unvalidated estimates**, not engineering-grade calculations.

## Run locally

Use Node.js 22.12+ (tested with Node 24.19) and npm.

```sh
cd /workspace/ENGSIM # or your local checkout
npm ci
npm run dev
```

Open the development server in a current browser. Audio requires a user gesture and a secure context (HTTPS or localhost). Click **Start** or **Start engine**, then **Enable engine audio**. Keep the initial volume low. No backend, API key, samples, external fonts or runtime network services are required. Engine configurations stay in browser storage; export JSON for a portable backup.

```sh
npm run build      # strict TypeScript check and production bundle
npm run preview    # serve the production bundle
npm test           # physics, event timing, audio and import/persistence tests
npm run test:e2e   # browser workflows (Chromium)
npm run format:check
```

Browser tests use `/usr/bin/chromium` when available. Else install Playwright's browser with `npx playwright install chromium`; the test configuration falls back to its managed browser. The browser-test webServer starts Vite automatically when necessary.

## The workspace

- **Simulation:** adaptive top-down cylinder layout, actual firing-event illumination, optional cycle phases, slow-motion inspection, tachometer, torque/power, manifold/boost, temperature and stress instruments. Start, pause, reset, throttle, brake, neutral, clutch and gear controls work on touch screens too.
- **Engine:** bore, stroke, cylinder architecture, rod geometry, compression, inertia, redline, firing-order/custom TDC angles, cam envelope, fueling/ignition, intake, forced induction, exhaust and configurable component/thermal limits. Inputs show units and explanations. Invalid configurations leave the simulation on its last valid model and show an error.
- **Library:** nine generic archetypes (cross-plane and flat-plane V8, inline-four/six, V10, V12, boxer-four, turbo inline-four and single). Create a new engine, duplicate, save/delete local copies, and import/export versioned JSON. Preset notes identify estimates and link concept sources; none claims to be a verified production engine.
- **Drivetrain:** editable manual/automatic transmission, gear ratios, final drive, clutch coupling, wheel radius, mass, efficiency, drag and rolling resistance. Engine and road speeds are distinct and connected by load. Automatic launch/shift behavior is approximate; manual clutch engagement can stall the engine.
- **Dyno:** repeatable analytical WOT RPM sweep using the same torque/airflow/boost/stress functions as the live model. Inspect torque/power, boost, AFR, intake pressure and stress, change RPM ranges, hide series, inspect peaks and export numerical CSV. Sweep samples are equilibrium estimates; the progress display reveals these samples, not a transient dynamometer run.
- **Analysis:** real live throttle/load, thermal and mechanical utilization, manifold history, audio waveform and FFT. Freeze history to inspect it. The waveform and spectrum read the actual post-limiter audio output.
- **Settings:** metric/imperial display, 500/1,000/2,000 Hz fixed integration, measured worker duty and discarded catch-up time, phase labels, audio quality/volume and local import/export.

Keyboard: **Space** start/stop, **W / ↑** throttle, **S / ↓** brake, **A / ←** downshift, **D / →** upshift, **N** neutral, **P** pause. Shortcuts are suspended while editing. Release the clutch before a manual launch. Audio mutes during slow motion and pause.

## Architecture and assumptions

- `src/sim/types.ts`: shared configuration, controls, state and event contracts (SI internally; geometry in mm).
- `src/sim/index.ts`: airflow/BMEP torque envelope, inertia integration, starter/idle/stall, crank-angle crossing events, manifold and first-order boost response, vehicle coupling, thermal/stress/damage approximations, validation and equilibrium dyno.
- `src/simulation.worker.ts`: fixed-step scheduling, bounded catch-up, event accumulation and measured compute duty. UI rendering does not set the simulation step.
- `src/audio/EngineAudio.ts` and `public/engine-processor.js`: actual firing-event pressure excitation, bank-specific exhaust delay/resonance/reflection paths, intake/mechanical/boost layers, smooth controls and bounded output. No looping engine recording.
- `src/components/`: configuration editor, crank-synchronized visualization, actual analyser plots and SVG instruments/charts.
- `src/storage.ts`: versioned config import, validation, local persistence and downloadable artifacts.

See [the model and formulas](src/sim/MODEL.md) and [the synthesis assumptions](src/audio/README.md). The in-app **Model & assumptions** dialog exposes these limitations too.

## Known limits

This is a complete exploratory vertical slice, not a calibrated engine design package. Torque comes from a generic BMEP/volumetric-efficiency envelope with a mild crank-phase ripple, rather than gas-exchange thermodynamics or pressure traces. Four-stroke only. Cam controls represent equivalent lift/duration/overlap, not independent valve opening/closing curves. Intake/filter restrictions are equivalent geometry; exhaust headers, collectors, catalysts, resonators and mufflers reduce to an equivalent pipe and damping. Turbo count, real compressor/turbine maps, knock, surge, fuel delivery and heat soak are not modeled. Diesel is only an estimated fuel-efficiency envelope.

The rod-force indicator covers peak inertial tensile loading; gas-pressure loading, fatigue, buckling, oil-film behavior, actual material strengths and torsional vibration are omitted. Protective fuel cut and accumulated experimental damage use configurable illustrative thresholds. Cooling is a lumped single-temperature state. Vehicle physics has forward gears only, a slipping clutch/automatic launch approximation, and no tire traction limit, slopes or suspension.

Firing markers persist for 48 ms of simulation time: at high RPM they indicate recent activity, not a simultaneous instantaneous combustion state. Audio events are buffered by approximately 50 ms to schedule actual worker-reported events smoothly; visual and acoustic outputs share event timing but have different presentation latency. Main-thread stalls can drop old audio events rather than produce a burst. Output timbre is synthesized and uncalibrated. AudioWorklet support is required; unsupported browsers show an actionable error.

Improved accuracy requires measured airflow/torque/boost maps and cylinder-pressure traces, fuel/spark calibration, compressor/turbine data, measured exhaust transfer functions and component fatigue/thermal data, with independent comparison tests across load/RPM and transient conditions. Changing an estimated component changes the model, but does not establish its real-world accuracy.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds, tests, and uploads the complete `dist` directory to GitHub Pages when `main` changes. It targets this repository’s project-site path, `/ENGSIM/`. No application secrets are needed.

1. Push the application and workflow to the `main` branch of `Saqibaltaf-cracker/ENGSIM`.
2. In that repository, open **Settings → Pages → Build and deployment**, and select **GitHub Actions** as the source. Pages and Actions must be permitted for the repository and account plan.
3. Open **Actions → Deploy Engine Lab to GitHub Pages** and run the workflow, or push another change to `main`.
4. Use the URL reported by the successful deployment job. A configured URL alone does not establish that deployment succeeded.

For a project-site production check:

```sh
npm run build -- --base=/ENGSIM/
npm run preview -- --port 4173 --base=/ENGSIM/
```

The public site must use HTTPS for AudioWorklet. Keep the standalone `engine-processor.js` file and generated worker/assets when uploading. Root-domain hosts such as Netlify or Vercel use the normal `npm run build` command and `dist` output directory instead.

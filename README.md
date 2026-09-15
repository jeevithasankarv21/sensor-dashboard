# SENTRY: Intelligent Conveyor Belt Health Monitoring Using Sensors

> **Industrial IoT (IIoT) & Predictive Maintenance Platform**  
> **Domain:** Industry 4.0, Sensor-based Machine Learning, Dual-Source Digital Twin Architecture.

---

## 🌟 Executive Summary & Dual-Source Architecture

**SENTRY** is a real-time, sensor-driven predictive maintenance platform engineered to monitor industrial conveyor belt systems. The system operates on an intelligent **Dual-Source Hybrid Architecture**:

1. **4 Physical Conveyor Health Sensors** (Thermal, Vibration, RPM Speed, Sag/Distance) are driven by **Sensor AI Datasets** (`runtime_data.csv` or `synthetic_data.csv`) passed through a 6-feature anomaly classification engine.
2. **1 Material Load Sensor** (HX711 Strain Gauge Weight Sensor) is driven exclusively by **LIVE readings from the physical ESP32 microcontroller** via USB Serial / Web Serial API.

```
       ┌────────────────────────────────────────────────────────┐
       │             SENTRY HYBRID DIGITAL TWIN                 │
       └────────────────────────────────────────────────────────┘
                 │                                    │
    ┌─────────────────────────┐          ┌─────────────────────────┐
    │ 🤖 SENSOR AI DATASETS   │          │ 🔴 PHYSICAL ESP32 (COM3)│
    ├─────────────────────────┤          ├─────────────────────────┤
    │ 1. MLX90614 (Temp ΔT)   │          │ 5. HX711 Load Cell      │
    │ 2. MPU6050/6500 (Vib)   │          │    - Material Weight    │
    │ 3. AH49E (Speed / RPM)  │          │    - Belt Tension/Load  │
    │ 4. HC-SR04 (Sag/Height) │          │    - Real-time Strain   │
    └─────────────────────────┘          └─────────────────────────┘
                 │                                    │
                 └───────────────┬────────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │ 🖥️ SENTRY REAL-TIME DASHBOARD │
                 │  - 5 Live Sensor Gauges       │
                 │  - 5 Real-Time Graphs         │
                 │  - AI Health Index (0-100%)   │
                 │  - Diagnostic Alerts Feed     │
                 └───────────────────────────────┘
```

---

## 🔬 Sensor Breakdown

| # | Sensor | Type | Source | Physical Metric | Operational Nominal Range | Detected Failure Modes |
|---|---|---|---|---|---|---|
| **1** | **Infrared Thermal** | MLX90614 | 🤖 **Sensor AI** | Object Temp (°C), Room Temp (°C), $\Delta T$ | Object: $30.0 - 38.0^\circ\text{C}$, $\Delta T < 15^\circ\text{C}$ | Bearing friction, idler roller overheating, lubrication degradation |
| **2** | **Vibration / IMU** | MPU6050 / 6500 | 🤖 **Sensor AI** | RMS Vibration ($m/s^2$), 3-Axis ($X, Y, Z$) | $\le 10.0\ m/s^2$ | Rotor eccentricity, harmonic resonance, bearing raceway defects |
| **3** | **Hall Effect Speed** | AH49E | 🤖 **Sensor AI** | Drive Speed ($RPM$), Belt Velocity ($m/s$) | Nominal conveyor speed | Belt slip, motor stall, transmission jam, frequency pulse surges |
| **4** | **Ultrasonic Distance** | HC-SR04 | 🤖 **Sensor AI** | Distance to Belt ($cm$), Belt Height ($cm$) | $1.0 - 3.0\ cm$ (Height: $10.5 - 13.5\ cm$) | Structural belt sagging, tensioner slack, track derailment risk |
| **5** | **Material Load Cell** | HX711 Strain Gauge | 🔴 **ESP32 LIVE** | Live Material Weight ($kg$), Tension ($kN$) | $0.0 - 75.0\ kg$ ($< 75\%$ Rated Capacity) | Conveyor overload, material pileup jam, severe belt fatigue |

---

## 📊 Included Datasets (From `sensors ai model`)

1. **`runtime_data.csv` (Physical Prototype Runtime Telemetry)**:
   - **328 real samples** recorded from the physical conveyor prototype during live operation.
   - Includes ground-truth status flags (`vibration_condition`, `rpm_condition`, `object_temperature_condition`, `distance_condition`) and system alert codes.
   - States: `NORMAL`, `WARNING_1`, `WARNING_2`, `HIGH_RISK`, `SENSOR_FAILURE`.

2. **`synthetic_data.csv` (Industrial AI Benchmark)**:
   - **5,000 points** balanced across operational regimes for comprehensive stress testing.

3. **`runtime_features.csv` & `synthetic_features.csv`**:
   - Rolling window aggregated features (mean, rms, std, variance, peak-to-peak, trend) for time-series pattern classification.

4. **Custom CSV File Upload**:
   - Drag-and-drop any custom `.csv` dataset file to instantly stream through the 4 AI sensors.

---

## 🎮 Dashboard Features & Controls

1. **Dual-Source Sensor Display**:
   - Cards 1–4 are badged **`🤖 SENSOR AI`**.
   - Card 5 is badged **`🔴 ESP32 LIVE`** with a pulsing live hardware status badge, active load percentage gauge, and direct USB connection controls.

2. **Connecting the ESP32 (Two Methods)**:
   - **Method A (Web Serial - 1 Click Direct USB)**: Plug ESP32 into your computer. In Google Chrome or Microsoft Edge, click the **`⚡ CONNECT ESP32 USB`** button on Card 5. Select your ESP32's COM port in the browser popup. The dashboard will instantly read live load cells directly in the browser—no Python or drivers needed!
   - **Method B (Python Backend Bridge)**: Run `python backend/backend_bridge.py --port COM3` to read the ESP32 over serial and stream telemetry via WebSockets.
   - **Test Bench Slider**: When hardware is unplugged, an interactive load slider allows simulating live weight changes from 0 to 100 kg.

3. **Interactive Dataset Playback Toolbar**:
   - **Play / Pause** (▶️ / ⏸️) [Hotkey: `Spacebar`]
   - **Step Forward / Backward** (⏮️ / ⏭️)
   - **Timeline Scrubber**: Drag slider to jump to any row/sample index in the dataset.
   - **Playback Speed**: `0.5x`, `1x`, `2x`, `5x`, `10x`.
   - **Loop Toggle**: Continuously loop dataset playback.

4. **Overall Conveyor Health Status (Hero Banner)**:
   - Dynamic Health Index (0% - 100%).
   - Classifications: `NORMAL` 🟢, `WARNING_1` / `WARNING_2` 🟡, `HIGH_RISK` 🔴, `SENSOR_FAILURE` 🟣.
   - Mechanical overload override: Triggers critical risk alert if live ESP32 load exceeds safe threshold (>85 kg).

5. **5 Real-Time Graphs (Chart.js)**:
   - Temperature vs Time (Dual line: Object & Room)
   - Vibration vs Time ($m/s^2$ RMS)
   - Conveyor Speed vs Time ($RPM$)
   - Distance & Belt Height vs Time ($cm$)
   - **Belt Material Load vs Time (ESP32 Live $kg$)**

6. **⏺️ 5-Sensor Runtime Data Acquisition Console (Take Runtime Data)**:
   - Click the **`⏺️ Take Runtime Data`** button in the top toolbar to open the data acquisition studio.
   - **Multi-Source Acquisition**: Record directly from the **physical ESP32 on COM3**, the **Hybrid Digital Twin**, or the **Simulator**.
   - **Live Sampling Rates**: Select from 1 Hz (1 sec), 2 Hz (500 ms), 5 Hz (200 ms), or 10 Hz (100 ms).
   - **Real-Time Buffer Preview Table**: Watch live rows scroll with instantaneous sensor measurements, color-coded threshold alerts, and overall ML classifications.
   - **1-Click CSV Export**: Download a standardized `runtime_data_5sensors.csv` file formatted identically to `runtime_data.csv` for training or validating machine learning models.
   - **Instant Dashboard Replay**: Feed your newly recorded runtime dataset straight into the dashboard player with 1 click to evaluate it with the AI anomaly detector.

---

## 🚀 Quick Start Guide

### Option 1: Standalone Browser Run (Zero Installation Required!)
1. Open the project folder:
   ```
   C:\Users\Roopesh\.gemini\antigravity\scratch\sentry-dashboard\
   ```
2. Double-click **`index.html`** to open it in Chrome or Edge.
3. The 4 AI sensors will immediately stream the prototype runtime dataset.
4. Plug your ESP32 into USB and click **`⚡ CONNECT ESP32 USB`** on the Belt Material Load card to stream live weight!

---

### Option 2: Python Backend Stream & Serial Bridge

#### 1. Install Dependencies
```bash
cd C:\Users\Roopesh\.gemini\antigravity\scratch\sentry-dashboard\backend
pip install -r requirements.txt
```

#### 2. Run Hybrid Stream
Streams the 4 sensors from `runtime_data.csv` while listening to `COM3` for live ESP32 load data:
```bash
python backend_bridge.py --port COM3 --baud 115200 --stream runtime
```

#### 3. Take Runtime Data via Terminal Bridge
To record live 5-sensor runtime telemetry directly to a CSV file from the CLI:
```bash
python backend_bridge.py --port COM3 --stream runtime --record runtime_data_captured.csv
```

---

## 🔌 ESP32 Firmware Sketches

The project includes two ready-to-flash Arduino sketches in `backend/`:

1. **`backend/esp32_loadcell_only.ino` (Dedicated Load Cell Firmware)**:
   - Designed specifically for setups where only the HX711 scale is wired to the ESP32.
   - Pinout:
     - **HX711 DT (Data)** $\rightarrow$ **ESP32 GPIO 4**
     - **HX711 SCK (Clock)** $\rightarrow$ **ESP32 GPIO 16**
     - **VCC** $\rightarrow$ **5V / 3.3V**
     - **GND** $\rightarrow$ **GND**
   - Streams at 5 Hz with automatic zero/tare command support.

2. **`backend/esp32_firmware.ino` (Full 5-Sensor Firmware)**:
   - Complete prototype firmware supporting all 5 physical sensors (MLX90614, MPU6500, AH49E, HC-SR04, HX711).

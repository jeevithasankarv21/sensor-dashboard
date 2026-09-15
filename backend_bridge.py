#!/usr/bin/env python3
"""
SENTRY: Intelligent Conveyor Belt Health Monitoring Using Sensors
Hybrid Telemetry Bridge & Sensor AI Inference Server:
  - 4 Conveyor Health Sensors: Streamed from Sensor AI datasets (runtime_data.csv)
  - 1 Material Load Sensor: Read LIVE directly from physical ESP32 on COM3

Usage:
  # 1. Hybrid Mode (Default): 4 Sensors from Runtime AI Dataset, Load Cell LIVE from ESP32:
  python backend_bridge.py --port COM3 --stream runtime

  # 2. Hybrid Mode with Synthetic AI Dataset:
  python backend_bridge.py --port COM3 --stream synthetic

  # 3. Full ESP32 Hardware Mode (All sensors from ESP32):
  python backend_bridge.py --port COM3 --stream none
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import random
import re
import sys
import time
from typing import Dict, Any, Set, Optional, List

# Third-party imports (handled gracefully if running without dependencies)
try:
    import serial
except ImportError:
    serial = None

try:
    import websockets
except ImportError:
    websockets = None

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("SentryHybridBridge")

# Global connected WebSocket clients
CONNECTED_CLIENTS: Set[Any] = set()

# Live ESP32 Hardware State (Specifically for Load Cell HX711 + Optional 5 Sensors)
LIVE_ESP32_STATE = {
    "load_kg": 0.0,
    "last_updated": 0,
    "connected": False,
    "port": "COM3",
    "all_sensors": {}
}

# Runtime Data Acquisition Logger
RECORD_CSV_FILE: Optional[str] = None
RECORD_COUNT: int = 0


def log_runtime_data_sample(packet: Dict[str, Any]):
    """Appends live 5-sensor telemetry row to runtime_data CSV file."""
    global RECORD_COUNT, RECORD_CSV_FILE
    if not RECORD_CSV_FILE:
        return

    s = packet.get("sensors", {})
    mlx = s.get("mlx90614", {})
    mpu = s.get("mpu6500", {})
    ah = s.get("ah49e", {})
    hc = s.get("hcsr04", {})
    lc = s.get("loadCell", {})
    overall = packet.get("overall", {})

    ts = int(time.time() * 1000)
    row = [
        ts,
        mpu.get("vibration", 0.85) if mpu.get("vibration") is not None else "",
        ah.get("rpm", 460) if ah.get("rpm") is not None else "",
        mlx.get("objTemp", 32.5) if mlx.get("objTemp") is not None else "",
        mlx.get("roomTemp", 27.2) if mlx.get("roomTemp") is not None else "",
        hc.get("distance", 2.8) if hc.get("distance") is not None else "",
        hc.get("beltHeight", 11.2) if hc.get("beltHeight") is not None else "",
        lc.get("load", 24.5) if lc.get("load") is not None else "",
        mpu.get("status", "NORMAL"),
        ah.get("status", "NORMAL"),
        mlx.get("status", "NORMAL"),
        mlx.get("status", "NORMAL"),
        hc.get("status", "NORMAL"),
        lc.get("status", "NORMAL"),
        overall.get("status", "NORMAL"),
        f'"{packet.get("rawAlerts", "NONE")}"'
    ]
    try:
        with open(RECORD_CSV_FILE, "a", encoding="utf-8") as f:
            f.write(",".join(str(x) for x in row) + "\n")
        RECORD_COUNT += 1
        if RECORD_COUNT % 10 == 0:
            logger.info(f"⏺️ [RECORDER] Captured {RECORD_COUNT} runtime samples -> '{RECORD_CSV_FILE}'")
    except Exception as e:
        logger.error(f"Error logging runtime data sample: {e}")


class SensorAIModel:
    """
    4-Sensor AI Anomaly & Pattern Classifier
    Evaluates 6 feature inputs from the 4 conveyor health sensors:
      [vibration, rpm, object_temp, room_temp, distance, belt_height]
    Load (kg) is monitored independently for structural/mechanical overload limits.
    """
    def __init__(self):
        logger.info("Initializing 4-Sensor AI Anomaly Classifier...")

    def predict(self, features: Dict[str, Optional[float]]) -> Dict[str, Any]:
        vib = features.get("vibration")
        rpm = features.get("rpm")
        obj_t = features.get("obj_temp")
        room_t = features.get("room_temp")
        dist = features.get("distance")
        belt_h = features.get("belt_height")

        diagnostics = []
        abnormal_score = 0
        has_failure = False

        # 1. Check MLX90614
        if obj_t is None:
            has_failure = True
            diagnostics.append("Object Temperature Sensor Disconnected/NaN (MLX90614).")
            abnormal_score += 3
        elif obj_t > 50.0:
            diagnostics.append(f"Critical bearing thermal signature ({obj_t:.1f}°C).")
            abnormal_score += 3
        elif obj_t > 38.0 or obj_t < 30.0:
            diagnostics.append(f"Object temperature variance ({obj_t:.1f}°C).")
            abnormal_score += 1

        if room_t is None:
            has_failure = True
            diagnostics.append("Room Temperature Sensor Disconnected/NaN.")
            abnormal_score += 2
        elif room_t > 45.0 or room_t < 25.0:
            diagnostics.append(f"Ambient temperature deviation ({room_t:.1f}°C).")
            abnormal_score += 1

        if obj_t is not None and room_t is not None:
            delta_t = obj_t - room_t
            if delta_t > 25.0:
                diagnostics.append(f"Severe thermal gradient (ΔT: +{delta_t:.1f}°C). Bearing friction alert.")
                abnormal_score += 3
            elif delta_t > 15.0:
                diagnostics.append(f"Elevated thermal gradient (ΔT: +{delta_t:.1f}°C). Lubrication check recommended.")
                abnormal_score += 2

        # 2. Check MPU6050 / MPU6500
        if vib is None:
            has_failure = True
            diagnostics.append("MPU Vibration Sensor Bus Failure / Disconnect.")
            abnormal_score += 3
        elif vib > 20.0:
            diagnostics.append(f"Severe mechanical vibration ({vib:.2f} m/s²). Probable rotor eccentricity.")
            abnormal_score += 4
        elif vib > 10.0:
            diagnostics.append(f"Elevated vibration ({vib:.2f} m/s²). Moderate roller harmonic wear.")
            abnormal_score += 2

        # 3. Check AH49E (RPM)
        if rpm is None:
            has_failure = True
            diagnostics.append("Hall Effect Speed Sensor Pulse Timeout.")
            abnormal_score += 2
        elif rpm > 120000:
            diagnostics.append(f"Hall sensor pulse frequency surge ({int(rpm):,} RPM).")
            abnormal_score += 1

        # 4. Check HC-SR04
        if dist is None:
            has_failure = True
            diagnostics.append("Ultrasonic Sensor Echo Failure / Out of Range (HC-SR04).")
            abnormal_score += 3
        elif dist > 14.5:
            has_failure = True
            diagnostics.append(f"Geometry error: Distance ({dist:.1f} cm) exceeds mount height (14.5 cm).")
            abnormal_score += 3
        elif dist > 8.0:
            diagnostics.append(f"Severe belt sag detected ({dist:.1f} cm). Conveyor derailment risk.")
            abnormal_score += 4
        elif dist > 3.0:
            diagnostics.append(f"Belt clearance deviation ({dist:.1f} cm > 3.0 cm). Sagging detected.")
            abnormal_score += 2

        # Determine Prediction
        if has_failure:
            prediction = "SENSOR_FAILURE"
            confidence = 94.8
            p_norm, p_warn, p_dang = 2, 5, 93
            health = max(25, 50 - abnormal_score * 5)
        elif abnormal_score >= 5:
            prediction = "HIGH_RISK"
            confidence = 92.5
            p_norm, p_warn, p_dang = 1, 7, 92
            health = max(15, 38 - abnormal_score * 4)
        elif abnormal_score >= 3:
            prediction = "WARNING_2"
            confidence = 88.5
            p_norm, p_warn, p_dang = 6, 88, 6
            health = max(45, 62 - abnormal_score * 5)
        elif abnormal_score >= 1:
            prediction = "WARNING_1"
            confidence = 89.2
            p_norm, p_warn, p_dang = 10, 86, 4
            health = max(65, 78 - abnormal_score * 4)
        else:
            prediction = "NORMAL"
            confidence = 98.6
            p_norm, p_warn, p_dang = 98, 2, 0
            health = 98
            diagnostics.append("All 4 physical sensors correlate within nominal operational bounds.")

        return {
            "prediction": prediction,
            "confidence": round(confidence, 1),
            "healthIndex": health,
            "probabilities": {
                "normal": p_norm,
                "warning": p_warn,
                "danger": p_dang
            },
            "diagnostic": " ".join(diagnostics)
        }


def enrich_telemetry(raw: Dict[str, Any], ai_model: SensorAIModel, live_load_override: Optional[float] = None) -> Dict[str, Any]:
    """Combines raw 4-sensor readings with live ESP32 load and AI inference."""
    def parse_float(key):
        v = raw.get(key)
        if v is None or v == "" or str(v).lower() in ["null", "nan"]:
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    vib = parse_float("vibration")
    rpm = parse_float("rpm")
    obj_t = parse_float("object_temperature_c") or parse_float("obj_temp")
    room_t = parse_float("room_temperature_c") or parse_float("room_temp")
    dist = parse_float("distance_cm") or parse_float("distance")
    belt_h = parse_float("belt_height_from_ground_cm")

    if belt_h is None and dist is not None:
        belt_h = max(0.0, 14.5 - dist)

    delta_t = round(obj_t - room_t, 1) if (obj_t is not None and room_t is not None) else None
    velocity = round(rpm * 0.00314, 2) if rpm is not None else 0.0

    # Determine load: prioritize live physical ESP32 load reading
    load_val = live_load_override
    if load_val is None:
        if LIVE_ESP32_STATE["connected"] and (time.time() - LIVE_ESP32_STATE["last_updated"]) < 5.0:
            load_val = LIVE_ESP32_STATE["load_kg"]
        else:
            load_val = parse_float("load_kg") or parse_float("load") or 0.0

    status_load = "DANGER" if load_val > 85.0 else ("WARNING" if load_val > 60.0 else "NORMAL")

    # 4-Sensor Feature Vector (Evaluated by Sensor AI)
    features = {
        "vibration": vib,
        "rpm": rpm,
        "obj_temp": obj_t,
        "room_temp": room_t,
        "distance": dist,
        "belt_height": belt_h
    }
    ai_res = ai_model.predict(features)

    # Status pills
    status_temp = "NORMAL"
    if obj_t is None or room_t is None:
        status_temp = "SENSOR_FAILURE"
    elif obj_t > 50 or (delta_t and delta_t > 25):
        status_temp = "DANGER"
    elif obj_t > 38 or (delta_t and delta_t > 15):
        status_temp = "WARNING"

    status_vib = "NORMAL"
    if vib is None:
        status_vib = "SENSOR_FAILURE"
    elif vib > 20:
        status_vib = "DANGER"
    elif vib > 10:
        status_vib = "WARNING"

    status_rpm = "NORMAL"
    if rpm is None:
        status_rpm = "SENSOR_FAILURE"
    elif rpm > 120000:
        status_rpm = "WARNING"

    status_dist = "NORMAL"
    if dist is None or dist > 14.5:
        status_dist = "SENSOR_FAILURE"
    elif dist > 8.0:
        status_dist = "DANGER"
    elif dist > 3.0:
        status_dist = "WARNING"

    sag_text = "0.4 cm (Nominal)"
    if dist is None:
        sag_text = "Sensor Disconnected"
    elif dist > 3.0:
        sag_text = f"{dist - 2.5:.1f} cm (Sag Detected)"

    overall_status = ai_res["prediction"]
    health = ai_res["healthIndex"]

    # Mechanical overload override
    if load_val > 85.0 and overall_status != "DANGER":
        overall_status = "HIGH_RISK"
        health = min(health, 25)
    elif load_val > 60.0 and overall_status == "NORMAL":
        overall_status = "WARNING_1"
        health = min(health, 65)

    return {
        "timestamp": time.strftime("%I:%M:%S %p"),
        "sensors": {
            "mlx90614": {
                "objTemp": round(obj_t, 1) if obj_t is not None else None,
                "roomTemp": round(room_t, 1) if room_t is not None else None,
                "deltaTemp": delta_t,
                "status": status_temp
            },
            "mpu6500": {
                "vibration": round(vib, 2) if vib is not None else None,
                "axisX": round(vib * 0.32, 2) if vib is not None else None,
                "axisY": round(vib * 0.38, 2) if vib is not None else None,
                "axisZ": round(vib * 0.86, 2) if vib is not None else None,
                "status": status_vib
            },
            "ah49e": {
                "rpm": int(rpm) if rpm is not None else None,
                "velocity": velocity,
                "slipRatio": "100% (Stall)" if rpm == 0 else ("Freq Surge" if rpm and rpm > 120000 else "1.2%"),
                "status": status_rpm
            },
            "hcsr04": {
                "distance": round(dist, 1) if dist is not None else None,
                "beltHeight": round(belt_h, 1) if belt_h is not None else None,
                "sag": sag_text,
                "status": status_dist
            },
            "loadCell": {
                "load": round(load_val, 1),
                "capacityPct": round((load_val / 100.0) * 100.0, 1),
                "status": status_load,
                "source": "ESP32_LIVE" if LIVE_ESP32_STATE["connected"] else "STANDBY"
            }
        },
        "ml": ai_res,
        "overall": {
            "status": overall_status,
            "healthIndex": health,
            "groundTruth": raw.get("overall_status", raw.get("status", ai_res["prediction"]))
        },
        "rawAlerts": raw.get("alerts", "NONE")
    }


async def ws_handler(websocket):
    """Register client and keep connection open."""
    CONNECTED_CLIENTS.add(websocket)
    logger.info(f"Dashboard client connected: {websocket.remote_address} (Total clients: {len(CONNECTED_CLIENTS)})")
    try:
        await websocket.wait_closed()
    finally:
        CONNECTED_CLIENTS.remove(websocket)
        logger.info(f"Dashboard client disconnected. (Remaining: {len(CONNECTED_CLIENTS)})")


async def broadcast_packet(packet: Dict[str, Any]):
    """Broadcasts enriched JSON telemetry to all connected dashboard websockets and logs if recording."""
    if RECORD_CSV_FILE:
        log_runtime_data_sample(packet)

    if not CONNECTED_CLIENTS:
        return
    message = json.dumps(packet)
    await asyncio.gather(
        *[client.send(message) for client in CONNECTED_CLIENTS],
        return_exceptions=True
    )


def load_csv_records(csv_path: str) -> List[Dict[str, Any]]:
    """Loads CSV dataset rows into dictionaries."""
    records = []
    if not os.path.exists(csv_path):
        logger.error(f"CSV file not found: {csv_path}")
        return records

    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(row)

    logger.info(f"Loaded {len(records)} records from {csv_path}")
    return records


async def esp32_serial_listener(port: str, baud: int):
    """Listens continuously on USB Serial for live load cell telemetry from physical ESP32."""
    if serial is None:
        logger.warning("pyserial is not installed. Live serial read disabled. (pip install pyserial)")
        return

    while True:
        try:
            logger.info(f"Connecting to ESP32 on {port} ({baud} baud) for LIVE LOAD telemetry...")
            ser = serial.Serial(port, baud, timeout=1.0)
            LIVE_ESP32_STATE["connected"] = True
            logger.info(f"✓ Successfully connected to ESP32 on {port}! Live load stream active.")

            while True:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    load_val = None
                    if line.startswith("{") and line.endswith("}"):
                        try:
                            data = json.loads(line)
                            if "load_kg" in data and data["load_kg"] is not None:
                                load_val = float(data["load_kg"])
                            elif "load" in data and data["load"] is not None:
                                load_val = float(data["load"])
                            elif "weight" in data and data["weight"] is not None:
                                load_val = float(data["weight"])
                        except json.JSONDecodeError:
                            pass
                    else:
                        # Parse raw floats or text such as "Load: 24.5 kg" or "24.50"
                        if not any(k in line.lower() for k in ["init", "ready", "warning"]):
                            match = re.search(r"[-+]?\b\d+(\.\d+)?\b", line)
                            if match:
                                try:
                                    load_val = float(match.group(0))
                                except ValueError:
                                    pass

                    if load_val is not None:
                        LIVE_ESP32_STATE["load_kg"] = max(0.0, load_val)
                        LIVE_ESP32_STATE["last_updated"] = time.time()
                        LIVE_ESP32_STATE["connected"] = True

                await asyncio.sleep(0.01)

        except Exception as e:
            LIVE_ESP32_STATE["connected"] = False
            logger.warning(f"ESP32 on {port} offline/waiting ({e}). Retrying in 3 seconds...")
            await asyncio.sleep(3.0)


async def csv_hybrid_stream_loop(csv_path: str, rate_sec: float, ai_model: SensorAIModel):
    """Streams the 4 sensors from CSV dataset and merges with LIVE ESP32 load cell."""
    records = load_csv_records(csv_path)
    if not records:
        logger.warning("No records in dataset; falling back to simulated stream.")
        return await demo_generator_loop(ai_model)

    logger.info(f"Starting Hybrid Telemetry Stream ({len(records)} AI points, {rate_sec}s/sample)...")
    idx = 0
    while True:
        raw_row = records[idx]
        idx = (idx + 1) % len(records)

        # Merge live ESP32 load reading
        live_load = LIVE_ESP32_STATE["load_kg"] if LIVE_ESP32_STATE["connected"] else None
        packet = enrich_telemetry(raw_row, ai_model, live_load_override=live_load)

        await broadcast_packet(packet)
        await asyncio.sleep(rate_sec)


async def demo_generator_loop(ai_model: SensorAIModel):
    """Simulates 4-sensor conveyor belt telemetry when hardware is unplugged."""
    logger.info("Running synthetic 4-sensor generator loop (1Hz)...")
    step = 0
    while True:
        step += 1
        j = lambda amt: (random.random() - 0.5) * 2 * amt
        raw = {
            "obj_temp": round(32.1 + j(0.4), 1),
            "room_temp": round(32.3 + j(0.2), 1),
            "vibration": round(2.5 + j(0.3), 2),
            "rpm": max(0, int(460 + j(15))),
            "distance": round(2.8 + j(0.2), 1),
            "overall_status": "NORMAL"
        }
        live_load = LIVE_ESP32_STATE["load_kg"] if LIVE_ESP32_STATE["connected"] else None
        packet = enrich_telemetry(raw, ai_model, live_load_override=live_load)
        await broadcast_packet(packet)
        await asyncio.sleep(1.0)


async def main():
    parser = argparse.ArgumentParser(description="SENTRY: Hybrid Telemetry Bridge (4 Sensor AI + Live ESP32 Load)")
    parser.add_argument("--port", type=str, default="COM3", help="Serial COM port for ESP32 (default: COM3)")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud rate (default: 115200)")
    parser.add_argument("--stream", type=str, choices=["runtime", "synthetic", "none"], default="runtime",
                        help="4-sensor stream source ('runtime', 'synthetic', or 'none' for full hardware)")
    parser.add_argument("--rate", type=float, default=1.0, help="Playback rate in seconds per packet (default: 1.0)")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket server port (default: 8765)")
    parser.add_argument("--demo", action="store_true", help="Force synthetic demo generator")
    parser.add_argument("--record", type=str, default=None,
                        help="Record live 5-sensor runtime telemetry to CSV file (e.g. --record runtime_data_captured.csv)")

    args = parser.parse_args()

    LIVE_ESP32_STATE["port"] = args.port
    ai_model = SensorAIModel()

    # Configure Runtime Data Recording if requested
    global RECORD_CSV_FILE
    if args.record:
        RECORD_CSV_FILE = args.record
        if not os.path.exists(RECORD_CSV_FILE) or os.path.getsize(RECORD_CSV_FILE) == 0:
            header = "timestamp,vibration,rpm,object_temperature_c,room_temperature_c,distance_cm,belt_height_from_ground_cm,load_kg,vibration_condition,rpm_condition,object_temperature_condition,room_temperature_condition,distance_condition,load_condition,overall_status,alerts\n"
            with open(RECORD_CSV_FILE, "w", encoding="utf-8") as f:
                f.write(header)
        logger.info(f"⏺️ [RECORDER] 5-Sensor Runtime Data Acquisition ACTIVE -> logging to '{RECORD_CSV_FILE}'")

    # Paths to datasets
    script_dir = os.path.dirname(os.path.abspath(__file__))
    runtime_csv = os.path.join(script_dir, "..", "data", "runtime_data.csv")
    synthetic_csv = os.path.join(script_dir, "..", "data", "synthetic_data.csv")

    # Start WebSocket Server
    if websockets is not None:
        logger.info(f"Starting SENTRY WebSocket server on ws://localhost:{args.ws_port}...")
        server = await websockets.serve(ws_handler, "0.0.0.0", args.ws_port)
        logger.info(f"WebSocket server running and listening on port {args.ws_port}.")
    else:
        logger.warning("websockets package is not installed; run 'pip install websockets'.")

    # Start concurrent background tasks:
    # Task 1: Listen to live ESP32 serial for Load Cell reading
    serial_task = asyncio.create_task(esp32_serial_listener(args.port, args.baud))

    # Task 2: Stream 4 sensors from Dataset / AI
    if args.demo:
        stream_task = asyncio.create_task(demo_generator_loop(ai_model))
    elif args.stream == "runtime" and os.path.exists(runtime_csv):
        stream_task = asyncio.create_task(csv_hybrid_stream_loop(runtime_csv, args.rate, ai_model))
    elif args.stream == "synthetic" and os.path.exists(synthetic_csv):
        stream_task = asyncio.create_task(csv_hybrid_stream_loop(synthetic_csv, args.rate, ai_model))
    else:
        stream_task = asyncio.create_task(demo_generator_loop(ai_model))

    await asyncio.gather(serial_task, stream_task)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("SENTRY Backend Bridge terminated by user.")

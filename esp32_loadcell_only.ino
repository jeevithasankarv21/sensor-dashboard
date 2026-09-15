/*
 * SENTRY CONVEYOR - DEDICATED LOAD CELL FIRMWARE (ESP32 + HX711)
 * 
 * Purpose:
 *   Reads live material weight/load from an HX711 strain gauge scale
 *   and streams it over USB Serial at 115200 baud to the SENTRY Dashboard.
 * 
 * Hardware Connections:
 *   HX711 DT (Data)   -> ESP32 GPIO 4
 *   HX711 SCK (Clock) -> ESP32 GPIO 16
 *   VCC               -> 5V (or 3.3V depending on module)
 *   GND               -> GND
 * 
 * Output Format (5 Hz):
 *   JSON: {"load_kg": 24.50}
 *   Compatible with Web Serial API (in browser) and Python backend_bridge.py
 */

#include "HX711.h"

// Pin Definitions
const int LOADCELL_DOUT_PIN = 4;
const int LOADCELL_SCK_PIN = 16;

HX711 scale;

// Calibration factor (Adjust based on your calibration weight)
// Example: If 1kg reads 2280 on raw scale, set CALIBRATION_FACTOR = 2280.0f
float calibration_factor = 2280.0f;

unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL_MS = 200; // 5Hz stream (every 200ms)

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n[SENTRY] ESP32 Load Cell Transmitter Initializing...");

  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);

  // Wait for HX711 to become ready (up to 3 seconds)
  unsigned long start = millis();
  while (!scale.is_ready() && millis() - start < 3000) {
    delay(100);
  }

  if (scale.is_ready()) {
    scale.set_scale(calibration_factor);
    scale.tare(); // Reset scale to 0 with no load
    Serial.println("[SENTRY] HX711 Ready. Tare complete. Streaming live load...");
  } else {
    Serial.println("[SENTRY] WARNING: HX711 not detected. Check GPIO 4 (DT) and GPIO 16 (SCK) wiring.");
  }
}

void loop() {
  // Check for commands from Serial (e.g. 't' or 'T' to tare/zero the scale)
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 't' || cmd == 'T') {
      scale.tare();
      Serial.println("{\"event\":\"tare_complete\"}");
    }
  }

  unsigned long now = millis();
  if (now - lastReadTime >= READ_INTERVAL_MS) {
    lastReadTime = now;

    float weightKg = 0.0f;

    if (scale.is_ready()) {
      weightKg = scale.get_units(2); // Average of 2 readings for noise reduction
      if (weightKg < 0.0f) {
        weightKg = 0.0f; // Discard negative drift
      }
    }

    // Output JSON packet for SENTRY Dashboard (Web Serial & Python bridge)
    Serial.print("{\"load_kg\":");
    Serial.print(weightKg, 2);
    Serial.println("}");
  }
}

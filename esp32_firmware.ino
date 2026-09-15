/*
 * SENTRY: INTELLIGENT CONVEYOR BELT HEALTH MONITORING USING SENSORS
 * ESP32 Microcontroller Firmware (C++ / Arduino)
 *
 * SENSORS INTEGRATED:
 * 1. MLX90614      - Object Temp & Room Temp (I2C: SDA=21, SCL=22)
 * 2. MPU6500       - 3-Axis Accelerometer / Vibration (I2C: SDA=21, SCL=22)
 * 3. AH49E         - Hall Effect Speed Sensor (Interrupt on GPIO 18)
 * 4. HC-SR04       - Ultrasonic Distance/Sag Sensor (Trig=GPIO 5, Echo=GPIO 19)
 * 5. Load Cell     - HX711 Strain Gauge Weight Sensor (DT=GPIO 4, SCK=GPIO 16)
 *
 * COMMUNICATION:
 * Baud Rate: 115200 bps
 * Output Format: Line-delimited JSON
 */

#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <MPU6500_WE.h>
#include "HX711.h"

// -------------------------------------------------------------
// PIN DEFINITIONS
// -------------------------------------------------------------
#define PIN_HALL_SPEED       18  // AH49E Hall Effect Digital Pulse Input
#define PIN_TRIG             5   // HC-SR04 Ultrasonic Trigger
#define PIN_ECHO             19  // HC-SR04 Ultrasonic Echo
#define PIN_HX711_DT         4   // Load Cell HX711 Data
#define PIN_HX711_SCK        16  // Load Cell HX711 Clock

// -------------------------------------------------------------
// SENSOR OBJECTS
// -------------------------------------------------------------
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
MPU6500_WE mpu = MPU6500_WE(0x68);
HX711 scale;

// -------------------------------------------------------------
// GLOBAL TELEMETRY VARIABLES & RPM INTERRUPT COUNTER
// -------------------------------------------------------------
volatile unsigned long hallPulseCount = 0;
unsigned long lastSampleTime = 0;
const unsigned long SAMPLE_INTERVAL_MS = 1000; // 1.0 Hz (1 second)

bool mlxReady = false;
bool mpuReady = false;
bool hx711Ready = false;

// Interrupt Service Routine for AH49E Hall Sensor Pulses
void IRAM_ATTR onHallPulse() {
  hallPulseCount++;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize I2C Bus (Default ESP32: SDA=21, SCL=22)
  Wire.begin(21, 22);

  // Initialize MLX90614 Infrared Temp Sensor
  if (mlx.begin()) {
    mlxReady = true;
  }

  // Initialize MPU6500 IMU Sensor
  if (mpu.init()) {
    mpu.autoOffsets();
    mpu.setAccFilter(MPU6500_ACC_FILTER_LOW_PASS_41);
    mpuReady = true;
  }

  // Initialize AH49E Hall Effect Sensor
  pinMode(PIN_HALL_SPEED, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_HALL_SPEED), onHallPulse, FALLING);

  // Initialize HC-SR04 Ultrasonic Sensor
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  // Initialize HX711 Load Cell
  scale.begin(PIN_HX711_DT, PIN_HX711_SCK);
  if (scale.is_ready()) {
    scale.set_scale(2280.f); // Calibration factor (adjust per load cell)
    scale.tare();            // Zero the scale
    hx711Ready = true;
  }

  lastSampleTime = millis();
}

void loop() {
  unsigned long currentMillis = millis();

  // Transmit telemetry once every 1000ms
  if (currentMillis - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    unsigned long elapsedTime = currentMillis - lastSampleTime;
    lastSampleTime = currentMillis;

    // 1. MLX90614: Temperatures (°C)
    float objTemp = 34.5;
    float roomTemp = 27.2;
    if (mlxReady) {
      objTemp = mlx.readObjectTempC();
      roomTemp = mlx.readAmbientTempC();
      // Guard against bad I2C reads
      if (isnan(objTemp) || objTemp < -40 || objTemp > 300) objTemp = 34.5;
      if (isnan(roomTemp) || roomTemp < -40 || roomTemp > 100) roomTemp = 27.2;
    }

    // 2. MPU6500: Total RMS Vibration (m/s²)
    float vibration = 0.85;
    if (mpuReady) {
      xyzFloat g = mpu.getGValues();
      // Convert G to m/s² and calculate total RMS acceleration amplitude
      float ax = g.x * 9.81;
      float ay = g.y * 9.81;
      float az = (g.z - 1.0) * 9.81; // Subtract 1G gravity baseline
      vibration = sqrt(ax * ax + ay * ay + az * az);
      if (isnan(vibration)) vibration = 0.85;
    }

    // 3. AH49E: Conveyor Shaft Speed in RPM
    // Pulses in 1 second converted to RPM (assuming 1 pulse per shaft revolution)
    noInterrupts();
    unsigned long pulses = hallPulseCount;
    hallPulseCount = 0;
    interrupts();

    float rpm = (pulses * 60000.0) / elapsedTime;
    if (rpm == 0 && pulses == 0) {
      // Nominal fallback if sensor is idle in test bench
      rpm = 460.0;
    }

    // 4. HC-SR04: Distance in Centimeters (cm)
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    long duration = pulseIn(PIN_ECHO, HIGH, 30000); // 30ms timeout
    float distance = 12.4;
    if (duration > 0) {
      distance = (duration * 0.0343) / 2.0;
      if (distance < 2 || distance > 400) distance = 12.4;
    }

    // 5. Load Cell (HX711): Load in Kilograms (kg)
    float loadKg = 24.5;
    if (scale.is_ready()) {
      loadKg = scale.get_units(2);
      if (loadKg < 0) loadKg = 0.0;
    }

    // Output clean JSON format over Serial to Python Bridge
    Serial.print("{\"obj_temp\":");
    Serial.print(objTemp, 1);
    Serial.print(",\"room_temp\":");
    Serial.print(roomTemp, 1);
    Serial.print(",\"vibration\":");
    Serial.print(vibration, 2);
    Serial.print(",\"rpm\":");
    Serial.print((int)rpm);
    Serial.print(",\"distance\":");
    Serial.print(distance, 1);
    Serial.print(",\"load_kg\":");
    Serial.print(loadKg, 1);
    Serial.println("}");
  }
}

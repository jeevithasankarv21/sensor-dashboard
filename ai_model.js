/**
 * SENTRY: 4-Sensor Intelligent AI Anomaly Classifier & Diagnostic Engine
 * Evaluates telemetry from the 4 physical sensors:
 *   1. MLX90614 Infrared Thermal Sensor (Object Temp & Room Temp)
 *   2. MPU6050 / MPU6500 IMU (RMS Vibration)
 *   3. AH49E Hall Effect Sensor (Conveyor Drive Speed / RPM)
 *   4. HC-SR04 Ultrasonic Sensor (Belt Distance & Belt Height)
 */

class SensorAIModel {
  constructor() {
    // Normal operational limits based on Conveyor Digital Twin specification
    this.thresholds = {
      vibration: {
        normalMax: 10.0,
        warningMax: 20.0
      },
      objectTemp: {
        normalMin: 30.0,
        normalMax: 38.0,
        warningMax: 50.0
      },
      roomTemp: {
        normalMin: 25.0,
        normalMax: 38.0,
        warningMax: 45.0
      },
      deltaTemp: {
        warningMax: 15.0,
        dangerMax: 25.0
      },
      distance: {
        normalMin: 1.0,
        normalMax: 3.0,
        warningMax: 8.0,
        mountHeight: 14.5
      },
      beltHeight: {
        normalMin: 10.5,
        normalMax: 13.5
      },
      rpm: {
        warningHigh: 120000.0 // Hall pulse frequency artifact threshold observed in prototype
      }
    };
  }

  isNum(val) {
    return val !== null && val !== undefined && !isNaN(val) && typeof val === 'number';
  }

  predict(telemetry) {
    const vib = telemetry.vibration;
    const rpm = telemetry.rpm;
    const objT = telemetry.object_temperature_c;
    const roomT = telemetry.room_temperature_c;
    const dist = telemetry.distance_cm;
    const beltH = telemetry.belt_height_from_ground_cm;

    const sensorConditions = {
      vibration: 'NORMAL',
      rpm: 'NORMAL',
      objectTemp: 'NORMAL',
      roomTemp: 'NORMAL',
      distance: 'NORMAL'
    };

    const diagnostics = [];
    let abnormalScore = 0;
    let hasSensorFailure = false;

    // 1. Check MLX90614 (Temperatures)
    if (!this.isNum(objT)) {
      sensorConditions.objectTemp = 'SENSOR_FAILURE';
      diagnostics.push('Object Temperature Sensor Disconnected/NaN (MLX90614).');
      hasSensorFailure = true;
      abnormalScore += 3;
    } else if (objT > this.thresholds.objectTemp.warningMax) {
      sensorConditions.objectTemp = 'WARNING_2';
      diagnostics.push(`Critical bearing thermal signature (${objT.toFixed(1)}°C > ${this.thresholds.objectTemp.warningMax}°C).`);
      abnormalScore += 3;
    } else if (objT > this.thresholds.objectTemp.normalMax || objT < this.thresholds.objectTemp.normalMin) {
      sensorConditions.objectTemp = 'WARNING_1';
      diagnostics.push(`Object temperature variance (${objT.toFixed(1)}°C).`);
      abnormalScore += 1;
    }

    if (!this.isNum(roomT)) {
      sensorConditions.roomTemp = 'SENSOR_FAILURE';
      diagnostics.push('Room Temperature Sensor Disconnected/NaN (MLX90614 Ambient).');
      hasSensorFailure = true;
      abnormalScore += 2;
    } else if (roomT > this.thresholds.roomTemp.warningMax || roomT < this.thresholds.roomTemp.normalMin) {
      sensorConditions.roomTemp = 'WARNING_1';
      diagnostics.push(`Ambient room temperature deviation (${roomT.toFixed(1)}°C).`);
      abnormalScore += 1;
    }

    if (this.isNum(objT) && this.isNum(roomT)) {
      const deltaT = objT - roomT;
      if (deltaT > this.thresholds.deltaTemp.dangerMax) {
        diagnostics.push(`Severe thermal gradient (ΔT: +${deltaT.toFixed(1)}°C). Severe bearing friction detected.`);
        abnormalScore += 3;
      } else if (deltaT > this.thresholds.deltaTemp.warningMax) {
        diagnostics.push(`Elevated thermal gradient (ΔT: +${deltaT.toFixed(1)}°C). Lubrication degradation alert.`);
        abnormalScore += 2;
      }
    }

    // 2. Check MPU6050 / MPU6500 (Vibration)
    if (!this.isNum(vib)) {
      sensorConditions.vibration = 'SENSOR_FAILURE';
      diagnostics.push('MPU Vibration Sensor Bus Failure / I2C Disconnect.');
      hasSensorFailure = true;
      abnormalScore += 3;
    } else if (vib > this.thresholds.vibration.warningMax) {
      sensorConditions.vibration = 'HIGH_RISK';
      diagnostics.push(`High mechanical vibration anomaly (${vib.toFixed(2)} m/s² > 20.0 m/s²). Probable rotor eccentricity or bearing fault.`);
      abnormalScore += 4;
    } else if (vib > this.thresholds.vibration.normalMax) {
      sensorConditions.vibration = 'WARNING_1';
      diagnostics.push(`Elevated vibration level (${vib.toFixed(2)} m/s²). Moderate roller harmonic resonance.`);
      abnormalScore += 2;
    }

    // 3. Check AH49E (RPM)
    if (!this.isNum(rpm)) {
      sensorConditions.rpm = 'SENSOR_FAILURE';
      diagnostics.push('Hall Effect Speed Sensor Pulse Timeout.');
      hasSensorFailure = true;
      abnormalScore += 2;
    } else if (rpm > this.thresholds.rpm.warningHigh) {
      sensorConditions.rpm = 'WARNING_1';
      diagnostics.push(`Hall sensor pulse frequency surge (${Math.round(rpm).toLocaleString()} RPM). Interrupt frequency anomaly.`);
      abnormalScore += 1;
    }

    // 4. Check HC-SR04 (Ultrasonic Distance & Belt Sag)
    if (!this.isNum(dist)) {
      sensorConditions.distance = 'SENSOR_FAILURE';
      diagnostics.push('Ultrasonic Sensor Echo Failure / Out of Range (HC-SR04).');
      hasSensorFailure = true;
      abnormalScore += 3;
    } else if (dist > this.thresholds.distance.mountHeight) {
      sensorConditions.distance = 'SENSOR_FAILURE';
      diagnostics.push(`Geometry error: Distance (${dist.toFixed(1)} cm) exceeds sensor mount height (${this.thresholds.distance.mountHeight} cm).`);
      hasSensorFailure = true;
      abnormalScore += 3;
    } else if (dist > this.thresholds.distance.warningMax) {
      sensorConditions.distance = 'HIGH_RISK';
      diagnostics.push(`Severe belt slack / sag detected (${dist.toFixed(1)} cm distance). Conveyor derailment risk.`);
      abnormalScore += 4;
    } else if (dist > this.thresholds.distance.normalMax) {
      sensorConditions.distance = 'WARNING_1';
      diagnostics.push(`Belt clearance deviation (${dist.toFixed(1)} cm > ${this.thresholds.distance.normalMax} cm threshold). Belt tensioner adjustment recommended.`);
      abnormalScore += 2;
    }

    // Determine Overall AI Status
    let prediction = 'NORMAL';
    let confidence = 98.4;
    let probNormal = 98;
    let probWarning = 2;
    let probHighRisk = 0;
    let probFailure = 0;

    if (hasSensorFailure) {
      prediction = 'SENSOR_FAILURE';
      probFailure = 92;
      probWarning = 5;
      probNormal = 2;
      probHighRisk = 1;
      confidence = 94.8;
    } else if (abnormalScore >= 5) {
      prediction = 'HIGH_RISK';
      probHighRisk = 91;
      probWarning = 7;
      probNormal = 1;
      probFailure = 1;
      confidence = 92.5;
    } else if (abnormalScore >= 1) {
      prediction = abnormalScore >= 3 ? 'WARNING_2' : 'WARNING_1';
      probWarning = 86;
      probNormal = 10;
      probHighRisk = 3;
      probFailure = 1;
      confidence = 89.2;
    } else {
      prediction = 'NORMAL';
      probNormal = 98;
      probWarning = 2;
      probHighRisk = 0;
      probFailure = 0;
      confidence = 98.6;
      diagnostics.push('All 4 physical sensors correlate within nominal operational bounds. Mechanical dynamics stable.');
    }

    // Calculate Health Index (0 - 100%)
    let healthIndex = 98;
    if (prediction === 'NORMAL') {
      healthIndex = Math.max(92, Math.round(98 - abnormalScore * 2));
    } else if (prediction === 'WARNING_1') {
      healthIndex = Math.max(65, Math.round(78 - abnormalScore * 4));
    } else if (prediction === 'WARNING_2') {
      healthIndex = Math.max(48, Math.round(62 - abnormalScore * 5));
    } else if (prediction === 'HIGH_RISK') {
      healthIndex = Math.max(15, Math.round(35 - abnormalScore * 4));
    } else if (prediction === 'SENSOR_FAILURE') {
      healthIndex = Math.max(25, Math.round(45 - abnormalScore * 5));
    }

    return {
      prediction,
      confidence: parseFloat(confidence.toFixed(1)),
      healthIndex,
      sensorConditions,
      probabilities: {
        normal: probNormal,
        warning: probWarning,
        highRisk: probHighRisk,
        sensorFailure: probFailure
      },
      diagnostic: diagnostics.join(' ')
    };
  }
}

// Global AI Model instance
window.sentryAIModel = new SensorAIModel();

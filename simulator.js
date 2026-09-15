/**
 * SENTRY: Conveyor Health Monitoring - Sensor Simulation Engine (4 Physical Sensors)
 * Generates realistic physical telemetry and executes multi-sensor AI inference.
 */

class SensorSimulator {
  constructor() {
    this.currentScenario = 'normal';
    this.step = 0;

    // Baselines matching physical prototype (runtime_data.csv)
    this.baseline = {
      objTemp: 32.1,
      roomTemp: 32.3,
      vibration: 2.5,
      rpm: 460,
      distance: 2.8,
      beltHeight: 11.7 // Mount height 14.5 - 2.8 = 11.7 cm
    };
  }

  setScenario(scenarioName) {
    this.currentScenario = scenarioName;
    this.step = 0;
  }

  // Gaussian-like small random fluctuation
  jitter(amount) {
    return (Math.random() - 0.5) * 2 * amount;
  }

  generateTelemetry() {
    this.step++;
    const s = this.currentScenario;
    const j = this.jitter.bind(this);

    let objTemp = this.baseline.objTemp + j(0.3);
    let roomTemp = this.baseline.roomTemp + j(0.15);
    let vibration = this.baseline.vibration + j(0.2);
    let rpm = this.baseline.rpm + j(12);
    let distance = this.baseline.distance + j(0.15);

    // Dynamic scenario mutations
    switch (s) {
      case 'bearing_temp':
        // Object temperature ramps up significantly (bearing friction / overheat)
        objTemp = 52.5 + j(1.2) + Math.min(15, this.step * 0.5);
        vibration = 6.8 + j(0.4);
        rpm = 440 + j(15);
        break;

      case 'high_vibration':
        // Severe mechanical vibration (bearing failure, roller imbalance)
        vibration = 22.4 + j(2.0) + Math.sin(this.step * 0.5) * 3.0;
        objTemp = 38.0 + j(0.8);
        rpm = 430 + j(20);
        break;

      case 'conveyor_jam':
        // Drive shaft slipping or belt jam (low RPM)
        rpm = Math.max(0, 80 + j(25) - this.step * 5);
        vibration = 5.4 + j(0.5);
        objTemp = 36.0 + j(0.6);
        break;

      case 'belt_sag':
        // Ultrasonic distance spikes due to belt slack / sag
        distance = 6.4 + j(0.5);
        rpm = 450 + j(8);
        break;

      case 'normal':
      default:
        // Nominal steady state
        break;
    }

    // Bound values to realistic physical constraints
    objTemp = Math.max(15, Math.min(120, objTemp));
    roomTemp = Math.max(15, Math.min(45, roomTemp));
    vibration = Math.max(0.1, vibration);
    rpm = Math.max(0, rpm);
    distance = Math.max(0.5, distance);

    const deltaTemp = objTemp - roomTemp;
    const beltHeight = Math.max(0, 14.5 - distance);
    const beltVelocity = (rpm * 0.00314).toFixed(2);

    // Compute IMU 3-Axis breakdown from total RMS vibration
    const vibX = (vibration * 0.32 + j(0.04)).toFixed(2);
    const vibY = (vibration * 0.38 + j(0.04)).toFixed(2);
    const vibZ = (vibration * 0.86 + j(0.08)).toFixed(2);

    // Compute individual sensor statuses
    const statusTemp = (objTemp > 50 || deltaTemp > 25) ? 'DANGER' : (objTemp > 38 || deltaTemp > 15) ? 'WARNING' : 'NORMAL';
    const statusVib = (vibration > 20.0) ? 'DANGER' : (vibration > 10.0) ? 'WARNING' : 'NORMAL';
    const statusRPM = (rpm === 0) ? 'DANGER' : (rpm > 120000) ? 'WARNING' : 'NORMAL';
    const statusDist = (distance > 8.0) ? 'DANGER' : (distance > 3.0) ? 'WARNING' : 'NORMAL';

    // Run AI inference using central SensorAIModel
    const mlResult = window.sentryAIModel ? window.sentryAIModel.predict({
      vibration,
      rpm,
      object_temperature_c: objTemp,
      room_temperature_c: roomTemp,
      distance_cm: distance,
      belt_height_from_ground_cm: beltHeight
    }) : {
      prediction: (statusTemp === 'DANGER' || statusVib === 'DANGER') ? 'HIGH_RISK' : (statusTemp === 'WARNING' || statusVib === 'WARNING' || statusDist === 'WARNING') ? 'WARNING_1' : 'NORMAL',
      confidence: 96.4,
      healthIndex: 95,
      diagnostic: 'Telemetry stable.',
      probabilities: { normal: 96, warning: 3, highRisk: 1, sensorFailure: 0 }
    };

    return {
      timestamp: new Date().toLocaleTimeString(),
      datasetInfo: {
        type: 'simulator',
        index: this.step,
        total: 'Continuous',
        groundTruthStatus: mlResult.prediction,
        alerts: s !== 'normal' ? `${s.toUpperCase()}_SIMULATED` : 'NONE'
      },
      sensors: {
        mlx90614: {
          objTemp: parseFloat(objTemp.toFixed(1)),
          roomTemp: parseFloat(roomTemp.toFixed(1)),
          deltaTemp: parseFloat(deltaTemp.toFixed(1)),
          status: statusTemp
        },
        mpu6500: {
          vibration: parseFloat(vibration.toFixed(2)),
          axisX: parseFloat(vibX),
          axisY: parseFloat(vibY),
          axisZ: parseFloat(vibZ),
          status: statusVib
        },
        ah49e: {
          rpm: Math.round(rpm),
          velocity: parseFloat(beltVelocity),
          slipRatio: (rpm === 0 ? '100% (Stall)' : '1.2%'),
          status: statusRPM
        },
        hcsr04: {
          distance: parseFloat(distance.toFixed(1)),
          sag: (distance > 3.0 ? (distance - 2.5).toFixed(1) + ' cm (Sag Detected)' : '0.4 cm (Nominal)'),
          beltHeight: parseFloat(beltHeight.toFixed(1)),
          status: statusDist
        }
      },
      ml: mlResult,
      overall: {
        status: mlResult.prediction,
        healthIndex: mlResult.healthIndex
      },
      rawAlerts: s !== 'normal' ? `FAULT_SIMULATOR=${s.toUpperCase()}` : 'NONE'
    };
  }
}

// Global instance
window.sentrySimulator = new SensorSimulator();

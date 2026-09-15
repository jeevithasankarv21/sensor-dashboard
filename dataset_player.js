/**
 * SENTRY: Dataset Playback & Telemetry Stream Manager
 * Replays live telemetry recorded from the 4 physical sensors
 * Supports runtime_data.csv, synthetic_data.csv, and custom user CSV uploads.
 */

class DatasetPlayer {
  constructor() {
    this.activeDatasetName = 'runtime'; // 'runtime' | 'synthetic' | 'custom'
    this.dataset = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.playbackSpeed = 1.0; // Multiplier (1x = 1000ms)
    this.baseIntervalMs = 1000;
    this.timer = null;
    this.loop = true;
    this.onTickCallback = null;

    // Load default dataset
    this.setDataset('runtime');
  }

  setDataset(datasetType, customRecords = null) {
    this.pause();
    this.activeDatasetName = datasetType;
    this.currentIndex = 0;

    if (datasetType === 'runtime') {
      this.dataset = window.RUNTIME_DATASET || [];
    } else if (datasetType === 'synthetic') {
      this.dataset = window.SYNTHETIC_DATASET || [];
    } else if (datasetType === 'custom' && customRecords) {
      this.dataset = customRecords;
    }

    console.log(`[DatasetPlayer] Switched to dataset: ${datasetType} (${this.dataset.length} samples)`);
    this.updatePlayerUI();
  }

  play() {
    if (this.isPlaying) return;
    if (!this.dataset || this.dataset.length === 0) return;

    this.isPlaying = true;
    this.scheduleNextTick();
    this.updatePlayPauseUI();
  }

  pause() {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.updatePlayPauseUI();
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  setSpeed(multiplier) {
    this.playbackSpeed = multiplier;
    if (this.isPlaying) {
      if (this.timer) clearTimeout(this.timer);
      this.scheduleNextTick();
    }
    this.updateSpeedUI();
  }

  scheduleNextTick() {
    if (!this.isPlaying) return;
    const interval = Math.max(50, Math.round(this.baseIntervalMs / this.playbackSpeed));
    this.timer = setTimeout(() => {
      this.stepForward();
      if (this.isPlaying) {
        this.scheduleNextTick();
      }
    }, interval);
  }

  stepForward() {
    if (!this.dataset || this.dataset.length === 0) return;
    this.currentIndex++;

    if (this.currentIndex >= this.dataset.length) {
      if (this.loop) {
        this.currentIndex = 0;
      } else {
        this.currentIndex = this.dataset.length - 1;
        this.pause();
        return;
      }
    }

    this.processCurrentSample();
  }

  stepBackward() {
    if (!this.dataset || this.dataset.length === 0) return;
    this.currentIndex = Math.max(0, this.currentIndex - 1);
    this.processCurrentSample();
  }

  seek(index) {
    if (!this.dataset || this.dataset.length === 0) return;
    this.currentIndex = Math.max(0, Math.min(this.dataset.length - 1, index));
    this.processCurrentSample();
  }

  toggleLoop() {
    this.loop = !this.loop;
    const loopBtn = document.getElementById('btnPlayerLoop');
    if (loopBtn) {
      loopBtn.classList.toggle('active', this.loop);
      loopBtn.title = this.loop ? 'Loop: ON' : 'Loop: OFF';
    }
  }

  processCurrentSample() {
    if (!this.dataset || this.dataset.length === 0) return;
    const raw = this.dataset[this.currentIndex];
    if (!raw) return;

    // Convert raw dataset record to standard SENTRY telemetry packet
    const telemetry = this.convertRecordToTelemetry(raw);

    // Update player UI progress
    this.updatePlayerUI();

    // Notify listener
    if (this.onTickCallback) {
      this.onTickCallback(telemetry);
    }
  }

  convertRecordToTelemetry(raw) {
    const vib = raw.vibration !== null && raw.vibration !== undefined ? parseFloat(raw.vibration) : null;
    const rpm = raw.rpm !== null && raw.rpm !== undefined ? parseFloat(raw.rpm) : null;
    const objT = raw.object_temperature_c !== null && raw.object_temperature_c !== undefined ? parseFloat(raw.object_temperature_c) : null;
    const roomT = raw.room_temperature_c !== null && raw.room_temperature_c !== undefined ? parseFloat(raw.room_temperature_c) : null;
    const dist = raw.distance_cm !== null && raw.distance_cm !== undefined ? parseFloat(raw.distance_cm) : null;
    let beltH = raw.belt_height_from_ground_cm !== null && raw.belt_height_from_ground_cm !== undefined ? parseFloat(raw.belt_height_from_ground_cm) : null;

    // Calculate belt height if missing from mount height reference (14.5 cm)
    if (beltH === null && dist !== null) {
      beltH = Math.max(0, 14.5 - dist);
    }

    const deltaT = (objT !== null && roomT !== null) ? parseFloat((objT - roomT).toFixed(1)) : null;
    const velocity = (rpm !== null) ? parseFloat((rpm * 0.00314).toFixed(2)) : 0.0;

    // Evaluate with 4-sensor AI Anomaly Classifier
    const aiInference = window.sentryAIModel ? window.sentryAIModel.predict({
      vibration: vib,
      rpm: rpm,
      object_temperature_c: objT,
      room_temperature_c: roomT,
      distance_cm: dist,
      belt_height_from_ground_cm: beltH
    }) : {
      prediction: raw.overall_status || raw.status || 'NORMAL',
      confidence: 96.0,
      healthIndex: 95,
      sensorConditions: {},
      probabilities: { normal: 95, warning: 5, highRisk: 0, sensorFailure: 0 },
      diagnostic: 'All 4 sensors operating within range.'
    };

    // Sensor status mappings
    const mapConditionToStatus = (cond, defaultStatus) => {
      if (!cond) return defaultStatus;
      const c = String(cond).toUpperCase();
      if (c.includes('FAIL')) return 'SENSOR_FAILURE';
      if (c.includes('DANGER') || c.includes('HIGH_RISK')) return 'DANGER';
      if (c.includes('WARN')) return 'WARNING';
      return 'NORMAL';
    };

    const statusTemp = mapConditionToStatus(raw.object_temperature_condition, aiInference.sensorConditions?.objectTemp || 'NORMAL');
    const statusVib = mapConditionToStatus(raw.vibration_condition, aiInference.sensorConditions?.vibration || 'NORMAL');
    const statusRPM = mapConditionToStatus(raw.rpm_condition, aiInference.sensorConditions?.rpm || 'NORMAL');
    const statusDist = mapConditionToStatus(raw.distance_condition, aiInference.sensorConditions?.distance || 'NORMAL');

    const overallGroundTruth = raw.overall_status || raw.status || aiInference.prediction;

    // Calculate sag text
    let sagText = '0.4 cm (Nominal)';
    if (dist === null) {
      sagText = 'Sensor Disconnected';
    } else if (dist > 3.0) {
      sagText = `${(dist - 2.5).toFixed(1)} cm (Sag Detected)`;
    } else if (dist < 1.0) {
      sagText = 'Belt Lift / Contact';
    }

    const timeString = new Date().toLocaleTimeString();

    return {
      timestamp: timeString,
      datasetInfo: {
        type: this.activeDatasetName,
        index: this.currentIndex + 1,
        total: this.dataset.length,
        rawTimestamp: raw.timestamp,
        groundTruthStatus: overallGroundTruth,
        alerts: raw.alerts || 'NONE'
      },
      sensors: {
        mlx90614: {
          objTemp: objT !== null ? parseFloat(objT.toFixed(1)) : null,
          roomTemp: roomT !== null ? parseFloat(roomT.toFixed(1)) : null,
          deltaTemp: deltaT,
          condition: raw.object_temperature_condition || 'NORMAL',
          status: statusTemp
        },
        mpu6500: {
          vibration: vib !== null ? parseFloat(vib.toFixed(2)) : null,
          axisX: vib !== null ? parseFloat((vib * 0.32).toFixed(2)) : null,
          axisY: vib !== null ? parseFloat((vib * 0.38).toFixed(2)) : null,
          axisZ: vib !== null ? parseFloat((vib * 0.86).toFixed(2)) : null,
          condition: raw.vibration_condition || 'NORMAL',
          status: statusVib
        },
        ah49e: {
          rpm: rpm !== null ? Math.round(rpm) : null,
          velocity: velocity,
          slipRatio: (rpm === 0) ? '100% (Stall)' : (rpm > 120000 ? 'Freq Surge' : '1.2%'),
          condition: raw.rpm_condition || 'NORMAL',
          status: statusRPM
        },
        hcsr04: {
          distance: dist !== null ? parseFloat(dist.toFixed(1)) : null,
          beltHeight: beltH !== null ? parseFloat(beltH.toFixed(1)) : null,
          sag: sagText,
          condition: raw.distance_condition || 'NORMAL',
          status: statusDist
        },
        loadCell: {
          load: (window.liveESP32Load !== undefined && window.liveESP32Load !== null) ? parseFloat(Number(window.liveESP32Load).toFixed(1)) : 0.0,
          capacityPct: (window.liveESP32Load !== undefined && window.liveESP32Load !== null) ? parseFloat(((Number(window.liveESP32Load) / 100.0) * 100).toFixed(1)) : 0.0,
          status: (window.liveESP32Load > 85 ? 'DANGER' : (window.liveESP32Load > 60 ? 'WARNING' : 'NORMAL')),
          source: (window.esp32HardwareConnected ? 'ESP32_LIVE' : 'STANDBY')
        }
      },
      ml: aiInference,
      overall: {
        status: aiInference.prediction,
        healthIndex: aiInference.healthIndex,
        groundTruth: overallGroundTruth
      },
      rawAlerts: raw.alerts || 'NONE'
    };
  }

  // Parse custom uploaded CSV text
  parseCSVText(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      const row = {};

      headers.forEach((h, idx) => {
        let val = values[idx];
        if (val === undefined || val === '' || val.toLowerCase() === 'null' || val.toLowerCase() === 'nan') {
          val = null;
        } else {
          const num = Number(val);
          if (!isNaN(num)) val = num;
        }
        row[h] = val;
      });

      records.push(row);
    }

    return records;
  }

  loadCustomFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const records = this.parseCSVText(text);
        if (records.length > 0) {
          this.setDataset('custom', records);
          this.processCurrentSample();
          console.log(`[DatasetPlayer] Successfully loaded custom CSV with ${records.length} rows.`);
        } else {
          alert('Could not parse valid CSV records from this file.');
        }
      } catch (err) {
        console.error('Error reading CSV:', err);
        alert('Error reading CSV file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  updatePlayerUI() {
    if (typeof document === 'undefined') return;
    const currentEl = document.getElementById('playerCurrentIndex');
    const totalEl = document.getElementById('playerTotalCount');
    const sliderEl = document.getElementById('playerTimelineSlider');
    const badgeEl = document.getElementById('playerDatasetBadge');
    const rawTimeEl = document.getElementById('playerRawTimestamp');

    const total = this.dataset ? this.dataset.length : 0;
    const cur = total > 0 ? this.currentIndex + 1 : 0;

    if (currentEl) currentEl.textContent = cur;
    if (totalEl) totalEl.textContent = total;

    if (sliderEl) {
      sliderEl.max = Math.max(0, total - 1);
      sliderEl.value = this.currentIndex;
    }

    if (badgeEl) {
      if (this.activeDatasetName === 'runtime') {
        badgeEl.textContent = 'runtime_data.csv (Physical Prototype)';
        badgeEl.className = 'player-badge badge-runtime';
      } else if (this.activeDatasetName === 'synthetic') {
        badgeEl.textContent = 'synthetic_data.csv (Benchmark)';
        badgeEl.className = 'player-badge badge-synthetic';
      } else {
        badgeEl.textContent = 'Custom Uploaded CSV';
        badgeEl.className = 'player-badge badge-custom';
      }
    }

    if (rawTimeEl && this.dataset && this.dataset[this.currentIndex]) {
      const rawT = this.dataset[this.currentIndex].timestamp;
      rawTimeEl.textContent = rawT !== undefined ? `T: ${rawT} ms` : '';
    }
  }

  updatePlayPauseUI() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('btnPlayerPlay');
    if (btn) {
      btn.innerHTML = this.isPlaying
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Play';
      btn.classList.toggle('btn-playing', this.isPlaying);
    }
  }

  updateSpeedUI() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.speed-btn').forEach(btn => {
      const spd = parseFloat(btn.getAttribute('data-speed'));
      btn.classList.toggle('active', spd === this.playbackSpeed);
    });
  }
}

// Global Dataset Player instance
window.sentryPlayer = new DatasetPlayer();

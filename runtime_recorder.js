/**
 * SENTRY: 5-Sensor Runtime Data Acquisition Engine
 * 
 * Captures, buffers, and exports live runtime telemetry across all 5 sensors:
 *   1. MLX90614 Infrared Temp (Object & Room °C)
 *   2. MPU6050 / MPU6500 IMU (Vibration RMS m/s², X, Y, Z)
 *   3. AH49E Hall Effect Speed (RPM & Belt Velocity m/s)
 *   4. HC-SR04 Ultrasonic Sensor (Distance & Belt Height cm)
 *   5. HX711 Load Cell (Material Load kg)
 * 
 * Export format: Standard CSV strictly matching runtime_data.csv for AI/ML models.
 */

class RuntimeDataRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.recordedRows = [];
    this.maxRows = 10000;
    this.source = 'hybrid'; // 'hybrid', 'esp32', 'simulator'
    this.samplingRateMs = 1000; // default 1 Hz (1000ms)
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.timer = null;
    this.recordTimer = null;
    this.latestPacket = null;
    this.baseTimestamp = 1000;

    // Default nominal fallback in case sensors haven't ticked yet
    this.currentSensorState = {
      timestamp: 1000,
      vibration: 0.85,
      rpm: 460.0,
      object_temperature_c: 32.5,
      room_temperature_c: 27.2,
      distance_cm: 2.8,
      belt_height_from_ground_cm: 11.2,
      load_kg: 24.5,
      vibration_condition: 'NORMAL',
      rpm_condition: 'NORMAL',
      object_temperature_condition: 'NORMAL',
      room_temperature_condition: 'NORMAL',
      distance_condition: 'NORMAL',
      load_condition: 'NORMAL',
      overall_status: 'NORMAL',
      alerts: 'NONE'
    };
  }

  /**
   * Called on every telemetry tick from dashboard dispatcher
   */
  processTelemetry(packet) {
    if (!packet || !packet.sensors) return;
    this.latestPacket = packet;

    const s = packet.sensors;
    const ml = packet.ml || {};
    const overall = packet.overall || {};

    const objT = s.mlx90614?.objTemp ?? 32.5;
    const roomT = s.mlx90614?.roomTemp ?? 27.2;
    const vib = s.mpu6500?.vibration ?? 0.85;
    const rpm = s.ah49e?.rpm ?? 460.0;
    const dist = s.hcsr04?.distance ?? 2.8;
    const beltH = s.hcsr04?.beltHeight ?? (dist ? parseFloat((14.0 - dist).toFixed(2)) : 11.2);
    const load = s.loadCell?.load ?? (window.liveESP32Load || 24.5);

    this.currentSensorState = {
      timestamp: Date.now(),
      vibration: parseFloat(vib.toFixed(4)),
      rpm: parseFloat(rpm.toFixed(2)),
      object_temperature_c: parseFloat(objT.toFixed(2)),
      room_temperature_c: parseFloat(roomT.toFixed(2)),
      distance_cm: parseFloat(dist.toFixed(2)),
      belt_height_from_ground_cm: parseFloat(beltH.toFixed(2)),
      load_kg: parseFloat(load.toFixed(2)),
      vibration_condition: s.mpu6500?.status || 'NORMAL',
      rpm_condition: s.ah49e?.status || 'NORMAL',
      object_temperature_condition: s.mlx90614?.status || 'NORMAL',
      room_temperature_condition: s.mlx90614?.status || 'NORMAL',
      distance_condition: s.hcsr04?.status || 'NORMAL',
      load_condition: s.loadCell?.status || 'NORMAL',
      overall_status: overall.status || 'NORMAL',
      alerts: packet.rawAlerts || (ml.diagnostics && ml.diagnostics[0]) || 'NONE'
    };
  }

  /**
   * Start or resume recording runtime data
   */
  startRecording() {
    if (this.isRecording && !this.isPaused) return;

    if (!this.isPaused) {
      this.startTime = Date.now() - (this.elapsedSeconds * 1000);
    }
    this.isRecording = true;
    this.isPaused = false;

    // UI state update
    this.updateUIState();

    // Elapsed time ticker
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      this.updateTimerDisplay();
    }, 500);

    // Record sampling ticker
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.recordTimer = setInterval(() => {
      this.captureSample();
    }, this.samplingRateMs);

    // Capture initial sample immediately
    this.captureSample();
    console.log(`[SENTRY RECORDER] Started recording 5-sensor runtime data at ${1000 / this.samplingRateMs} Hz`);
  }

  /**
   * Pause recording without losing data
   */
  pauseRecording() {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    if (this.timer) clearInterval(this.timer);
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.updateUIState();
    console.log(`[SENTRY RECORDER] Recording paused. Total samples: ${this.recordedRows.length}`);
  }

  /**
   * Stop recording
   */
  stopRecording() {
    this.isRecording = false;
    this.isPaused = false;
    if (this.timer) clearInterval(this.timer);
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.updateUIState();
    console.log(`[SENTRY RECORDER] Recording stopped. Captured ${this.recordedRows.length} samples.`);
  }

  /**
   * Capture a single runtime sample row
   */
  captureSample() {
    if (!this.isRecording || this.isPaused) return;

    const sampleIdx = this.recordedRows.length + 1;
    const runtimeMs = this.baseTimestamp + (this.recordedRows.length * this.samplingRateMs);

    // Deep copy current state
    const row = {
      sample_id: sampleIdx,
      timestamp: runtimeMs,
      vibration: this.currentSensorState.vibration,
      rpm: this.currentSensorState.rpm,
      object_temperature_c: this.currentSensorState.object_temperature_c,
      room_temperature_c: this.currentSensorState.room_temperature_c,
      distance_cm: this.currentSensorState.distance_cm,
      belt_height_from_ground_cm: this.currentSensorState.belt_height_from_ground_cm,
      load_kg: this.currentSensorState.load_kg,
      vibration_condition: this.currentSensorState.vibration_condition,
      rpm_condition: this.currentSensorState.rpm_condition,
      object_temperature_condition: this.currentSensorState.object_temperature_condition,
      room_temperature_condition: this.currentSensorState.room_temperature_condition,
      distance_condition: this.currentSensorState.distance_condition,
      load_condition: this.currentSensorState.load_condition,
      overall_status: this.currentSensorState.overall_status,
      alerts: this.currentSensorState.alerts
    };

    this.recordedRows.push(row);
    if (this.recordedRows.length > this.maxRows) {
      this.recordedRows.shift();
    }

    this.updateCounterDisplay();
    this.appendTableRow(row);
  }

  /**
   * Set sampling rate
   */
  setSamplingRate(ms) {
    this.samplingRateMs = ms;
    if (this.isRecording && !this.isPaused) {
      if (this.recordTimer) clearInterval(this.recordTimer);
      this.recordTimer = setInterval(() => this.captureSample(), this.samplingRateMs);
    }
  }

  /**
   * Clear all captured samples
   */
  clearData() {
    if (confirm('Are you sure you want to clear all recorded runtime samples?')) {
      this.recordedRows = [];
      this.elapsedSeconds = 0;
      this.startTime = Date.now();
      this.updateCounterDisplay();
      this.updateTimerDisplay();
      const tbody = document.getElementById('recTableBody');
      if (tbody) tbody.innerHTML = '<tr class="rec-empty-row"><td colspan="10">No runtime data captured yet. Click "Start Recording" to take live samples.</td></tr>';
    }
  }

  /**
   * Export captured data to CSV (Strictly compatible with runtime_data.csv)
   */
  exportCSV() {
    if (this.recordedRows.length === 0) {
      alert('No runtime data has been captured yet! Please click "Start Recording" first.');
      return;
    }

    const headers = [
      'timestamp',
      'vibration',
      'rpm',
      'object_temperature_c',
      'room_temperature_c',
      'distance_cm',
      'belt_height_from_ground_cm',
      'load_kg',
      'vibration_condition',
      'rpm_condition',
      'object_temperature_condition',
      'room_temperature_condition',
      'distance_condition',
      'load_condition',
      'overall_status',
      'alerts'
    ];

    const lines = [headers.join(',')];

    for (const r of this.recordedRows) {
      const line = [
        r.timestamp,
        r.vibration,
        r.rpm,
        r.object_temperature_c,
        r.room_temperature_c,
        r.distance_cm,
        r.belt_height_from_ground_cm,
        r.load_kg,
        r.vibration_condition,
        r.rpm_condition,
        r.object_temperature_condition,
        r.room_temperature_condition,
        r.distance_condition,
        r.load_condition,
        r.overall_status,
        `"${(r.alerts || 'NONE').replace(/"/g, '""')}"`
      ];
      lines.push(line.join(','));
    }

    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `runtime_data_5sensors_${dateStr}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`[SENTRY RECORDER] Exported ${this.recordedRows.length} rows to ${filename}`);
  }

  /**
   * Instantly load the captured runtime dataset into the dashboard player
   */
  loadIntoDashboard() {
    if (this.recordedRows.length === 0) {
      alert('No runtime data has been captured yet. Record some samples first!');
      return;
    }

    if (!window.sentryPlayer) {
      alert('Dashboard player not initialized.');
      return;
    }

    // Convert recorded rows into player records
    const records = this.recordedRows.map(r => ({
      timestamp: String(r.timestamp),
      vibration: String(r.vibration),
      rpm: String(r.rpm),
      object_temperature_c: String(r.object_temperature_c),
      room_temperature_c: String(r.room_temperature_c),
      distance_cm: String(r.distance_cm),
      belt_height_from_ground_cm: String(r.belt_height_from_ground_cm),
      load_kg: String(r.load_kg),
      vibration_condition: r.vibration_condition,
      rpm_condition: r.rpm_condition,
      object_temperature_condition: r.object_temperature_condition,
      room_temperature_condition: r.room_temperature_condition,
      distance_condition: r.distance_condition,
      overall_status: r.overall_status,
      alerts: r.alerts
    }));

    window.sentryPlayer.setCustomRecords(records, `Captured Runtime (${records.length} samples)`);
    setDataSourceMode('custom');
    closeRuntimeDataRecorder();
  }

  /**
   * UI: Append a new row to the table in real-time
   */
  appendTableRow(row) {
    const tbody = document.getElementById('recTableBody');
    if (!tbody) return;

    // Remove empty row placeholder if present
    const emptyRow = tbody.querySelector('.rec-empty-row');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    tr.className = 'rec-data-row new-row-pulse';

    const statusBadgeClass = row.overall_status === 'NORMAL' ? 'badge-normal' :
      (row.overall_status.includes('WARN') ? 'badge-warning' :
      (row.overall_status === 'SENSOR_FAILURE' ? 'badge-failure' : 'badge-danger'));

    tr.innerHTML = `
      <td class="cell-idx">#${row.sample_id}</td>
      <td class="cell-mono">${row.timestamp} ms</td>
      <td class="cell-mono ${row.vibration > 10 ? 'val-danger' : ''}">${row.vibration.toFixed(2)}</td>
      <td class="cell-mono">${Math.round(row.rpm)}</td>
      <td class="cell-mono ${row.object_temperature_c > 38 ? 'val-danger' : ''}">${row.object_temperature_c.toFixed(1)}°</td>
      <td class="cell-mono">${row.room_temperature_c.toFixed(1)}°</td>
      <td class="cell-mono ${row.distance_cm > 8 ? 'val-danger' : ''}">${row.distance_cm.toFixed(1)}</td>
      <td class="cell-mono">${row.belt_height_from_ground_cm.toFixed(1)}</td>
      <td class="cell-mono val-load ${row.load_kg > 80 ? 'val-danger' : ''}"><strong>${row.load_kg.toFixed(1)} kg</strong></td>
      <td><span class="table-badge ${statusBadgeClass}">${row.overall_status}</span></td>
    `;

    tbody.insertBefore(tr, tbody.firstChild);

    // Keep table limited to 20 rows visible for smooth DOM performance
    while (tbody.children.length > 20) {
      tbody.removeChild(tbody.lastChild);
    }
  }

  /**
   * UI: Update buttons and badges
   */
  updateUIState() {
    const btnStart = document.getElementById('btnRecStart');
    const btnPause = document.getElementById('btnRecPause');
    const btnStop = document.getElementById('btnRecStop');
    const statusPill = document.getElementById('recStatusPill');
    const topRecBtn = document.getElementById('btnModeRecord');

    if (this.isRecording && !this.isPaused) {
      if (btnStart) {
        btnStart.style.display = 'none';
      }
      if (btnPause) {
        btnPause.style.display = 'inline-flex';
      }
      if (btnStop) {
        btnStop.disabled = false;
      }
      if (statusPill) {
        statusPill.className = 'rec-status-pill recording';
        statusPill.innerHTML = '<span class="rec-status-dot pulse"></span> 🔴 RECORDING LIVE RUNTIME DATA';
      }
      if (topRecBtn) {
        topRecBtn.classList.add('recording');
      }
    } else if (this.isPaused) {
      if (btnStart) {
        btnStart.style.display = 'inline-flex';
        btnStart.innerHTML = '▶️ Resume';
      }
      if (btnPause) {
        btnPause.style.display = 'none';
      }
      if (statusPill) {
        statusPill.className = 'rec-status-pill paused';
        statusPill.innerHTML = '<span class="rec-status-dot"></span> ⏸️ RECORDING PAUSED';
      }
      if (topRecBtn) {
        topRecBtn.classList.remove('recording');
      }
    } else {
      if (btnStart) {
        btnStart.style.display = 'inline-flex';
        btnStart.innerHTML = '▶️ Start Recording';
      }
      if (btnPause) {
        btnPause.style.display = 'none';
      }
      if (btnStop) {
        btnStop.disabled = true;
      }
      if (statusPill) {
        statusPill.className = 'rec-status-pill idle';
        statusPill.innerHTML = '<span class="rec-status-dot"></span> ⚪ STANDBY (READY)';
      }
      if (topRecBtn) {
        topRecBtn.classList.remove('recording');
      }
    }
  }

  /**
   * UI: Update samples counter
   */
  updateCounterDisplay() {
    const el = document.getElementById('recSampleCount');
    if (el) el.textContent = this.recordedRows.length.toLocaleString();

    const exportBtn = document.getElementById('btnRecExport');
    if (exportBtn) {
      exportBtn.disabled = this.recordedRows.length === 0;
    }

    const replayBtn = document.getElementById('btnRecReplay');
    if (replayBtn) {
      replayBtn.disabled = this.recordedRows.length === 0;
    }
  }

  /**
   * UI: Update timer display (MM:SS)
   */
  updateTimerDisplay() {
    const el = document.getElementById('recTimerDisplay');
    if (!el) return;
    const mins = Math.floor(this.elapsedSeconds / 60);
    const secs = this.elapsedSeconds % 60;
    el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

// Global instance
window.runtimeRecorder = new RuntimeDataRecorder();

// Global modal helpers
function openRuntimeDataRecorder() {
  const modal = document.getElementById('runtimeRecorderModal');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }
}

function closeRuntimeDataRecorder() {
  const modal = document.getElementById('runtimeRecorderModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

/**
 * SENTRY: Main Dashboard Application Coordinator (Hybrid Telemetry Architecture)
 * - 4 Physical Sensors: Powered by Sensor AI (runtime_data.csv / synthetic benchmark)
 * - 1 Material Load Sensor: Powered by LIVE ESP32 Hardware (COM3 Serial / WebSockets / WebSerial)
 */

// Global Live Load State (ESP32 Hardware Stream)
window.liveESP32Load = 0.0;
window.esp32HardwareConnected = false;

// Application State
const appState = {
  mode: 'runtime', // 'runtime' | 'synthetic' | 'simulator' | 'esp32' | 'custom'
  currentScenario: 'normal',
  lastUpdatedTimestamp: Date.now(),
  lastUpdatedSecondsAgo: 0,
  syntheticTimer: null,
  socket: null,
  socketConnected: false,
  alertHistory: []
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // 1. Start live clock & update heartbeat
  startClock();
  startUpdateTicker();

  // 2. Initialize streaming charts (4 Sensor AI + 1 ESP32 Live Load)
  if (window.sentryCharts) {
    window.sentryCharts.initializeCharts();
  }

  // 3. Connect dataset player to main telemetry handler
  if (window.sentryPlayer) {
    window.sentryPlayer.onTickCallback = (telemetry) => {
      // Injects live ESP32 load if hardware is streaming
      if (window.liveESP32Load !== undefined && telemetry.sensors) {
        telemetry.sensors.loadCell = {
          load: window.liveESP32Load,
          capacityPct: parseFloat(((window.liveESP32Load / 100.0) * 100).toFixed(1)),
          status: window.liveESP32Load > 85 ? 'DANGER' : (window.liveESP32Load > 60 ? 'WARNING' : 'NORMAL'),
          source: window.esp32HardwareConnected ? 'ESP32_LIVE' : 'STANDBY'
        };
      }
      handleIncomingTelemetry(telemetry);
    };
  }

  // 4. Connect WebSocket in background for continuous live ESP32 Load stream
  connectWebSocket();

  // 5. Setup File Upload Listener
  setupFileUpload();

  // 6. Start default mode: Live AI 4 Sensors (runtime_data.csv) + Live ESP32 Load
  setDataSourceMode('runtime');

  // 7. Keyboard shortcuts (1-5 for simulator, Spacebar for Play/Pause)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (appState.mode === 'runtime' || appState.mode === 'synthetic' || appState.mode === 'custom') {
        if (window.sentryPlayer) window.sentryPlayer.togglePlayPause();
      }
      return;
    }
    const keyMap = {
      '1': 'normal',
      '2': 'bearing_temp',
      '3': 'high_vibration',
      '4': 'conveyor_jam',
      '5': 'belt_sag'
    };
    if (keyMap[e.key]) {
      if (appState.mode !== 'simulator') {
        setDataSourceMode('simulator');
      }
      triggerScenario(keyMap[e.key]);
    }
  });
});

/* ==========================================================================
   LIVE ESP32 LOAD CELL CONTROLLER
   ========================================================================== */
function setLiveLoad(kg) {
  const loadVal = Math.max(0, parseFloat(kg));
  window.liveESP32Load = loadVal;
  window.esp32HardwareConnected = true;

  // 1. Update Load Sensor Card directly in DOM
  setText('loadVal', loadVal.toFixed(1));
  setText('loadCapacityVal', `${((loadVal / 100.0) * 100).toFixed(1)}%`);
  setWidth('loadGaugeFill', `${Math.min(100, (loadVal / 100.0) * 100)}%`);

  const status = loadVal > 85 ? 'DANGER' : (loadVal > 60 ? 'WARNING' : 'NORMAL');
  setBadge('loadBadge', status);

  const hwStatusEl = document.getElementById('loadHwStatus');
  if (hwStatusEl) {
    hwStatusEl.textContent = 'ESP32 COM3 LIVE';
    hwStatusEl.style.color = '#34d399';
  }

  // 2. Push directly to Chart.js Load graph
  if (window.sentryCharts && window.sentryCharts.charts.load) {
    window.sentryCharts.updateCharts({
      timestamp: new Date().toLocaleTimeString(),
      sensors: {
        loadCell: { load: loadVal }
      }
    });
  }

  // 3. Overload Alarm Trigger
  if (loadVal > 85.0) {
    dispatchAlerts({
      timestamp: new Date().toLocaleTimeString(),
      sensors: {},
      rawAlerts: `LOAD_CELL=CRITICAL_OVERLOAD (${loadVal.toFixed(1)} kg > 85 kg)`
    });
  } else if (loadVal > 60.0) {
    dispatchAlerts({
      timestamp: new Date().toLocaleTimeString(),
      sensors: {},
      rawAlerts: `LOAD_CELL=HIGH_WEIGHT_WARNING (${loadVal.toFixed(1)} kg > 60 kg)`
    });
  }
}

/* ==========================================================================
   NATIVE WEB SERIAL API (DIRECT USB CONNECTION FROM CHROME / EDGE)
   ========================================================================== */
let serialPort = null;
let serialReader = null;

async function connectWebSerial() {
  if (!('serial' in navigator)) {
    alert('Web Serial is supported in Google Chrome, Microsoft Edge, and Opera.\nFor other browsers, simply run "python backend_bridge.py" in terminal.');
    return;
  }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    serialPort = port;
    window.esp32HardwareConnected = true;

    const btn = document.getElementById('btnWebSerial');
    if (btn) {
      btn.textContent = '✓ ESP32 COM3 LIVE';
      btn.classList.add('connected');
    }

    const hwStatusEl = document.getElementById('loadHwStatus');
    if (hwStatusEl) {
      hwStatusEl.textContent = 'USB SERIAL ACTIVE';
      hwStatusEl.style.color = '#34d399';
    }

    updateConnectionIndicators({
      esp32: true,
      com3: true,
      ml: true,
      data: 'HYBRID'
    });

    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();
    serialReader = reader;

    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const data = JSON.parse(trimmed);
            let parsedLoad = null;
            if (data.load_kg !== undefined && data.load_kg !== null) {
              parsedLoad = parseFloat(data.load_kg);
            } else if (data.load !== undefined && data.load !== null) {
              parsedLoad = parseFloat(data.load);
            } else if (data.weight !== undefined && data.weight !== null) {
              parsedLoad = parseFloat(data.weight);
            }

            if (parsedLoad !== null && !isNaN(parsedLoad)) {
              setLiveLoad(parsedLoad);
            }

            // Check if ESP32 transmitted full 5 physical sensors
            if (data.obj_temp !== undefined || data.vibration !== undefined || data.rpm !== undefined || data.distance !== undefined) {
              const fullLoad = parsedLoad ?? window.liveESP32Load;
              const fullPacket = {
                timestamp: new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                sensors: {
                  mlx90614: {
                    objTemp: data.obj_temp !== undefined ? parseFloat(data.obj_temp) : 32.5,
                    roomTemp: data.room_temp !== undefined ? parseFloat(data.room_temp) : 27.2,
                    deltaTemp: (data.obj_temp !== undefined && data.room_temp !== undefined) ? parseFloat((data.obj_temp - data.room_temp).toFixed(1)) : 5.3,
                    status: (data.obj_temp > 38 || (data.obj_temp - data.room_temp) > 15) ? 'WARNING' : 'NORMAL'
                  },
                  mpu6500: {
                    vibration: data.vibration !== undefined ? parseFloat(data.vibration) : 0.85,
                    axisX: parseFloat(((data.vibration || 0.85) * 0.32).toFixed(2)),
                    axisY: parseFloat(((data.vibration || 0.85) * 0.38).toFixed(2)),
                    axisZ: parseFloat(((data.vibration || 0.85) * 0.86).toFixed(2)),
                    status: (data.vibration > 10) ? 'DANGER' : ((data.vibration > 5) ? 'WARNING' : 'NORMAL')
                  },
                  ah49e: {
                    rpm: data.rpm !== undefined ? parseFloat(data.rpm) : 460.0,
                    velocity: (parseFloat(data.rpm || 460) * 0.00314).toFixed(2),
                    slipRatio: data.rpm === 0 ? '100% (Stall)' : '1.2%',
                    status: (data.rpm === 0 || data.rpm > 120000) ? 'WARNING' : 'NORMAL'
                  },
                  hcsr04: {
                    distance: data.distance !== undefined ? parseFloat(data.distance) : 2.8,
                    beltHeight: data.distance !== undefined ? parseFloat((14.0 - data.distance).toFixed(1)) : 11.2,
                    sag: (data.distance > 8) ? `${(data.distance - 2.5).toFixed(1)} cm (Severe Sag)` : '0.4 cm (Nominal)',
                    status: (data.distance > 8) ? 'DANGER' : ((data.distance > 3) ? 'WARNING' : 'NORMAL')
                  },
                  loadCell: {
                    load: parseFloat(fullLoad),
                    capacityPct: parseFloat(((fullLoad / 100.0) * 100).toFixed(1)),
                    status: fullLoad > 85 ? 'DANGER' : (fullLoad > 60 ? 'WARNING' : 'NORMAL'),
                    source: 'ESP32_LIVE'
                  }
                },
                overall: {
                  status: (data.vibration > 10 || data.distance > 8 || fullLoad > 85) ? 'HIGH_RISK' : 'NORMAL',
                  healthIndex: Math.max(10, Math.min(100, Math.round(100 - (data.vibration || 0.85) * 2 - (fullLoad > 60 ? 20 : 0)))),
                  groundTruth: 'LIVE_HARDWARE'
                },
                ml: window.sensorAI ? window.sensorAI.predict([
                  data.vibration || 0.85,
                  data.rpm || 460,
                  data.obj_temp || 32.5,
                  data.room_temp || 27.2,
                  data.distance || 2.8,
                  data.distance ? (14.0 - data.distance) : 11.2
                ]) : {}
              };

              // Feed to dashboard if in ESP32 mode or if recorder requested live ESP32 data
              if (appState.mode === 'esp32' || (window.runtimeRecorder && window.runtimeRecorder.source === 'esp32')) {
                handleIncomingTelemetry(fullPacket);
              }
            }
          } catch (e) {
            // Partial JSON ignored
          }
        } else {
          // Support raw numbers or "Load: 24.5 kg" format from custom sketches
          if (!trimmed.toLowerCase().includes('init') && !trimmed.toLowerCase().includes('ready') && !trimmed.toLowerCase().includes('warning')) {
            const match = trimmed.match(/[-+]?\b\d+(\.\d+)?\b/);
            if (match) {
              const val = parseFloat(match[0]);
              if (!isNaN(val)) {
                setLiveLoad(val);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[SENTRY] WebSerial cancelled or closed:', err);
  }
}

/* ==========================================================================
   TIME & CLOCK TICKERS
   ========================================================================== */
function startClock() {
  const clockEl = document.getElementById('liveClock');
  const dateEl = document.getElementById('liveDate');

  const tick = () => {
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  };

  tick();
  setInterval(tick, 1000);
}

function startUpdateTicker() {
  const updateTextEl = document.getElementById('lastUpdatedText');
  const lastPacketEl = document.getElementById('lastPacketReceived');

  setInterval(() => {
    const seconds = Math.floor((Date.now() - appState.lastUpdatedTimestamp) / 1000);
    appState.lastUpdatedSecondsAgo = seconds;

    const label = seconds <= 1 ? '1 second ago' : `${seconds} seconds ago`;
    if (updateTextEl) updateTextEl.textContent = `Last Updated: ${label}`;
    if (lastPacketEl) lastPacketEl.textContent = label;
  }, 1000);
}

/* ==========================================================================
   DATA SOURCE MODE TOGGLING
   ========================================================================== */
function setDataSourceMode(mode) {
  appState.mode = mode;

  // Buttons
  const btnRuntime = document.getElementById('btnModeRuntime');
  const btnSynthetic = document.getElementById('btnModeSynthetic');
  const btnSimulator = document.getElementById('btnModeSimulator');
  const btnESP32 = document.getElementById('btnModeESP32');
  const btnUpload = document.getElementById('btnModeUpload');

  // Containers
  const playerToolbar = document.getElementById('playerControlsArea');
  const scenarioArea = document.getElementById('scenarioSelectorArea');
  const sourceIndicator = document.getElementById('sourceIndicator');
  const sourceText = document.getElementById('sourceText');

  // Reset active buttons
  [btnRuntime, btnSynthetic, btnSimulator, btnESP32, btnUpload].forEach(btn => btn?.classList.remove('active'));

  // Stop previous timers
  if (appState.syntheticTimer) {
    clearInterval(appState.syntheticTimer);
    appState.syntheticTimer = null;
  }
  if (window.sentryPlayer) {
    window.sentryPlayer.pause();
  }

  // Configure target mode
  if (mode === 'runtime') {
    btnRuntime?.classList.add('active');
    if (playerToolbar) playerToolbar.style.display = 'flex';
    if (scenarioArea) scenarioArea.style.display = 'none';
    if (sourceIndicator) sourceIndicator.className = 'source-indicator-pill source-runtime';
    if (sourceText) sourceText.textContent = '🟢 4 SENSORS: SENSOR AI (RUNTIME)  |  🔴 LOAD: ESP32 LIVE';

    updateConnectionIndicators({
      esp32: window.esp32HardwareConnected,
      com3: true,
      ml: true,
      data: 'HYBRID'
    });

    if (window.sentryPlayer) {
      window.sentryPlayer.setDataset('runtime');
      window.sentryPlayer.play();
      window.sentryPlayer.processCurrentSample();
    }

  } else if (mode === 'synthetic') {
    btnSynthetic?.classList.add('active');
    if (playerToolbar) playerToolbar.style.display = 'flex';
    if (scenarioArea) scenarioArea.style.display = 'none';
    if (sourceIndicator) sourceIndicator.className = 'source-indicator-pill source-synthetic';
    if (sourceText) sourceText.textContent = '🟣 4 SENSORS: SYNTHETIC AI  |  🔴 LOAD: ESP32 LIVE';

    updateConnectionIndicators({
      esp32: window.esp32HardwareConnected,
      com3: true,
      ml: true,
      data: 'HYBRID'
    });

    if (window.sentryPlayer) {
      window.sentryPlayer.setDataset('synthetic');
      window.sentryPlayer.play();
      window.sentryPlayer.processCurrentSample();
    }

  } else if (mode === 'simulator') {
    btnSimulator?.classList.add('active');
    if (playerToolbar) playerToolbar.style.display = 'none';
    if (scenarioArea) scenarioArea.style.display = 'flex';
    if (sourceIndicator) sourceIndicator.className = 'source-indicator-pill source-simulator';
    if (sourceText) sourceText.textContent = '🧪 4 SENSORS: SIMULATOR  |  🔴 LOAD: ESP32 LIVE';

    updateConnectionIndicators({
      esp32: window.esp32HardwareConnected,
      com3: true,
      ml: true,
      data: 'HYBRID'
    });

    appState.syntheticTimer = setInterval(processSyntheticTick, 1000);
    processSyntheticTick();

  } else if (mode === 'esp32') {
    btnESP32?.classList.add('active');
    if (playerToolbar) playerToolbar.style.display = 'none';
    if (scenarioArea) scenarioArea.style.display = 'none';
    if (sourceIndicator) sourceIndicator.className = 'source-indicator-pill source-live-esp32';
    if (sourceText) sourceText.textContent = '🔴 ALL SENSORS: ESP32 LIVE (COM3)';

    // Ensure WebSocket is connecting
    if (!appState.socketConnected) {
      connectWebSocket();
    }

  } else if (mode === 'custom') {
    btnUpload?.classList.add('active');
    if (playerToolbar) playerToolbar.style.display = 'flex';
    if (scenarioArea) scenarioArea.style.display = 'none';
    if (sourceIndicator) sourceIndicator.className = 'source-indicator-pill source-custom';
    if (sourceText) sourceText.textContent = '📁 4 SENSORS: CUSTOM CSV  |  🔴 LOAD: ESP32 LIVE';

    if (window.sentryPlayer) {
      window.sentryPlayer.play();
    }
  }
}

/* ==========================================================================
   CUSTOM CSV FILE UPLOAD HANDLER
   ========================================================================== */
function setupFileUpload() {
  const fileInput = document.getElementById('csvFileInput');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && window.sentryPlayer) {
      setDataSourceMode('custom');
      window.sentryPlayer.loadCustomFile(file);
    }
  });
}

function triggerFileUpload() {
  const fileInput = document.getElementById('csvFileInput');
  if (fileInput) fileInput.click();
}

/* ==========================================================================
   WEBSOCKET CLIENT (CONNECTS TO PYTHON BACKEND BRIDGE)
   ========================================================================== */
function connectWebSocket() {
  const wsUrl = 'ws://localhost:8765';
  console.log(`[SENTRY] Connecting to Python Backend Bridge at ${wsUrl}...`);

  try {
    appState.socket = new WebSocket(wsUrl);

    appState.socket.onopen = () => {
      console.log('[SENTRY] WebSocket connection established with backend bridge.');
      appState.socketConnected = true;
      window.esp32HardwareConnected = true;
      updateConnectionIndicators({
        esp32: true,
        com3: true,
        ml: true,
        data: 'HYBRID'
      });
    };

    appState.socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        // Always capture live ESP32 Load reading from hardware
        if (payload.sensors && payload.sensors.loadCell && payload.sensors.loadCell.load !== undefined) {
          setLiveLoad(payload.sensors.loadCell.load);
        } else if (payload.load_kg !== undefined) {
          setLiveLoad(payload.load_kg);
        }

        // If in ESP32 live mode, update all sensors from incoming packet
        if (appState.mode === 'esp32') {
          handleIncomingTelemetry(payload);
        }
      } catch (err) {
        console.error('[SENTRY] Error parsing backend telemetry packet:', err);
      }
    };

    appState.socket.onclose = () => {
      appState.socketConnected = false;
      if (appState.mode === 'esp32') {
        updateConnectionIndicators({
          esp32: false,
          com3: false,
          ml: false,
          data: 'OFFLINE'
        });
        setTimeout(connectWebSocket, 3000);
      }
    };

    appState.socket.onerror = (error) => {
      console.warn('[SENTRY] WebSocket server offline (Run python backend_bridge.py).');
    };
  } catch (e) {
    console.warn('[SENTRY] WebSocket initialization note:', e);
  }
}

/* ==========================================================================
   SIMULATOR TICK GENERATOR
   ========================================================================== */
function processSyntheticTick() {
  if (appState.mode !== 'simulator' || !window.sentrySimulator) return;
  const telemetry = window.sentrySimulator.generateTelemetry();

  // Attach live load
  telemetry.sensors.loadCell = {
    load: window.liveESP32Load,
    capacityPct: parseFloat(((window.liveESP32Load / 100.0) * 100).toFixed(1)),
    status: window.liveESP32Load > 85 ? 'DANGER' : (window.liveESP32Load > 60 ? 'WARNING' : 'NORMAL'),
    source: window.esp32HardwareConnected ? 'ESP32_LIVE' : 'STANDBY'
  };

  handleIncomingTelemetry(telemetry);
}

function triggerScenario(scenarioName) {
  appState.currentScenario = scenarioName;

  document.querySelectorAll('.scen-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-scenario') === scenarioName);
  });

  if (window.sentrySimulator) {
    window.sentrySimulator.setScenario(scenarioName);
  }

  if (appState.mode === 'simulator') {
    processSyntheticTick();
  }
}

/* ==========================================================================
   CORE TELEMETRY DISPATCHER & UI UPDATER
   ========================================================================== */
function handleIncomingTelemetry(data) {
  appState.lastUpdatedTimestamp = Date.now();

  // 1. Update all 5 Sensor Cards (4 AI + 1 ESP32 Live Load)
  updateSensorCards(data.sensors);

  // 2. Update Overall Health Status Hero Banner
  updateOverallStatus(data.overall, data.ml, data.datasetInfo);

  // 3. Update Sensor ML Analysis Panel (4 Physical Sensors / 6 features)
  updateMLAnalysis(data.ml, data.sensors);

  // 4. Update Live Alert Feed
  dispatchAlerts(data);

  // 5. Stream new data points to Chart.js graphs
  if (window.sentryCharts) {
    window.sentryCharts.updateCharts(data);
  }

  // 6. Feed live telemetry packet to 5-Sensor Runtime Data Recorder
  if (window.runtimeRecorder) {
    window.runtimeRecorder.processTelemetry(data);
  }
}

/* ==========================================================================
   UI UPDATER: 5 SENSOR CARDS (4 SENSOR AI + 1 LIVE ESP32 LOAD)
   ========================================================================== */
function updateSensorCards(s) {
  if (!s) return;

  // 1. MLX90614 Infrared Thermal Sensor [Sensor AI]
  const mlx = s.mlx90614;
  if (mlx) {
    if (mlx.objTemp !== null && mlx.objTemp !== undefined) {
      setText('objTempVal', mlx.objTemp.toFixed(1));
      setWidth('tempGaugeFill', `${Math.min(100, Math.max(0, ((mlx.objTemp - 20) / 40) * 100))}%`);
    } else {
      setText('objTempVal', '--');
      setWidth('tempGaugeFill', '0%');
    }
    setText('roomTempVal', mlx.roomTemp !== null && mlx.roomTemp !== undefined ? `${mlx.roomTemp.toFixed(1)} °C` : '--');
    setText('deltaTempVal', mlx.deltaTemp !== null && mlx.deltaTemp !== undefined ? `${mlx.deltaTemp > 0 ? '+' : ''}${mlx.deltaTemp.toFixed(1)} °C` : '--');
    setBadge('mlxBadge', mlx.status || mlx.condition || 'NORMAL');
  }

  // 2. MPU6050 / MPU6500 6-Axis IMU (Vibration) [Sensor AI]
  const mpu = s.mpu6500;
  if (mpu) {
    if (mpu.vibration !== null && mpu.vibration !== undefined) {
      setText('vibrationVal', mpu.vibration.toFixed(2));
      setText('vibAxisX', mpu.axisX !== null ? mpu.axisX.toFixed(2) : '--');
      setText('vibAxisY', mpu.axisY !== null ? mpu.axisY.toFixed(2) : '--');
      setText('vibAxisZ', mpu.axisZ !== null ? mpu.axisZ.toFixed(2) : '--');
      setWidth('vibGaugeFill', `${Math.min(100, (mpu.vibration / 15.0) * 100)}%`);
    } else {
      setText('vibrationVal', '--');
      setText('vibAxisX', '--');
      setText('vibAxisY', '--');
      setText('vibAxisZ', '--');
      setWidth('vibGaugeFill', '0%');
    }
    setBadge('mpuBadge', mpu.status || mpu.condition || 'NORMAL');
  }

  // 3. AH49E Hall Effect Speed Sensor (RPM) [Sensor AI]
  const ah = s.ah49e;
  if (ah) {
    if (ah.rpm !== null && ah.rpm !== undefined) {
      setText('rpmVal', Math.round(ah.rpm).toLocaleString());
      setText('beltVelocityVal', `${ah.velocity} m/s`);
      setText('slipRatioVal', ah.slipRatio || '1.2%');
      setWidth('rpmGaugeFill', `${Math.min(100, (ah.rpm / 1000) * 100)}%`);
    } else {
      setText('rpmVal', '--');
      setText('beltVelocityVal', '--');
      setText('slipRatioVal', '--');
      setWidth('rpmGaugeFill', '0%');
    }
    setBadge('rpmBadge', ah.status || ah.condition || 'NORMAL');
  }

  // 4. HC-SR04 Ultrasonic Distance Sensor [Sensor AI]
  const hc = s.hcsr04;
  if (hc) {
    if (hc.distance !== null && hc.distance !== undefined) {
      setText('distVal', hc.distance.toFixed(1));
      setText('beltSagVal', hc.sag || '0.4 cm (Nominal)');
      setText('beltHeightVal', hc.beltHeight !== null && hc.beltHeight !== undefined ? `${hc.beltHeight.toFixed(1)} cm` : '--');
      setWidth('distGaugeFill', `${Math.min(100, Math.max(0, (hc.distance / 14.5) * 100))}%`);
    } else {
      setText('distVal', '--');
      setText('beltSagVal', 'Sensor Disconnected');
      setText('beltHeightVal', '--');
      setWidth('distGaugeFill', '0%');
    }
    setBadge('distBadge', hc.status || hc.condition || 'NORMAL');
  }

  // 5. Load Cell (HX711) [🔴 LIVE FROM PHYSICAL ESP32 HARDWARE]
  const load = s.loadCell;
  const currentLoadVal = (load && load.load !== null && load.load !== undefined)
    ? load.load
    : (window.liveESP32Load || 0.0);

  setText('loadVal', currentLoadVal.toFixed(1));
  setText('loadCapacityVal', `${((currentLoadVal / 100.0) * 100).toFixed(1)}%`);
  setWidth('loadGaugeFill', `${Math.min(100, (currentLoadVal / 100.0) * 100)}%`);

  const loadStatus = currentLoadVal > 85 ? 'DANGER' : (currentLoadVal > 60 ? 'WARNING' : 'NORMAL');
  setBadge('loadBadge', loadStatus);

  const hwStatusEl = document.getElementById('loadHwStatus');
  if (hwStatusEl) {
    if (window.esp32HardwareConnected) {
      hwStatusEl.textContent = 'ESP32 COM3 LIVE';
      hwStatusEl.style.color = '#34d399';
    } else {
      hwStatusEl.textContent = 'STANDBY';
      hwStatusEl.style.color = '#94a3b8';
    }
  }
}

/* ==========================================================================
   UI UPDATER: OVERALL STATUS HERO
   ========================================================================== */
function updateOverallStatus(overall, ml, datasetInfo) {
  const heroEl = document.getElementById('overallStatusHero');
  const iconEl = document.getElementById('statusHeroIcon');
  const pillEl = document.getElementById('statusPill');
  const titleEl = document.getElementById('statusHeroTitle');
  const explEl = document.getElementById('statusHeroExplanation');
  const healthNumEl = document.getElementById('healthIndexVal');
  const healthBarEl = document.getElementById('healthBarFill');
  const healthSubEl = document.getElementById('healthSubText');
  const gtTagEl = document.getElementById('groundTruthTag');

  let status = (overall?.status || 'NORMAL').toUpperCase();
  let health = overall?.healthIndex || 98;

  // If live load cell is overloaded, reflect on overall health
  if (window.liveESP32Load > 85.0 && status !== 'DANGER') {
    status = 'HIGH_RISK';
    health = Math.min(health, 25);
  } else if (window.liveESP32Load > 60.0 && status === 'NORMAL') {
    status = 'WARNING_1';
    health = Math.min(health, 65);
  }

  // Clear existing status classes
  heroEl?.classList.remove('state-normal', 'state-warning', 'state-danger', 'state-failure');

  if (status === 'NORMAL') {
    heroEl?.classList.add('state-normal');
    if (iconEl) iconEl.textContent = '🟢';
    if (pillEl) pillEl.textContent = 'NORMAL';
    if (titleEl) titleEl.textContent = 'CONVEYOR OPERATING OPTIMALLY';
    if (explEl) explEl.textContent = 'NORMAL = All 4 physical sensors and material load are within expected ranges.';
  } else if (status.includes('WARN')) {
    heroEl?.classList.add('state-warning');
    if (iconEl) iconEl.textContent = '🟡';
    if (pillEl) pillEl.textContent = status;
    if (titleEl) titleEl.textContent = 'ABNORMAL CONVEYOR CONDITION DETECTED';
    if (explEl) explEl.textContent = `${status} = Predictive anomaly detected. Maintenance or tensioning check needed.`;
  } else if (status.includes('FAIL')) {
    heroEl?.classList.add('state-failure');
    if (iconEl) iconEl.textContent = '🟣';
    if (pillEl) pillEl.textContent = 'SENSOR FAILURE';
    if (titleEl) titleEl.textContent = 'SENSOR DISCONNECTION / HARDWARE FAULT';
    if (explEl) explEl.textContent = 'SENSOR FAILURE = Physical sensor disconnect or geometry out-of-range.';
  } else {
    // DANGER / HIGH_RISK
    heroEl?.classList.add('state-danger');
    if (iconEl) iconEl.textContent = '🔴';
    if (pillEl) pillEl.textContent = 'HIGH RISK';
    if (titleEl) titleEl.textContent = 'CRITICAL MECHANICAL ANOMALY DETECTED!';
    if (explEl) explEl.textContent = 'HIGH RISK = Critical multi-sensor threshold breach. Immediate conveyor shutdown recommended.';
  }

  if (healthNumEl) healthNumEl.textContent = health;
  if (healthBarEl) {
    healthBarEl.style.width = `${health}%`;
    if (status === 'NORMAL') {
      healthBarEl.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
    } else if (status.includes('WARN')) {
      healthBarEl.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    } else if (status.includes('FAIL')) {
      healthBarEl.style.background = 'linear-gradient(90deg, #a855f7, #c084fc)';
    } else {
      healthBarEl.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
    }
  }

  if (healthSubEl) {
    healthSubEl.textContent = `Sensor AI Confidence: ${ml?.confidence || 96}%`;
  }

  if (gtTagEl && datasetInfo) {
    gtTagEl.textContent = `Dataset Label: ${datasetInfo.groundTruthStatus} | Sample: #${datasetInfo.index}`;
    gtTagEl.style.display = 'inline-block';
  } else if (gtTagEl) {
    gtTagEl.style.display = 'none';
  }
}

/* ==========================================================================
   UI UPDATER: SENSOR ML ANALYSIS PANEL (4 SENSORS / 6 INPUTS)
   ========================================================================== */
function updateMLAnalysis(ml, sensors) {
  if (!sensors || !ml) return;

  const vib = sensors.mpu6500?.vibration;
  const rpm = sensors.ah49e?.rpm;
  const objT = sensors.mlx90614?.objTemp;
  const roomT = sensors.mlx90614?.roomTemp;
  const dist = sensors.hcsr04?.distance;
  const height = sensors.hcsr04?.beltHeight;

  setText('mlFeatVib', vib !== null && vib !== undefined ? `${vib.toFixed(2)} m/s²` : '--');
  setText('mlFeatRPM', rpm !== null && rpm !== undefined ? `${Math.round(rpm).toLocaleString()} RPM` : '--');
  setText('mlFeatObjTemp', objT !== null && objT !== undefined ? `${objT.toFixed(1)} °C` : '--');
  setText('mlFeatRoomTemp', roomT !== null && roomT !== undefined ? `${roomT.toFixed(1)} °C` : '--');
  setText('mlFeatDist', dist !== null && dist !== undefined ? `${dist.toFixed(1)} cm` : '--');
  setText('mlFeatHeight', height !== null && height !== undefined ? `${height.toFixed(1)} cm` : '--');

  // Prediction badge
  const pred = ml.prediction || 'NORMAL';
  const iconMap = {
    NORMAL: '🟢',
    WARNING_1: '🟡',
    WARNING_2: '🟡',
    WARNING: '🟡',
    HIGH_RISK: '🔴',
    DANGER: '🔴',
    SENSOR_FAILURE: '🟣'
  };

  setText('mlStateIcon', iconMap[pred] || '🟢');
  setText('mlStateText', pred);

  const badgeEl = document.getElementById('mlStateBadge');
  if (badgeEl) {
    if (pred === 'NORMAL') {
      badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      badgeEl.style.color = '#34d399';
      badgeEl.style.background = 'rgba(16, 185, 129, 0.12)';
    } else if (pred.includes('WARN')) {
      badgeEl.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      badgeEl.style.color = '#fbbf24';
      badgeEl.style.background = 'rgba(245, 158, 11, 0.15)';
    } else if (pred.includes('FAIL')) {
      badgeEl.style.borderColor = 'rgba(168, 85, 247, 0.5)';
      badgeEl.style.color = '#c084fc';
      badgeEl.style.background = 'rgba(168, 85, 247, 0.15)';
    } else {
      badgeEl.style.borderColor = 'rgba(239, 68, 68, 0.6)';
      badgeEl.style.color = '#f87171';
      badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
    }
  }

  setText('mlConfidenceVal', `${ml.confidence || 96.0}%`);
  setText('mlDiagnosticMsg', ml.diagnostic || 'Operating normally.');

  // Probabilities bars
  const p = ml.probabilities || { normal: 98, warning: 2, highRisk: 0, sensorFailure: 0 };
  setWidth('probNormal', `${p.normal || 0}%`);
  setText('probNormalNum', `${p.normal || 0}%`);
  setWidth('probWarning', `${p.warning || 0}%`);
  setText('probWarningNum', `${p.warning || 0}%`);
  setWidth('probDanger', `${(p.highRisk || p.danger || 0) + (p.sensorFailure || 0)}%`);
  setText('probDangerNum', `${(p.highRisk || p.danger || 0) + (p.sensorFailure || 0)}%`);
}

/* ==========================================================================
   UI UPDATER: LIVE ALERTS FEED (DATASET + REAL-TIME AI + LIVE LOAD CELL)
   ========================================================================== */
function dispatchAlerts(data) {
  const container = document.getElementById('alertsContainer');
  const countBadge = document.getElementById('alertCountBadge');
  if (!container) return;

  const currentAlerts = [];
  const time = data.timestamp || new Date().toLocaleTimeString();

  // 1. Ingest raw alerts from dataset if present
  if (data.rawAlerts && data.rawAlerts !== 'NONE') {
    const rawTokens = data.rawAlerts.split('|').map(t => t.trim());
    rawTokens.forEach(token => {
      let severity = 'warning';
      if (token.includes('FAILURE') || token.includes('ERROR') || token.includes('CRITICAL')) severity = 'danger';
      else if (token.includes('HIGH_RISK') || token.includes('WARNING_2')) severity = 'danger';

      currentAlerts.push({
        severity,
        title: token,
        sensor: token.split('=')[0] || 'ALERT',
        time,
        msg: `Prototype logged alert: ${token}`
      });
    });
  }

  // 2. Real-time threshold alerts on 4 sensors
  const mlx = data.sensors?.mlx90614;
  const mpu = data.sensors?.mpu6500;
  const ah = data.sensors?.ah49e;
  const hc = data.sensors?.hcsr04;

  if (mpu && mpu.vibration !== null) {
    if (mpu.vibration > 20.0) {
      currentAlerts.push({
        severity: 'danger',
        title: 'HIGH VIBRATION THRESHOLD BREACH',
        sensor: 'MPU6500',
        time,
        msg: `RMS vibration reached ${mpu.vibration} m/s² (Danger limit: 20.0 m/s²).`
      });
    } else if (mpu.vibration > 10.0) {
      currentAlerts.push({
        severity: 'warning',
        title: 'ELEVATED VIBRATION DETECTED',
        sensor: 'MPU6500',
        time,
        msg: `Vibration at ${mpu.vibration} m/s². Moderate roller wear detected.`
      });
    }
  }

  if (mlx && mlx.objTemp !== null && mlx.deltaTemp !== null && mlx.deltaTemp > 20) {
    currentAlerts.push({
      severity: 'danger',
      title: 'BEARING THERMAL OVERHEAT WARNING',
      sensor: 'MLX90614',
      time,
      msg: `Bearing thermal gradient reached +${mlx.deltaTemp}°C above ambient.`
    });
  }

  if (hc && hc.distance !== null && hc.distance > 3.0) {
    currentAlerts.push({
      severity: 'warning',
      title: 'CONVEYOR BELT SAG / CLEARANCE ALERT',
      sensor: 'HC-SR04',
      time,
      msg: `Belt distance increased to ${hc.distance} cm (Slack detected).`
    });
  }

  // Deduplicate and append to persistent alert history
  currentAlerts.forEach(alert => {
    const isDuplicate = appState.alertHistory.slice(0, 3).some(
      a => a.title === alert.title && Math.abs(new Date(a.time) - new Date(alert.time)) < 2000
    );
    if (!isDuplicate) {
      appState.alertHistory.unshift(alert);
    }
  });

  if (appState.alertHistory.length > 20) {
    appState.alertHistory.pop();
  }

  // Render alerts list
  if (appState.alertHistory.length === 0) {
    if (countBadge) {
      countBadge.textContent = '0 ACTIVE';
      countBadge.className = 'alert-count-pill';
    }
    container.innerHTML = `
      <div class="alert-empty-state">
        <span class="empty-icon">🟢</span>
        <div class="empty-text-group">
          <strong>NO ACTIVE ALERTS</strong>
          <span>All 4 physical sensors and load cell operating normally within nominal boundaries.</span>
        </div>
      </div>
    `;
  } else {
    const activeCount = appState.alertHistory.length;
    if (countBadge) {
      countBadge.textContent = `${activeCount} LOGGED`;
      countBadge.className = 'alert-count-pill active-alerts';
    }

    container.innerHTML = appState.alertHistory.map(a => `
      <div class="alert-item alert-${a.severity}">
        <div class="alert-icon">${a.severity === 'danger' ? '🔴' : '🟡'}</div>
        <div class="alert-content">
          <div class="alert-meta">
            <span class="alert-sensor">${a.sensor}</span>
            <span class="alert-time">${a.time}</span>
          </div>
          <div class="alert-title">${a.title}</div>
          <div class="alert-msg">${a.msg}</div>
        </div>
      </div>
    `).join('');
  }
}

/* ==========================================================================
   SYSTEM CONNECTION INDICATOR UPDATER
   ========================================================================== */
function updateConnectionIndicators({ esp32, com3, ml, data }) {
  const elESP = document.getElementById('connESP32');
  const elCOM = document.getElementById('connCOM3');
  const elML = document.getElementById('connML');
  const elData = document.getElementById('connData');

  const setStatus = (el, text, isConnected) => {
    if (!el) return;
    const txtSpan = el.querySelector('.conn-text');
    if (txtSpan) txtSpan.textContent = text;
    el.className = `conn-status ${isConnected ? 'status-connected' : 'status-disconnected'}`;
  };

  setStatus(elESP, esp32 ? 'CONNECTED' : 'STANDBY', esp32);
  setStatus(elCOM, com3 ? 'PORT READY' : 'NO PORT', com3);
  setStatus(elML, ml ? 'AI READY' : 'OFFLINE', ml);
  setStatus(elData, data, data !== 'OFFLINE' && data !== 'ERROR');
}

/* ==========================================================================
   DOM HELPER UTILITIES
   ========================================================================== */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setWidth(id, widthStr) {
  const el = document.getElementById(id);
  if (el) el.style.width = widthStr;
}

function setBadge(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const s = String(status).toUpperCase();

  el.textContent = s;
  el.className = 'sensor-badge';

  if (s.includes('FAIL')) {
    el.classList.add('badge-failure');
  } else if (s.includes('DANGER') || s.includes('HIGH_RISK')) {
    el.classList.add('badge-danger');
  } else if (s.includes('WARN')) {
    el.classList.add('badge-warning');
  } else {
    el.classList.add('badge-normal');
  }
}

/* ==========================================================================
   MODAL UTILITIES
   ========================================================================== */
function openArchModal() {
  const modal = document.getElementById('archModal');
  if (modal) modal.classList.add('show');
}

function closeArchModal() {
  const modal = document.getElementById('archModal');
  if (modal) modal.classList.remove('show');
}

window.onclick = function(event) {
  const modal = document.getElementById('archModal');
  if (event.target === modal) {
    closeArchModal();
  }
};

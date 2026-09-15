/**
 * SENTRY: Live Sensor Telemetry Charts (Chart.js 4.x)
 * Renders 5 streaming graphs:
 *   - 4 Graphs for Sensor AI Telemetry (Temperature, Vibration, Speed, Distance/Height)
 *   - 1 Dedicated Graph for Live ESP32 Hardware Load Cell (Belt Weight in kg)
 */

class SentryChartsManager {
  constructor() {
    this.maxDataPoints = 30;
    this.charts = {};
    this.labels = [];

    // Pre-populate initial time labels
    const now = new Date();
    for (let i = this.maxDataPoints - 1; i >= 0; i--) {
      const past = new Date(now.getTime() - i * 1000);
      this.labels.push(past.toLocaleTimeString());
    }
  }

  // Shared dark theme chart options
  getSharedOptions(unit, yMin = null, yMax = null) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#e2e8f0',
          bodyColor: '#38bdf8',
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              return ` ${context.dataset.label || 'Value'}: ${val !== null ? val : 'N/A'} ${unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#64748b',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            maxTicksLimit: 6
          }
        },
        y: {
          min: yMin,
          max: yMax,
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: (val) => `${val}`
          }
        }
      }
    };
  }

  initializeCharts() {
    // 1. Temperature Chart (MLX90614: Object Temp vs Room Temp) [Sensor AI]
    const ctxTemp = document.getElementById('tempChart')?.getContext('2d');
    if (ctxTemp) {
      this.charts.temp = new Chart(ctxTemp, {
        type: 'line',
        data: {
          labels: [...this.labels],
          datasets: [
            {
              label: 'Object Temp',
              data: new Array(this.maxDataPoints).fill(32.1),
              borderColor: '#f97316',
              backgroundColor: 'rgba(249, 115, 22, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              spanGaps: true
            },
            {
              label: 'Room Temp',
              data: new Array(this.maxDataPoints).fill(32.2),
              borderColor: '#38bdf8',
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderDash: [4, 4],
              tension: 0.3,
              pointRadius: 0,
              spanGaps: true
            }
          ]
        },
        options: this.getSharedOptions('°C', 20, 50)
      });
    }

    // 2. Vibration Chart (MPU6050 / MPU6500) [Sensor AI]
    const ctxVib = document.getElementById('vibChart')?.getContext('2d');
    if (ctxVib) {
      this.charts.vib = new Chart(ctxVib, {
        type: 'line',
        data: {
          labels: [...this.labels],
          datasets: [
            {
              label: 'Vibration RMS',
              data: new Array(this.maxDataPoints).fill(2.5),
              borderColor: '#a855f7',
              backgroundColor: 'rgba(168, 85, 247, 0.12)',
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              spanGaps: true
            }
          ]
        },
        options: this.getSharedOptions('m/s²', 0, 15.0)
      });
    }

    // 3. RPM Chart (AH49E Hall Effect) [Sensor AI]
    const ctxRPM = document.getElementById('rpmChart')?.getContext('2d');
    if (ctxRPM) {
      this.charts.rpm = new Chart(ctxRPM, {
        type: 'line',
        data: {
          labels: [...this.labels],
          datasets: [
            {
              label: 'Drive Speed (RPM)',
              data: new Array(this.maxDataPoints).fill(0),
              borderColor: '#06b6d4',
              backgroundColor: 'rgba(6, 182, 212, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.25,
              pointRadius: 0,
              spanGaps: true
            }
          ]
        },
        options: this.getSharedOptions('RPM', 0, null)
      });
    }

    // 4. Distance & Belt Height Chart (HC-SR04 Ultrasonic) [Sensor AI]
    const ctxDist = document.getElementById('distChart')?.getContext('2d');
    if (ctxDist) {
      this.charts.dist = new Chart(ctxDist, {
        type: 'line',
        data: {
          labels: [...this.labels],
          datasets: [
            {
              label: 'Belt Distance',
              data: new Array(this.maxDataPoints).fill(3.29),
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              spanGaps: true
            },
            {
              label: 'Belt Height from Ground',
              data: new Array(this.maxDataPoints).fill(10.71),
              borderColor: '#6366f1',
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderDash: [3, 3],
              tension: 0.3,
              pointRadius: 0,
              spanGaps: true
            }
          ]
        },
        options: this.getSharedOptions('cm', 0, 20)
      });
    }

    // 5. Load Cell Chart (HX711 Strain Gauge) [🔴 LIVE FROM ESP32]
    const ctxLoad = document.getElementById('loadChart')?.getContext('2d');
    if (ctxLoad) {
      this.charts.load = new Chart(ctxLoad, {
        type: 'line',
        data: {
          labels: [...this.labels],
          datasets: [
            {
              label: 'Conveyor Load (ESP32 Live)',
              data: new Array(this.maxDataPoints).fill(0.0),
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              borderWidth: 2.5,
              fill: true,
              tension: 0.2,
              pointRadius: 0,
              spanGaps: true
            }
          ]
        },
        options: this.getSharedOptions('kg', 0, 100)
      });
    }
  }

  updateCharts(telemetry) {
    const timeLabel = telemetry.timestamp || new Date().toLocaleTimeString();

    const pushPoint = (chart, datasetIndex, val) => {
      if (!chart) return;
      const ds = chart.data.datasets[datasetIndex];
      if (!ds) return;
      ds.data.push(val);
      if (ds.data.length > this.maxDataPoints) {
        ds.data.shift();
      }
    };

    const syncLabels = (chart) => {
      if (!chart) return;
      chart.data.labels.push(timeLabel);
      if (chart.data.labels.length > this.maxDataPoints) {
        chart.data.labels.shift();
      }
    };

    const s = telemetry.sensors;
    if (!s) return;

    // 1. Temp Chart [Sensor AI]
    if (this.charts.temp && s.mlx90614) {
      syncLabels(this.charts.temp);
      pushPoint(this.charts.temp, 0, s.mlx90614.objTemp);
      pushPoint(this.charts.temp, 1, s.mlx90614.roomTemp);
      this.charts.temp.update('none');
    }

    // 2. Vibration Chart [Sensor AI]
    if (this.charts.vib && s.mpu6500) {
      syncLabels(this.charts.vib);
      pushPoint(this.charts.vib, 0, s.mpu6500.vibration);
      this.charts.vib.update('none');
    }

    // 3. RPM Chart [Sensor AI]
    if (this.charts.rpm && s.ah49e) {
      syncLabels(this.charts.rpm);
      pushPoint(this.charts.rpm, 0, s.ah49e.rpm);
      this.charts.rpm.update('none');
    }

    // 4. Ultrasonic Distance Chart [Sensor AI]
    if (this.charts.dist && s.hcsr04) {
      syncLabels(this.charts.dist);
      pushPoint(this.charts.dist, 0, s.hcsr04.distance);
      pushPoint(this.charts.dist, 1, s.hcsr04.beltHeight);
      this.charts.dist.update('none');
    }

    // 5. Load Cell Chart [🔴 LIVE ESP32 HARDWARE]
    if (this.charts.load && s.loadCell) {
      syncLabels(this.charts.load);
      const loadVal = s.loadCell.load !== null && s.loadCell.load !== undefined ? s.loadCell.load : 0.0;
      pushPoint(this.charts.load, 0, loadVal);

      // Dynamically highlight load line if overloaded (>60kg Warning, >85kg Danger)
      const ds = this.charts.load.data.datasets[0];
      if (loadVal > 85.0) {
        ds.borderColor = '#ef4444';
        ds.backgroundColor = 'rgba(239, 68, 68, 0.25)';
      } else if (loadVal > 60.0) {
        ds.borderColor = '#f59e0b';
        ds.backgroundColor = 'rgba(245, 158, 11, 0.18)';
      } else {
        ds.borderColor = '#10b981';
        ds.backgroundColor = 'rgba(16, 185, 129, 0.12)';
      }

      this.charts.load.update('none');
    }
  }
}

// Global instance
window.sentryCharts = new SentryChartsManager();

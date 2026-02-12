/**
 * ListeningEar - Dual Audio Recorder
 * Records microphone and system audio as separate tracks for transcription
 */

class ListeningEar {
  constructor() {
    // Audio streams
    this.micStream = null;
    this.systemStream = null;

    // Audio contexts for visualization
    this.micAudioContext = null;
    this.systemAudioContext = null;
    this.micAnalyser = null;
    this.systemAnalyser = null;

    // Recorders
    this.micRecorder = null;
    this.systemRecorder = null;
    this.micChunks = [];
    this.systemChunks = [];

    // Recording state
    this.isRecording = false;
    this.recordingStartTime = null;
    this.timerInterval = null;

    // Recordings storage
    this.recordings = [];

    // DOM elements
    this.elements = {
      micSelect: document.getElementById('mic-select'),
      setupMicBtn: document.getElementById('setup-mic-btn'),
      setupSystemBtn: document.getElementById('setup-system-btn'),
      micStatus: document.getElementById('mic-status'),
      systemStatus: document.getElementById('system-status'),
      micMeterBar: document.getElementById('mic-meter-bar'),
      systemMeterBar: document.getElementById('system-meter-bar'),
      micCard: document.getElementById('mic-card'),
      systemCard: document.getElementById('system-card'),
      recordBtn: document.getElementById('record-btn'),
      recordMicCheckbox: document.getElementById('record-mic'),
      recordSystemCheckbox: document.getElementById('record-system'),
      recordingTimer: document.getElementById('recording-timer'),
      timerText: document.querySelector('.timer-text'),
      recordingsList: document.getElementById('recordings-list')
    };

    this.init();
  }

  init() {
    // Bind event listeners
    this.elements.setupMicBtn.addEventListener('click', () => this.setupMicrophone());
    this.elements.setupSystemBtn.addEventListener('click', () => this.setupSystemAudio());
    this.elements.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.elements.micSelect.addEventListener('change', (e) => this.changeMicDevice(e.target.value));

    // Check for browser support
    this.checkBrowserSupport();

    // Load any saved recordings from session
    this.loadRecordings();
  }

  checkBrowserSupport() {
    const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasGetDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

    if (!hasGetUserMedia) {
      this.updateStatus('mic', 'Browser not supported', true);
      this.elements.setupMicBtn.disabled = true;
    }

    if (!hasGetDisplayMedia) {
      this.updateStatus('system', 'Browser not supported', true);
      this.elements.setupSystemBtn.disabled = true;
    }

    if (!hasGetUserMedia && !hasGetDisplayMedia) {
      alert('Your browser does not support the required audio APIs. Please use Chrome, Edge, or Firefox.');
    }
  }

  async setupMicrophone() {
    try {
      this.updateStatus('mic', 'Requesting permission...');

      // Request microphone access
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Enumerate devices after getting permission
      await this.enumerateAudioDevices();

      // Setup audio visualization
      this.setupMicVisualization();

      this.updateStatus('mic', 'Connected', false, true);
      this.elements.micCard.classList.add('active');
      this.elements.setupMicBtn.textContent = 'Reconnect';

      this.updateRecordButton();

    } catch (err) {
      console.error('Microphone setup error:', err);
      this.updateStatus('mic', `Error: ${err.message}`, true);
    }
  }

  async enumerateAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      this.elements.micSelect.innerHTML = '';
      this.elements.micSelect.disabled = false;

      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;

        // Select the current device if it matches
        if (this.micStream) {
          const currentTrack = this.micStream.getAudioTracks()[0];
          if (currentTrack && currentTrack.getSettings().deviceId === device.deviceId) {
            option.selected = true;
          }
        }

        this.elements.micSelect.appendChild(option);
      });

    } catch (err) {
      console.error('Device enumeration error:', err);
    }
  }

  async changeMicDevice(deviceId) {
    if (!deviceId) return;

    try {
      // Stop current stream
      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
      }

      // Get new stream with selected device
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Re-setup visualization
      this.setupMicVisualization();

      this.updateStatus('mic', 'Connected', false, true);

    } catch (err) {
      console.error('Device change error:', err);
      this.updateStatus('mic', `Error: ${err.message}`, true);
    }
  }

  setupMicVisualization() {
    if (this.micAudioContext) {
      this.micAudioContext.close();
    }

    this.micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.micAnalyser = this.micAudioContext.createAnalyser();
    this.micAnalyser.fftSize = 256;

    const source = this.micAudioContext.createMediaStreamSource(this.micStream);
    source.connect(this.micAnalyser);

    this.visualizeMic();
  }

  visualizeMic() {
    if (!this.micAnalyser) return;

    const dataArray = new Uint8Array(this.micAnalyser.frequencyBinCount);

    const update = () => {
      this.micAnalyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const level = Math.min(100, (average / 128) * 100);
      this.elements.micMeterBar.style.width = `${level}%`;

      if (this.micStream && this.micStream.active) {
        requestAnimationFrame(update);
      }
    };

    update();
  }

  async setupSystemAudio() {
    try {
      this.updateStatus('system', 'Select a tab or screen...');

      // Request display media with audio
      // Chrome allows audio capture from tabs
      this.systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser' // Prefer browser tab
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'include'
      });

      // Check if audio track is present
      const audioTracks = this.systemStream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.updateStatus('system', 'No audio captured - check "Share tab audio"', true);
        // Stop the video track since we don't need it
        this.systemStream.getVideoTracks().forEach(track => track.stop());
        this.systemStream = null;
        return;
      }

      // We only need audio, stop video track to save resources
      this.systemStream.getVideoTracks().forEach(track => track.stop());

      // Setup visualization
      this.setupSystemVisualization();

      // Handle when user stops sharing
      audioTracks[0].addEventListener('ended', () => {
        this.handleSystemStreamEnded();
      });

      this.updateStatus('system', 'Capturing audio', false, true);
      this.elements.systemCard.classList.add('active');
      this.elements.setupSystemBtn.textContent = 'Change Source';

      this.updateRecordButton();

    } catch (err) {
      console.error('System audio setup error:', err);
      if (err.name === 'NotAllowedError') {
        this.updateStatus('system', 'Permission denied', true);
      } else {
        this.updateStatus('system', `Error: ${err.message}`, true);
      }
    }
  }

  handleSystemStreamEnded() {
    this.systemStream = null;
    this.updateStatus('system', 'Sharing stopped', true);
    this.elements.systemCard.classList.remove('active');
    this.elements.systemMeterBar.style.width = '0%';
    this.elements.setupSystemBtn.textContent = 'Capture Tab/Screen Audio';

    if (this.isRecording) {
      // Continue recording with just mic if available
      this.elements.recordSystemCheckbox.checked = false;
    }

    this.updateRecordButton();
  }

  setupSystemVisualization() {
    if (this.systemAudioContext) {
      this.systemAudioContext.close();
    }

    this.systemAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.systemAnalyser = this.systemAudioContext.createAnalyser();
    this.systemAnalyser.fftSize = 256;

    const source = this.systemAudioContext.createMediaStreamSource(this.systemStream);
    source.connect(this.systemAnalyser);

    this.visualizeSystem();
  }

  visualizeSystem() {
    if (!this.systemAnalyser) return;

    const dataArray = new Uint8Array(this.systemAnalyser.frequencyBinCount);

    const update = () => {
      this.systemAnalyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const level = Math.min(100, (average / 128) * 100);
      this.elements.systemMeterBar.style.width = `${level}%`;

      if (this.systemStream && this.systemStream.active) {
        requestAnimationFrame(update);
      }
    };

    update();
  }

  updateStatus(type, message, isError = false, isConnected = false) {
    const statusEl = type === 'mic' ? this.elements.micStatus : this.elements.systemStatus;
    const textEl = statusEl.querySelector('.status-text');

    textEl.textContent = message;
    statusEl.classList.remove('connected', 'error');

    if (isConnected) {
      statusEl.classList.add('connected');
    } else if (isError) {
      statusEl.classList.add('error');
    }
  }

  updateRecordButton() {
    const hasMic = this.micStream && this.micStream.active;
    const hasSystem = this.systemStream && this.systemStream.active;
    const wantMic = this.elements.recordMicCheckbox.checked;
    const wantSystem = this.elements.recordSystemCheckbox.checked;

    // Enable button if at least one selected source is available
    const canRecord = (wantMic && hasMic) || (wantSystem && hasSystem);
    this.elements.recordBtn.disabled = !canRecord;
  }

  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  startRecording() {
    this.micChunks = [];
    this.systemChunks = [];

    const wantMic = this.elements.recordMicCheckbox.checked;
    const wantSystem = this.elements.recordSystemCheckbox.checked;

    // Determine MIME type - prefer webm/opus for best compatibility
    const mimeType = this.getSupportedMimeType();

    // Start mic recording
    if (wantMic && this.micStream && this.micStream.active) {
      this.micRecorder = new MediaRecorder(this.micStream, {
        mimeType: mimeType,
        audioBitsPerSecond: 128000
      });

      this.micRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.micChunks.push(e.data);
        }
      };

      this.micRecorder.start(1000); // Collect data every second
    }

    // Start system audio recording
    if (wantSystem && this.systemStream && this.systemStream.active) {
      this.systemRecorder = new MediaRecorder(this.systemStream, {
        mimeType: mimeType,
        audioBitsPerSecond: 128000
      });

      this.systemRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.systemChunks.push(e.data);
        }
      };

      this.systemRecorder.start(1000);
    }

    this.isRecording = true;
    this.recordingStartTime = Date.now();

    // Update UI
    this.elements.recordBtn.classList.add('recording');
    this.elements.recordBtn.querySelector('.record-icon').textContent = '⏹️';
    this.elements.recordBtn.querySelector('.record-text').textContent = 'Stop Recording';
    this.elements.recordingTimer.classList.add('active');

    // Disable checkboxes during recording
    this.elements.recordMicCheckbox.disabled = true;
    this.elements.recordSystemCheckbox.disabled = true;

    // Start timer
    this.startTimer();
  }

  stopRecording() {
    return new Promise((resolve) => {
      let pendingRecorders = 0;

      const checkComplete = () => {
        pendingRecorders--;
        if (pendingRecorders <= 0) {
          this.finalizeRecording();
          resolve();
        }
      };

      if (this.micRecorder && this.micRecorder.state !== 'inactive') {
        pendingRecorders++;
        this.micRecorder.onstop = checkComplete;
        this.micRecorder.stop();
      }

      if (this.systemRecorder && this.systemRecorder.state !== 'inactive') {
        pendingRecorders++;
        this.systemRecorder.onstop = checkComplete;
        this.systemRecorder.stop();
      }

      if (pendingRecorders === 0) {
        this.finalizeRecording();
        resolve();
      }

      this.isRecording = false;

      // Update UI
      this.elements.recordBtn.classList.remove('recording');
      this.elements.recordBtn.querySelector('.record-icon').textContent = '⏺️';
      this.elements.recordBtn.querySelector('.record-text').textContent = 'Start Recording';
      this.elements.recordingTimer.classList.remove('active');

      // Re-enable checkboxes
      this.elements.recordMicCheckbox.disabled = false;
      this.elements.recordSystemCheckbox.disabled = false;

      // Stop timer
      this.stopTimer();
    });
  }

  finalizeRecording() {
    const now = new Date();
    const timestamp = this.formatTimestampForFilename(now);
    const duration = this.formatTime(Date.now() - this.recordingStartTime);
    const mimeType = this.getSupportedMimeType();
    const extension = mimeType.includes('webm') ? 'webm' : 'ogg';

    const recording = {
      id: Date.now(),
      timestamp: now.toLocaleString(),
      duration: duration,
      files: []
    };

    // Create mic audio blob
    if (this.micChunks.length > 0) {
      const micBlob = new Blob(this.micChunks, { type: mimeType });
      recording.files.push({
        name: `${timestamp} MicrophoneRecording.${extension}`,
        blob: micBlob,
        type: 'microphone',
        size: this.formatFileSize(micBlob.size)
      });
    }

    // Create system audio blob
    if (this.systemChunks.length > 0) {
      const systemBlob = new Blob(this.systemChunks, { type: mimeType });
      recording.files.push({
        name: `${timestamp} SystemAudioRecording.${extension}`,
        blob: systemBlob,
        type: 'system',
        size: this.formatFileSize(systemBlob.size)
      });
    }

    if (recording.files.length > 0) {
      this.recordings.unshift(recording);
      this.renderRecordings();
    }
  }

  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Fallback
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.recordingStartTime;
      this.elements.timerText.textContent = this.formatTime(elapsed);
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.elements.timerText.textContent = '00:00:00';
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
      .map(n => n.toString().padStart(2, '0'))
      .join(':');
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatTimestampForFilename(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${year}-${month}-${day} ${hours}-${minutes}`;
  }

  renderRecordings() {
    if (this.recordings.length === 0) {
      this.elements.recordingsList.innerHTML = `
        <div class="empty-state">
          <p>No recordings yet. Set up your audio sources and start recording!</p>
        </div>
      `;
      return;
    }

    this.elements.recordingsList.innerHTML = this.recordings.map(recording => `
      <div class="recording-item" data-id="${recording.id}">
        <div class="recording-item-header">
          <span class="recording-item-title">
            🎙️ Recording
          </span>
          <span class="recording-item-time">${recording.timestamp} • ${recording.duration}</span>
        </div>
        <div class="recording-item-files">
          ${recording.files.map(file => `
            <a href="#" class="file-download" data-recording-id="${recording.id}" data-file-name="${file.name}">
              <span class="file-icon">${file.type === 'microphone' ? '🎤' : '🖥️'}</span>
              <span class="file-info">
                <span class="file-name">${file.type === 'microphone' ? 'Your Voice' : 'Meeting Audio'}</span>
                <span class="file-size">${file.size}</span>
              </span>
              <span class="download-icon">⬇️</span>
            </a>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Add download event listeners
    this.elements.recordingsList.querySelectorAll('.file-download').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const recordingId = parseInt(link.dataset.recordingId);
        const fileName = link.dataset.fileName;
        this.downloadFile(recordingId, fileName);
      });
    });
  }

  downloadFile(recordingId, fileName) {
    const recording = this.recordings.find(r => r.id === recordingId);
    if (!recording) return;

    const file = recording.files.find(f => f.name === fileName);
    if (!file) return;

    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up the URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  loadRecordings() {
    // Recordings are stored in memory only for this session
    // You could extend this to use IndexedDB for persistence
    this.renderRecordings();
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.listeningEar = new ListeningEar();
});

// Handle checkbox changes
document.getElementById('record-mic')?.addEventListener('change', () => {
  window.listeningEar?.updateRecordButton();
});

document.getElementById('record-system')?.addEventListener('change', () => {
  window.listeningEar?.updateRecordButton();
});

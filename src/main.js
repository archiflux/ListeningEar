/**
 * ListeningEar - Dual Audio Recorder
 * Records microphone and system audio as separate tracks for transcription
 */

import { Transcriber } from './transcriber.js';

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

    // Transcription
    this.transcriber = new Transcriber({
      onProgress: (p) => this._onTranscriptionProgress(p),
      onError: (msg) => this._onTranscriptionError(msg),
    });
    this.transcriptionStates = new Map(); // recordingId -> state object
    this.activeTranscriptionId = null;

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
      recordingsList: document.getElementById('recordings-list'),
      importBtn: document.getElementById('import-audio-btn'),
      importInput: document.getElementById('import-audio-input'),
    };

    this.init();
  }

  init() {
    this.elements.setupMicBtn.addEventListener('click', () => this.setupMicrophone());
    this.elements.setupSystemBtn.addEventListener('click', () => this.setupSystemAudio());
    this.elements.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.elements.micSelect.addEventListener('change', (e) => this.changeMicDevice(e.target.value));
    this.elements.recordMicCheckbox.addEventListener('change', () => this.updateRecordButton());
    this.elements.recordSystemCheckbox.addEventListener('change', () => this.updateRecordButton());

    // Import audio file
    this.elements.importBtn.addEventListener('click', () => this.elements.importInput.click());
    this.elements.importInput.addEventListener('change', (e) => this.handleImportFile(e));

    this.checkBrowserSupport();
    this.renderRecordings();
  }

  // ─── Browser support ──────────────────────────────────────────────────────

  checkBrowserSupport() {
    const hasGetUserMedia = !!(navigator.mediaDevices?.getUserMedia);
    const hasGetDisplayMedia = !!(navigator.mediaDevices?.getDisplayMedia);

    if (!hasGetUserMedia) {
      this.updateStatus('mic', 'Browser not supported', true);
      this.elements.setupMicBtn.disabled = true;
    }

    if (!hasGetDisplayMedia) {
      this.updateStatus('system', 'Browser not supported', true);
      this.elements.setupSystemBtn.disabled = true;
    }
  }

  // ─── Microphone ───────────────────────────────────────────────────────────

  async setupMicrophone() {
    try {
      this.updateStatus('mic', 'Requesting permission...');
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      await this.enumerateAudioDevices();
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
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      this.elements.micSelect.innerHTML = '';
      this.elements.micSelect.disabled = false;
      audioInputs.forEach((device, i) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${i + 1}`;
        if (this.micStream) {
          const track = this.micStream.getAudioTracks()[0];
          if (track?.getSettings().deviceId === device.deviceId) option.selected = true;
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
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.setupMicVisualization();
      this.updateStatus('mic', 'Connected', false, true);
    } catch (err) {
      console.error('Device change error:', err);
      this.updateStatus('mic', `Error: ${err.message}`, true);
    }
  }

  setupMicVisualization() {
    this.micAudioContext?.close();
    this.micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.micAnalyser = this.micAudioContext.createAnalyser();
    this.micAnalyser.fftSize = 256;
    this.micAudioContext.createMediaStreamSource(this.micStream).connect(this.micAnalyser);
    this._animateMeter(this.micAnalyser, this.elements.micMeterBar, () => this.micStream?.active);
  }

  // ─── System audio ─────────────────────────────────────────────────────────

  async setupSystemAudio() {
    try {
      this.updateStatus('system', 'Select a tab or screen...');
      this.systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
      });

      const audioTracks = this.systemStream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.updateStatus('system', 'No audio captured — check "Share tab audio"', true);
        this.systemStream.getVideoTracks().forEach((t) => t.stop());
        this.systemStream = null;
        return;
      }

      this.systemStream.getVideoTracks().forEach((t) => t.stop());
      audioTracks[0].addEventListener('ended', () => this._onSystemStreamEnded());

      this.setupSystemVisualization();
      this.updateStatus('system', 'Capturing audio', false, true);
      this.elements.systemCard.classList.add('active');
      this.elements.setupSystemBtn.textContent = 'Change Source';
      this.updateRecordButton();
    } catch (err) {
      console.error('System audio error:', err);
      this.updateStatus('system', err.name === 'NotAllowedError' ? 'Permission denied' : `Error: ${err.message}`, true);
    }
  }

  _onSystemStreamEnded() {
    this.systemStream = null;
    this.updateStatus('system', 'Sharing stopped', true);
    this.elements.systemCard.classList.remove('active');
    this.elements.systemMeterBar.style.width = '0%';
    this.elements.setupSystemBtn.textContent = 'Capture Tab/Screen Audio';
    if (this.isRecording) this.elements.recordSystemCheckbox.checked = false;
    this.updateRecordButton();
  }

  setupSystemVisualization() {
    this.systemAudioContext?.close();
    this.systemAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.systemAnalyser = this.systemAudioContext.createAnalyser();
    this.systemAnalyser.fftSize = 256;
    this.systemAudioContext.createMediaStreamSource(this.systemStream).connect(this.systemAnalyser);
    this._animateMeter(this.systemAnalyser, this.elements.systemMeterBar, () => this.systemStream?.active);
  }

  _animateMeter(analyser, barEl, isActiveFn) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      barEl.style.width = `${Math.min(100, (avg / 128) * 100)}%`;
      if (isActiveFn()) requestAnimationFrame(tick);
    };
    tick();
  }

  // ─── Status helpers ───────────────────────────────────────────────────────

  updateStatus(type, message, isError = false, isConnected = false) {
    const el = type === 'mic' ? this.elements.micStatus : this.elements.systemStatus;
    el.querySelector('.status-text').textContent = message;
    el.classList.remove('connected', 'error');
    if (isConnected) el.classList.add('connected');
    else if (isError) el.classList.add('error');
  }

  updateRecordButton() {
    const hasMic = this.micStream?.active;
    const hasSystem = this.systemStream?.active;
    const wantMic = this.elements.recordMicCheckbox.checked;
    const wantSystem = this.elements.recordSystemCheckbox.checked;
    this.elements.recordBtn.disabled = !((wantMic && hasMic) || (wantSystem && hasSystem));
  }

  // ─── Recording ────────────────────────────────────────────────────────────

  toggleRecording() {
    this.isRecording ? this.stopRecording() : this.startRecording();
  }

  startRecording() {
    this.micChunks = [];
    this.systemChunks = [];

    const mimeType = this.getSupportedMimeType();

    if (this.elements.recordMicCheckbox.checked && this.micStream?.active) {
      this.micRecorder = new MediaRecorder(this.micStream, { mimeType, audioBitsPerSecond: 128000 });
      this.micRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.micChunks.push(e.data); };
      this.micRecorder.start(1000);
    }

    if (this.elements.recordSystemCheckbox.checked && this.systemStream?.active) {
      this.systemRecorder = new MediaRecorder(this.systemStream, { mimeType, audioBitsPerSecond: 128000 });
      this.systemRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.systemChunks.push(e.data); };
      this.systemRecorder.start(1000);
    }

    this.isRecording = true;
    this.recordingStartTime = Date.now();

    this.elements.recordBtn.classList.add('recording');
    this.elements.recordBtn.querySelector('.record-icon').textContent = '⏹️';
    this.elements.recordBtn.querySelector('.record-text').textContent = 'Stop Recording';
    this.elements.recordingTimer.classList.add('active');
    this.elements.recordMicCheckbox.disabled = true;
    this.elements.recordSystemCheckbox.disabled = true;

    this.startTimer();
  }

  stopRecording() {
    return new Promise((resolve) => {
      let pending = 0;

      const onStop = () => {
        if (--pending <= 0) { this.finalizeRecording(); resolve(); }
      };

      if (this.micRecorder && this.micRecorder.state !== 'inactive') {
        pending++;
        this.micRecorder.onstop = onStop;
        this.micRecorder.stop();
      }
      if (this.systemRecorder && this.systemRecorder.state !== 'inactive') {
        pending++;
        this.systemRecorder.onstop = onStop;
        this.systemRecorder.stop();
      }
      if (pending === 0) { this.finalizeRecording(); resolve(); }

      this.isRecording = false;
      this.elements.recordBtn.classList.remove('recording');
      this.elements.recordBtn.querySelector('.record-icon').textContent = '⏺️';
      this.elements.recordBtn.querySelector('.record-text').textContent = 'Start Recording';
      this.elements.recordingTimer.classList.remove('active');
      this.elements.recordMicCheckbox.disabled = false;
      this.elements.recordSystemCheckbox.disabled = false;
      this.stopTimer();
    });
  }

  finalizeRecording() {
    const now = new Date();
    const timestamp = this.formatTimestampForFilename(now);
    const duration = this.formatTime(Date.now() - this.recordingStartTime);
    const mimeType = this.getSupportedMimeType();
    const ext = mimeType.includes('webm') ? 'webm' : 'ogg';

    const recording = { id: Date.now(), timestamp: now.toLocaleString(), duration, files: [] };

    if (this.micChunks.length > 0) {
      const blob = new Blob(this.micChunks, { type: mimeType });
      recording.files.push({ name: `${timestamp} MicrophoneRecording.${ext}`, blob, type: 'microphone', size: this.formatFileSize(blob.size) });
    }

    if (this.systemChunks.length > 0) {
      const blob = new Blob(this.systemChunks, { type: mimeType });
      recording.files.push({ name: `${timestamp} SystemAudioRecording.${ext}`, blob, type: 'system', size: this.formatFileSize(blob.size) });
    }

    if (recording.files.length > 0) {
      this.recordings.unshift(recording);
      this.renderRecordings();
    }
  }

  getSupportedMimeType() {
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'audio/webm';
  }

  // ─── Import audio file ────────────────────────────────────────────────────

  handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be imported again if needed
    event.target.value = '';

    const now = new Date();
    const timestamp = this.formatTimestampForFilename(now);

    // Get file extension or default to original
    const ext = file.name.split('.').pop()?.toLowerCase() || 'audio';

    const recording = {
      id: Date.now(),
      timestamp: now.toLocaleString(),
      duration: 'Imported',
      imported: true,
      files: [
        {
          name: `${timestamp} ImportedAudio.${ext}`,
          blob: file,
          type: 'imported',
          size: this.formatFileSize(file.size),
          originalName: file.name,
        },
      ],
    };

    this.recordings.unshift(recording);
    this.renderRecordings();
  }

  // ─── Timer ────────────────────────────────────────────────────────────────

  startTimer() {
    this.timerInterval = setInterval(() => {
      this.elements.timerText.textContent = this.formatTime(Date.now() - this.recordingStartTime);
    }, 1000);
  }

  stopTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this.elements.timerText.textContent = '00:00:00';
  }

  // ─── Formatting helpers ───────────────────────────────────────────────────

  formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map((n) => n.toString().padStart(2, '0'))
      .join(':');
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatTimestampForFilename(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  }

  // ─── Recordings rendering ─────────────────────────────────────────────────

  renderRecordings() {
    if (this.recordings.length === 0) {
      this.elements.recordingsList.innerHTML = `
        <div class="empty-state">
          <p>No recordings yet. Set up your audio sources and start recording!</p>
        </div>`;
      return;
    }

    this.elements.recordingsList.innerHTML = this.recordings.map((r) => this._recordingItemHTML(r)).join('');
    this.recordings.forEach((r) => {
      const item = this.elements.recordingsList.querySelector(`.recording-item[data-id="${r.id}"]`);
      if (item) this._bindRecordingEvents(item, r.id);
    });
  }

  _recordingItemHTML(recording) {
    const isImported = recording.imported;
    const title = isImported ? '📂 Imported Audio' : '🎙️ Recording';

    const fileIcon = (type) => ({ microphone: '🎤', system: '🖥️', imported: '📁' }[type] ?? '🎵');
    const fileLabel = (f) => {
      if (f.type === 'microphone') return 'Your Voice';
      if (f.type === 'system') return 'Meeting Audio';
      if (f.type === 'imported') return f.originalName || 'Imported Audio';
      return 'Audio';
    };

    return `
      <div class="recording-item ${isImported ? 'imported' : ''}" data-id="${recording.id}">
        <div class="recording-item-header">
          <span class="recording-item-title">${title}</span>
          <span class="recording-item-time">${recording.timestamp} • ${recording.duration}</span>
        </div>

        <div class="recording-item-files">
          ${recording.files.map((f) => `
            <a href="#" class="file-download" data-action="download-audio"
               data-recording-id="${recording.id}" data-file-name="${f.name}">
              <span class="file-icon">${fileIcon(f.type)}</span>
              <span class="file-info">
                <span class="file-name">${fileLabel(f)}</span>
                <span class="file-size">${f.size}</span>
              </span>
              <span class="download-icon">⬇️</span>
            </a>
          `).join('')}
        </div>

        <div class="transcription-panel">
          ${this._transcriptionPanelHTML(recording.id)}
        </div>
      </div>`;
  }

  _transcriptionPanelHTML(recordingId) {
    const state = this.transcriptionStates.get(recordingId);

    // ── Idle ──
    if (!state) {
      return `
        <button class="btn btn-transcribe" data-action="show-settings" data-recording-id="${recordingId}">
          ✨ Transcribe to SRT
        </button>`;
    }

    // ── Settings ──
    if (state.phase === 'settings') {
      return `
        <div class="transcription-settings">
          <div class="settings-row">
            <div class="setting-group">
              <label>Whisper Model</label>
              <select class="transcription-model">
                <option value="Xenova/whisper-tiny">Tiny (39 MB) — Fastest</option>
                <option value="Xenova/whisper-base" selected>Base (74 MB) — Balanced</option>
                <option value="Xenova/whisper-small">Small (244 MB) — Best accuracy</option>
              </select>
            </div>
            <div class="setting-group">
              <label>Language</label>
              <select class="transcription-language">
                <option value="">Auto-detect</option>
                <option value="en" selected>English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="nl">Dutch</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
          </div>
          <p class="model-note">Model downloads once and is cached in your browser.</p>
          <div class="settings-actions">
            <button class="btn btn-start-transcription" data-action="start" data-recording-id="${recordingId}">
              Start Transcription
            </button>
            <button class="btn btn-cancel" data-action="cancel" data-recording-id="${recordingId}">
              Cancel
            </button>
          </div>
        </div>`;
    }

    // ── Decoding audio ──
    if (state.phase === 'decoding_audio') {
      return `
        <div class="transcription-progress">
          <div class="progress-label">🔄 Decoding ${state.sourceLabel ? `[${state.sourceLabel}]` : ''} audio...</div>
          <div class="progress-bar-track"><div class="progress-bar-fill indeterminate"></div></div>
        </div>`;
    }

    // ── Downloading model ──
    if (state.phase === 'loading_model') {
      const pct = Math.round(state.progress ?? 0);
      return `
        <div class="transcription-progress">
          <div class="progress-label">⬇️ Downloading model${state.file ? ` — ${state.file}` : ''}...</div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="progress-pct">${pct}%</div>
        </div>`;
    }

    // ── Transcribing ──
    if (state.phase === 'transcribing' || state.phase === 'starting') {
      return `
        <div class="transcription-progress">
          <div class="progress-label">🎙️ Transcribing${state.sourceLabel ? ` [${state.sourceLabel}]` : ''}...</div>
          <div class="progress-bar-track"><div class="progress-bar-fill indeterminate"></div></div>
        </div>`;
    }

    // ── Done ──
    if (state.phase === 'done') {
      const icon  = { combined: '📋', 'mic-srt': '🎤', 'system-srt': '🖥️', 'imported-srt': '📄' };
      const label = { combined: 'Combined SRT', 'mic-srt': 'Your Voice SRT', 'system-srt': 'Meeting Audio SRT', 'imported-srt': 'Transcription SRT' };
      return `
        <div class="transcription-done">
          <span class="done-label">✅ Transcription complete</span>
          <div class="srt-downloads">
            ${state.srtFiles.map((f) => `
              <a href="#" class="srt-download" data-action="download-srt"
                 data-recording-id="${recordingId}" data-srt-name="${f.name}">
                <span class="srt-icon">${icon[f.type] ?? '📄'}</span>
                <span class="srt-info">
                  <span class="srt-label">${label[f.type] ?? 'SRT'}</span>
                  <span class="srt-filename">${f.name}</span>
                </span>
                <span class="srt-dl-icon">⬇️</span>
              </a>
            `).join('')}
          </div>
          <button class="btn btn-retranscribe" data-action="show-settings" data-recording-id="${recordingId}">
            Re-transcribe
          </button>
        </div>`;
    }

    // ── Error ──
    if (state.phase === 'error') {
      return `
        <div class="transcription-error">
          <span class="error-msg">❌ ${state.message}</span>
          <button class="btn btn-retranscribe" data-action="show-settings" data-recording-id="${recordingId}">
            Try Again
          </button>
        </div>`;
    }

    return '';
  }

  _bindRecordingEvents(item, recordingId) {
    item.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this._handleRecordingAction(e.currentTarget, recordingId);
      });
    });
  }

  _handleRecordingAction(el, recordingId) {
    const action = el.dataset.action;

    if (action === 'download-audio') {
      this.downloadAudioFile(recordingId, el.dataset.fileName);
      return;
    }

    if (action === 'show-settings') {
      // Don't allow opening settings on a different recording while one is running
      if (this.activeTranscriptionId && this.activeTranscriptionId !== recordingId) return;
      this.transcriptionStates.set(recordingId, { phase: 'settings' });
      this._refreshTranscriptionPanel(recordingId);
      return;
    }

    if (action === 'cancel') {
      this.transcriptionStates.delete(recordingId);
      this._refreshTranscriptionPanel(recordingId);
      return;
    }

    if (action === 'start') {
      const item = this.elements.recordingsList.querySelector(`.recording-item[data-id="${recordingId}"]`);
      const modelId = item?.querySelector('.transcription-model')?.value ?? 'Xenova/whisper-base';
      const language = item?.querySelector('.transcription-language')?.value ?? 'en';
      this._runTranscription(recordingId, modelId, language);
      return;
    }

    if (action === 'download-srt') {
      this.downloadSRTFile(recordingId, el.dataset.srtName);
      return;
    }
  }

  _refreshTranscriptionPanel(recordingId) {
    const item = this.elements.recordingsList.querySelector(`.recording-item[data-id="${recordingId}"]`);
    if (!item) return;
    const panel = item.querySelector('.transcription-panel');
    if (!panel) return;
    panel.innerHTML = this._transcriptionPanelHTML(recordingId);
    this._bindRecordingEvents(item, recordingId);
  }

  // ─── Transcription ────────────────────────────────────────────────────────

  async _runTranscription(recordingId, modelId, language) {
    const recording = this.recordings.find((r) => r.id === recordingId);
    if (!recording) return;

    this.activeTranscriptionId = recordingId;
    this.transcriptionStates.set(recordingId, { phase: 'starting' });
    this._refreshTranscriptionPanel(recordingId);

    try {
      const srtFiles = await this.transcriber.transcribeRecording(recording, modelId, language);
      this.transcriptionStates.set(recordingId, { phase: 'done', srtFiles });
    } catch (err) {
      this.transcriptionStates.set(recordingId, { phase: 'error', message: err.message });
    }

    this.activeTranscriptionId = null;
    this._refreshTranscriptionPanel(recordingId);
  }

  _onTranscriptionProgress(progress) {
    if (!this.activeTranscriptionId) return;
    this.transcriptionStates.set(this.activeTranscriptionId, { ...progress });
    this._refreshTranscriptionPanel(this.activeTranscriptionId);
  }

  _onTranscriptionError(message) {
    if (!this.activeTranscriptionId) return;
    this.transcriptionStates.set(this.activeTranscriptionId, { phase: 'error', message });
    this._refreshTranscriptionPanel(this.activeTranscriptionId);
    this.activeTranscriptionId = null;
  }

  // ─── Downloads ────────────────────────────────────────────────────────────

  downloadAudioFile(recordingId, fileName) {
    const recording = this.recordings.find((r) => r.id === recordingId);
    const file = recording?.files.find((f) => f.name === fileName);
    if (!file) return;
    this._triggerDownload(URL.createObjectURL(file.blob), file.name);
  }

  downloadSRTFile(recordingId, srtName) {
    const state = this.transcriptionStates.get(recordingId);
    const srt = state?.srtFiles?.find((f) => f.name === srtName);
    if (!srt) return;
    const blob = new Blob([srt.content], { type: 'text/srt' });
    this._triggerDownload(URL.createObjectURL(blob), srt.name);
  }

  _triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  window.listeningEar = new ListeningEar();
});

import { audioBlobToFloat32Array } from './audio-utils.js';
import { generateCombinedSRT, generateSingleSRT } from './srt-generator.js';

/**
 * Detect iOS Safari which has limited WASM/Worker support
 */
function isIOSSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  return isIOS && isSafari;
}

/**
 * Orchestrates audio decoding + Whisper transcription via a Web Worker,
 * then assembles the SRT output files.
 */
export class Transcriber {
  constructor({ onProgress, onError }) {
    this.worker = null;
    this.onProgress = onProgress;
    this.onError = onError;
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  /**
   * Check if transcription is supported on this browser
   */
  static isSupported() {
    // Check for basic requirements
    if (typeof Worker === 'undefined') return { supported: false, reason: 'Web Workers not supported' };
    if (typeof WebAssembly === 'undefined') return { supported: false, reason: 'WebAssembly not supported' };

    // iOS Safari often crashes with large WASM
    if (isIOSSafari()) {
      return {
        supported: false,
        reason: 'iOS Safari has limited support for in-browser AI. Please use Chrome on desktop, or download the audio and transcribe using another tool.'
      };
    }

    return { supported: true };
  }

  _initWorker() {
    if (this.worker) return;

    try {
      this.worker = new Worker(
        new URL('./transcription.worker.js', import.meta.url),
        { type: 'module' }
      );

      this.worker.addEventListener('message', (e) => this._handleMessage(e.data));

      // Handle worker errors
      this.worker.addEventListener('error', (e) => {
        console.error('Worker error:', e);
        const message = e.message || 'Transcription worker crashed. This browser may not support in-browser AI.';
        this.onError(message);
        if (this._pendingReject) {
          this._pendingReject(new Error(message));
          this._pendingReject = null;
          this._pendingResolve = null;
        }
      });
    } catch (err) {
      console.error('Failed to create worker:', err);
      throw new Error('Failed to start transcription. This browser may not support in-browser AI.');
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'model_loading':
        this.onProgress({ phase: 'loading_model', progress: 0, file: '' });
        break;

      case 'model_progress':
        if (msg.data.status === 'progress') {
          this.onProgress({
            phase: 'loading_model',
            progress: msg.data.progress ?? 0,
            file: msg.data.file ?? '',
          });
        }
        break;

      case 'transcribing':
        this.onProgress({ phase: 'transcribing', sourceLabel: msg.sourceLabel });
        break;

      case 'transcription_done':
        if (this._pendingResolve) {
          const resolve = this._pendingResolve;
          this._pendingResolve = null;
          resolve({ data: msg.data, sourceLabel: msg.sourceLabel });
        }
        break;

      case 'error':
        this.onError(msg.message);
        if (this._pendingReject) {
          this._pendingReject(new Error(msg.message));
          this._pendingReject = null;
          this._pendingResolve = null;
        }
        break;
    }
  }

  /**
   * Decode one audio blob and send to worker for transcription.
   * Returns { data: WhisperResult, sourceLabel }.
   */
  async _transcribeBlob(blob, modelId, language, sourceLabel) {
    return new Promise(async (resolve, reject) => {
      this._pendingResolve = resolve;
      this._pendingReject = reject;

      try {
        this.onProgress({ phase: 'decoding_audio', sourceLabel });
        const audioData = await audioBlobToFloat32Array(blob);

        // Transfer the buffer to the worker (zero-copy)
        this.worker.postMessage(
          { type: 'transcribe', modelId, audio: audioData, language, sourceLabel },
          [audioData.buffer]
        );
      } catch (err) {
        this._pendingResolve = null;
        this._pendingReject = null;
        reject(err);
      }
    });
  }

  /**
   * Transcribe all audio files in a recording and return an array of SRT file objects.
   * Each SRT file has { name, content, type }.
   */
  async transcribeRecording(recording, modelId, language) {
    this._initWorker();

    const micFile = recording.files.find((f) => f.type === 'microphone');
    const systemFile = recording.files.find((f) => f.type === 'system');
    const importedFile = recording.files.find((f) => f.type === 'imported');

    // Derive a timestamp prefix from the first filename, e.g. "2026-02-12 14-23"
    const prefix = recording.files[0]?.name.match(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}/)?.[0] ?? 'recording';

    let micResult = null;
    let systemResult = null;
    let importedResult = null;

    if (micFile) {
      const r = await this._transcribeBlob(micFile.blob, modelId, language, 'You');
      micResult = r.data;
    }

    if (systemFile) {
      const r = await this._transcribeBlob(systemFile.blob, modelId, language, 'Meeting');
      systemResult = r.data;
    }

    if (importedFile) {
      const r = await this._transcribeBlob(importedFile.blob, modelId, language, 'Speaker');
      importedResult = r.data;
    }

    const srtFiles = [];

    // For imported files, just generate a single SRT
    if (importedResult) {
      srtFiles.push({
        name: `${prefix} Transcription.srt`,
        content: generateSingleSRT(importedResult, 'Speaker'),
        type: 'imported-srt',
      });
      return srtFiles;
    }

    // For recorded files, generate combined + individual SRTs
    if (micResult || systemResult) {
      srtFiles.push({
        name: `${prefix} Combined.srt`,
        content: generateCombinedSRT(micResult, systemResult),
        type: 'combined',
      });
    }

    if (micResult) {
      srtFiles.push({
        name: `${prefix} MicrophoneRecording.srt`,
        content: generateSingleSRT(micResult, 'You'),
        type: 'mic-srt',
      });
    }

    if (systemResult) {
      srtFiles.push({
        name: `${prefix} SystemAudioRecording.srt`,
        content: generateSingleSRT(systemResult, 'Meeting'),
        type: 'system-srt',
      });
    }

    return srtFiles;
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}

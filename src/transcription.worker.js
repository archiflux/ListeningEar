import { pipeline, env } from '@huggingface/transformers';

// Use CDN only — no local model files
env.allowLocalModels = false;

// Single thread avoids SharedArrayBuffer requirement (GitHub Pages compatible)
env.backends.onnx.wasm.numThreads = 1;

let currentPipeline = null;
let currentModelId = null;

self.addEventListener('message', async (event) => {
  const { type, modelId, audio, language, sourceLabel } = event.data;

  if (type !== 'transcribe') return;

  try {
    // Load model if needed (cached between calls)
    if (!currentPipeline || currentModelId !== modelId) {
      currentModelId = modelId;
      self.postMessage({ type: 'model_loading' });

      currentPipeline = await pipeline(
        'automatic-speech-recognition',
        modelId,
        {
          progress_callback: (p) => {
            self.postMessage({ type: 'model_progress', data: p });
          },
        }
      );
    }

    self.postMessage({ type: 'transcribing', sourceLabel });

    const result = await currentPipeline(audio, {
      return_timestamps: true,
      language: language || null,
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    self.postMessage({ type: 'transcription_done', data: result, sourceLabel });

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
});

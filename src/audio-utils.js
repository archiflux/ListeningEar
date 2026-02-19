/**
 * Decode an audio Blob to a Float32Array at 16 kHz (mono) for Whisper.
 * Must run on the main thread — AudioContext is not available in workers.
 */
export async function audioBlobToFloat32Array(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode at the native sample rate first
  const nativeCtx = new AudioContext();
  const audioBuffer = await new Promise((resolve, reject) => {
    nativeCtx.decodeAudioData(arrayBuffer, resolve, reject);
  });
  await nativeCtx.close();

  const TARGET_RATE = 16000;

  if (audioBuffer.sampleRate === TARGET_RATE) {
    return mixdownToMono(audioBuffer);
  }

  // Resample to 16 kHz via OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * TARGET_RATE),
    TARGET_RATE
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

function mixdownToMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const result = new Float32Array(length);

  for (let c = 0; c < channels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      result[i] += channelData[i] / channels;
    }
  }

  return result;
}

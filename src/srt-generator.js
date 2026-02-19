/**
 * Convert seconds to SRT timestamp format: HH:MM:SS,mmm
 */
function toSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return (
    [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':') +
    ',' +
    ms.toString().padStart(3, '0')
  );
}

/**
 * Convert Whisper result chunks into flat entry objects tagged with a speaker label.
 */
function resultToEntries(result, speakerLabel) {
  if (!result?.chunks) return [];

  return result.chunks
    .filter((c) => c.timestamp?.[0] != null)
    .map((c) => ({
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0] + 2,
      text: c.text.trim(),
      speaker: speakerLabel,
    }))
    .filter((e) => e.text.length > 0);
}

function entriesToSRT(entries) {
  if (entries.length === 0) return '(no speech detected)';

  return entries
    .map(
      (e, i) =>
        `${i + 1}\n${toSRTTime(e.start)} --> ${toSRTTime(e.end)}\n[${e.speaker}] ${e.text}`
    )
    .join('\n\n');
}

/**
 * Generate a combined SRT interleaving both speakers in chronological order.
 */
export function generateCombinedSRT(micResult, systemResult, micLabel = 'You', systemLabel = 'Meeting') {
  const entries = [
    ...resultToEntries(micResult, micLabel),
    ...resultToEntries(systemResult, systemLabel),
  ].sort((a, b) => a.start - b.start);

  return entriesToSRT(entries);
}

/**
 * Generate SRT from a single transcription result.
 */
export function generateSingleSRT(result, speakerLabel) {
  return entriesToSRT(resultToEntries(result, speakerLabel));
}

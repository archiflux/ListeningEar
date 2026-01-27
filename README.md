# ListeningEar - Dual Audio Recorder

A web application for recording meetings with **separate audio tracks** for your voice and system audio - perfect for transcription with tools like FasterWhisperXXL.

## Features

- **Dual Audio Recording**: Record your microphone and system/tab audio as separate files
- **Works on Chromebook**: Fully web-based, no installation required
- **Tab Audio Capture**: Capture audio from Teams, Zoom, Google Meet, or any browser tab
- **Real-time Audio Meters**: Visual feedback showing audio levels
- **Separate Downloads**: Download each audio track independently for transcription
- **PWA Support**: Install as an app on your Chromebook

## How It Works

The application uses modern Web APIs:
- `getUserMedia()` - Captures your microphone input
- `getDisplayMedia()` - Captures system/tab audio (Chrome feature)
- `MediaRecorder` - Records streams as WebM/Opus files

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Production Build

```bash
npm run build
npm run preview
```

## Usage Guide

1. **Setup Microphone**
   - Click "Setup Microphone" and grant permission
   - Select your preferred input device from the dropdown

2. **Capture Tab Audio**
   - Click "Capture Tab/Screen Audio"
   - Select the browser tab with your meeting (Teams, Zoom, etc.)
   - **Important**: Check the "Share tab audio" checkbox when prompted

3. **Start Recording**
   - Verify both audio meters show activity
   - Click "Start Recording"

4. **Stop & Download**
   - Click "Stop Recording" when done
   - Download both audio files:
     - `microphone_*.webm` - Your voice
     - `system_audio_*.webm` - Meeting audio

5. **Transcribe**
   - Use FasterWhisperXXL or similar tool
   - Load each audio file separately for speaker-aware transcription

## Tips for Best Results

- **Use Chrome or Edge** for best compatibility with tab audio capture
- **Select "Chrome Tab"** (not window/screen) when sharing for better audio quality
- **Always check "Share tab audio"** checkbox in the sharing dialog
- **Use headphones** to prevent echo between your mic and speakers
- **Keep this tab open** in the background while recording

## Browser Support

| Browser | Microphone | Tab Audio |
|---------|------------|-----------|
| Chrome  | ✅         | ✅        |
| Edge    | ✅         | ✅        |
| Firefox | ✅         | ⚠️ Limited |
| Safari  | ✅         | ❌        |

## Audio Format

Recordings are saved as:
- **Format**: WebM with Opus codec
- **Bitrate**: 128 kbps
- **Compatibility**: Works with most transcription tools

## Transcription Workflow

For use with FasterWhisperXXL or similar tools:

1. Download both audio files after recording
2. Rename them descriptively (e.g., `meeting_my_voice.webm`, `meeting_participants.webm`)
3. Load into your transcription tool
4. Use speaker diarization features to label speakers

## Privacy

- **No server uploads**: All audio is processed locally in your browser
- **No data collection**: Nothing is sent to any external server
- **Session-only storage**: Recordings are not persisted between sessions

## License

MIT License

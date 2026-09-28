/* ===================== VOICE NOTES =====================
   Record a short voice note with the app's own microphone permission and
   turn it into text (backend-worker/src/ai.js → Whisper). Used by the
   assistant chat; the caller gets the text through onText.

   const voice = useVoiceNote({ onText, canRecord });
   voice.start() / voice.stop(); voice.recording, voice.elapsed (ms),
   voice.transcribing, voice.error, voice.needsSettings */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { transcribeAudio } from './api';

const MAX_RECORDING_MS = 60000;

/* Speech needs far less than expo-av's music-quality preset: mono, 16 kHz,
   32 kbps keeps a minute-long note around 240 KB to upload. */
const SPEECH_RECORDING = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

export function useVoiceNote({ onText, canRecord = true, signedOutMessage = 'Sign in to use the assistant.' }) {
  const [recording, setRecording] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const [needsSettings, setNeedsSettings] = useState(false);
  const recordingRef = useRef(null);
  recordingRef.current = recording;
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // Leaving the screen mid-recording releases the mic.
  useEffect(() => () => {
    if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
  }, []);

  async function start() {
    setError(null);
    setNeedsSettings(false);
    // Say so before recording, not after the note has been made.
    if (!canRecord) { setError(signedOutMessage); return; }
    try {
      let perm = await Audio.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setNeedsSettings(Platform.OS !== 'web' && !perm.canAskAgain);
        setError(Platform.OS === 'web'
          ? 'Allow microphone access for this site in your browser, then tap Speak again.'
          : 'The Pickle Slot needs microphone access to hear you. You can still type.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      setElapsed(0);
      const { recording: rec } = await Audio.Recording.createAsync(SPEECH_RECORDING, (status) => {
        if (!status.isRecording) return;
        setElapsed(status.durationMillis);
        if (status.durationMillis >= MAX_RECORDING_MS) stop(rec);
      }, 250);
      setRecording(rec);
    } catch (e) {
      setError("Couldn't start the microphone. Close other apps that might be using it and try again.");
    }
  }

  async function stop(rec = recordingRef.current) {
    if (!rec || recordingRef.current !== rec) return;
    setRecording(null);
    recordingRef.current = null;
    setTranscribing(true);
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      const { text } = await transcribeAudio(rec.getURI());
      setTranscribing(false);
      await onTextRef.current(text);
    } catch (e) {
      setTranscribing(false);
      setError(e.status === 401 ? signedOutMessage : e.message);
    }
  }

  return { start, stop, recording: !!recording, elapsed, transcribing, error, needsSettings, clearError: () => setError(null) };
}

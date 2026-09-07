/**
 * Audio playback helper for Gemini TTS (gemini-3.1-flash-tts-preview) base64 audio response.
 */

let activeAudioSource: AudioBufferSourceNode | null = null;
let activeAudioContext: AudioContext | null = null;
let activeAudioElement: HTMLAudioElement | null = null;

/**
 * Converts a base64 string to an ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Helper to construct a WAV header for raw 24kHz 16-bit mono PCM audio from Gemini TTS
 */
function pcmToWavBlob(pcmBuffer: ArrayBuffer, sampleRate: number = 24000, numChannels: number = 1): Blob {
  const pcmBytes = new Uint8Array(pcmBuffer);
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* RIFF chunk length */
  view.setUint32(4, 36 + pcmBytes.length, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM = 1) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sampleRate * blockAlign) */
  view.setUint32(28, sampleRate * numChannels * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numChannels * 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* data chunk length */
  view.setUint32(40, pcmBytes.length, true);

  const combined = new Uint8Array(44 + pcmBytes.length);
  combined.set(new Uint8Array(wavHeader), 0);
  combined.set(pcmBytes, 44);

  return new Blob([combined], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function stopCurrentAudio() {
  if (activeAudioSource) {
    try {
      activeAudioSource.stop();
    } catch {}
    activeAudioSource = null;
  }
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement = null;
    } catch {}
  }
}

export async function playBase64Audio(
  base64Data: string,
  mimeType: string = "audio/pcm",
  onEnded?: () => void
): Promise<void> {
  stopCurrentAudio();

  try {
    const rawBuffer = base64ToArrayBuffer(base64Data);

    // If mimeType includes pcm or is raw pcm from Gemini TTS
    if (mimeType.includes("pcm") || mimeType.includes("raw")) {
      const wavBlob = pcmToWavBlob(rawBuffer, 24000, 1);
      const audioUrl = URL.createObjectURL(wavBlob);
      const audio = new Audio(audioUrl);
      activeAudioElement = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        activeAudioElement = null;
        if (onEnded) onEnded();
      };

      await audio.play();
    } else {
      // Direct Data URL / WAV / MP3
      const audioUrl = `data:${mimeType};base64,${base64Data}`;
      const audio = new Audio(audioUrl);
      activeAudioElement = audio;

      audio.onended = () => {
        activeAudioElement = null;
        if (onEnded) onEnded();
      };

      await audio.play();
    }
  } catch (err) {
    console.warn("Audio Context playback failed, trying Web Speech fallback:", err);
    if (onEnded) onEnded();
  }
}

/**
 * Offline Browser Speech Synthesis fallback
 */
export function playBrowserTTS(text: string, lang: string = "ar-SA", onEnded?: () => void) {
  stopCurrentAudio();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      if (onEnded) onEnded();
    };
    utterance.onerror = () => {
      if (onEnded) onEnded();
    };
    window.speechSynthesis.speak(utterance);
  } else {
    if (onEnded) onEnded();
  }
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionModule,
  ExpoSpeechRecognitionOptions,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export interface VoiceInput {
  /** True from tap until listening has finished. */
  listening: boolean;
  /** Live transcript (interim + final). */
  transcript: string;
  /** User-facing problem, or null. */
  error: string | null;
  start: () => void;
  /** Stop listening and use what was heard. */
  stop: () => void;
  /** Stop listening and throw the result away. */
  cancel: () => void;
}

/** Google-style timing: give up if nothing is heard, stop after a pause once something was said. */
const NO_SPEECH_MS = 8000;
const SILENCE_AFTER_SPEECH_MS = 2000;
const MAX_LISTEN_MS = 25000;
/** If the recogniser doesn't confirm it stopped (seen in iOS home-screen web apps), finish anyway. */
const STOP_GRACE_MS = 1500;

function messageFor(code: ExpoSpeechRecognitionErrorCode): string | null {
  switch (code) {
    case 'aborted':
      return null; // we cancelled on purpose
    case 'no-speech':
    case 'speech-timeout':
      return "Didn't hear anything. Tap the mic and try again.";
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone or speech access is blocked. Allow it in the iPhone Settings app, then try again.';
    case 'network':
      return 'Voice needs an internet connection right now.';
    case 'audio-capture':
    case 'interrupted':
      return 'The microphone was interrupted. Try again.';
    case 'language-not-supported':
      return "English speech recognition isn't available on this device.";
    default:
      return 'Voice input failed. Try again.';
  }
}

/**
 * Google-style voice search: start() → live transcript → onFinal(text) when listening finishes.
 * Native (iOS SFSpeechRecognizer) via expo-speech-recognition; web via the browser's SpeechRecognition.
 * On web, start() calls the recogniser synchronously inside the tap — Safari only allows mic access
 * from a direct user gesture. Listening always ends (timers + grace period), even if the recogniser
 * never reports "end", so the UI can't get stuck on "Listening…".
 */
export function useVoiceInput(onFinal: (text: string) => void, contextualStrings: string[] = []): VoiceInput {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const finalText = useRef('');
  const latestText = useRef('');
  const cancelled = useRef(false);
  const finished = useRef(true);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const clearTimers = () => {
    for (const t of [silenceTimer, maxTimer, graceTimer]) {
      if (t.current) clearTimeout(t.current);
      t.current = null;
    }
  };

  /** Ends a listening session exactly once, whether the recogniser reported "end" or not. */
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    clearTimers();
    setListening(false);
    if (cancelled.current) return;
    const text = (finalText.current || latestText.current).trim();
    if (text) onFinalRef.current(text);
    else setError(prev => prev ?? "Didn't hear anything. Tap the mic and try again.");
  }, []);

  const requestStop = useCallback(() => {
    if (finished.current) return;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore — finish() below still runs
    }
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => {
      // The recogniser ignored stop() (seen in iOS home-screen web apps: the mic indicator stays on).
      // Force the microphone off, then finish with what was heard.
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // ignore
      }
      finish();
    }, STOP_GRACE_MS);
  }, [finish]);

  const scheduleSilenceStop = useCallback(
    (ms: number) => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(requestStop, ms);
    },
    [requestStop]
  );

  useSpeechRecognitionEvent('start', () => {
    if (!finished.current) setListening(true);
  });

  useSpeechRecognitionEvent('result', event => {
    if (finished.current) return;
    const piece = event.results[0]?.transcript?.trim() ?? '';
    if (event.isFinal) {
      finalText.current = `${finalText.current} ${piece}`.trim();
      latestText.current = finalText.current;
    } else {
      latestText.current = `${finalText.current} ${piece}`.trim();
    }
    setTranscript(latestText.current);
    if (latestText.current) scheduleSilenceStop(SILENCE_AFTER_SPEECH_MS);
  });

  useSpeechRecognitionEvent('nomatch', () => {
    if (!latestText.current) setError("Didn't catch that. Tap the mic and try again.");
  });

  useSpeechRecognitionEvent('error', event => {
    const msg = messageFor(event.error);
    if (msg) setError(msg);
    if (event.error !== 'aborted') finish();
  });

  useSpeechRecognitionEvent('end', finish);

  const start = useCallback(() => {
    clearTimers();
    setError(null);
    setTranscript('');
    finalText.current = '';
    latestText.current = '';
    cancelled.current = false;

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Voice input isn't available here. You can still use the keyboard's mic in any field.");
      return;
    }

    const options: ExpoSpeechRecognitionOptions = {
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      addsPunctuation: false,
      // bias recognition toward the user's friends and payment words (iOS/Android; ignored on web)
      contextualStrings: [...contextualStrings, 'Zelle', 'Apple Pay', 'Venmo', 'tax'].slice(0, 100),
    };

    finished.current = false;
    setListening(true);
    silenceTimer.current = setTimeout(requestStop, NO_SPEECH_MS);
    maxTimer.current = setTimeout(requestStop, MAX_LISTEN_MS);

    if (Platform.OS === 'web') {
      try {
        ExpoSpeechRecognitionModule.start(options); // synchronous, inside the tap
      } catch {
        setError('Could not start the microphone. Try again.');
        finish();
      }
      return;
    }

    ExpoSpeechRecognitionModule.requestPermissionsAsync()
      .then(perm => {
        if (!perm.granted) {
          setError('SplitNote needs microphone and speech permission. Turn them on in Settings → SplitNote.');
          finish();
          return;
        }
        ExpoSpeechRecognitionModule.start(options);
      })
      .catch(() => {
        setError('Could not start the microphone. Try again.');
        finish();
      });
  }, [contextualStrings, requestStop, finish]);

  const stop = useCallback(() => requestStop(), [requestStop]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }
    finished.current = true;
    clearTimers();
    setListening(false);
    setTranscript('');
  }, []);

  // never leave the mic running if the screen goes away
  useEffect(
    () => () => {
      cancelled.current = true;
      finished.current = true;
      clearTimers();
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // ignore
      }
    },
    []
  );

  return { listening, transcript, error, start, stop, cancel };
}

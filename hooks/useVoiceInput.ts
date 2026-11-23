import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionModule,
  ExpoSpeechRecognitionOptions,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export interface VoiceInput {
  /** True from tap until the recogniser ends. */
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
 * Google-style voice search: start() → live transcript → onFinal(text) when the recogniser ends.
 * Native (iOS SFSpeechRecognizer) via expo-speech-recognition; web via the browser's SpeechRecognition.
 * On web, start() calls the recogniser synchronously inside the tap — Safari only allows mic access
 * from a direct user gesture.
 */
export function useVoiceInput(onFinal: (text: string) => void, contextualStrings: string[] = []): VoiceInput {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const finalText = useRef('');
  const latestText = useRef('');
  const cancelled = useRef(false);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useSpeechRecognitionEvent('start', () => setListening(true));

  useSpeechRecognitionEvent('result', event => {
    const piece = event.results[0]?.transcript?.trim() ?? '';
    if (event.isFinal) {
      finalText.current = `${finalText.current} ${piece}`.trim();
      latestText.current = finalText.current;
    } else {
      latestText.current = `${finalText.current} ${piece}`.trim();
    }
    setTranscript(latestText.current);
  });

  useSpeechRecognitionEvent('nomatch', () => {
    if (!latestText.current) setError("Didn't catch that. Tap the mic and try again.");
  });

  useSpeechRecognitionEvent('error', event => {
    const msg = messageFor(event.error);
    if (msg) setError(msg);
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    const text = (finalText.current || latestText.current).trim();
    if (cancelled.current) return;
    if (text) onFinalRef.current(text);
    else setError(prev => prev ?? "Didn't hear anything. Tap the mic and try again.");
  });

  const start = useCallback(() => {
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

    if (Platform.OS === 'web') {
      try {
        ExpoSpeechRecognitionModule.start(options);
        setListening(true);
      } catch {
        setError('Could not start the microphone. Try again.');
      }
      return;
    }

    setListening(true);
    ExpoSpeechRecognitionModule.requestPermissionsAsync()
      .then(perm => {
        if (!perm.granted) {
          setListening(false);
          setError('SplitNote needs microphone and speech permission. Turn them on in Settings → SplitNote.');
          return;
        }
        ExpoSpeechRecognitionModule.start(options);
      })
      .catch(() => {
        setListening(false);
        setError('Could not start the microphone. Try again.');
      });
  }, [contextualStrings]);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    ExpoSpeechRecognitionModule.abort();
    setListening(false);
    setTranscript('');
  }, []);

  // never leave the mic running if the screen goes away
  useEffect(
    () => () => {
      cancelled.current = true;
      ExpoSpeechRecognitionModule.abort();
    },
    []
  );

  return { listening, transcript, error, start, stop, cancel };
}

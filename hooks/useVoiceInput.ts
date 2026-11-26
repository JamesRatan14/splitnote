import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
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

/** Give up if nothing is heard at all. */
const NO_SPEECH_MS = 8000;
/** Stop after this much quiet once something was said (people pause mid-sentence; keep it generous). */
const SILENCE_AFTER_SPEECH_MS = 3000;
const MAX_LISTEN_MS = 30000;
/** If the recogniser doesn't confirm it stopped (seen in iOS home-screen web apps), force it off and finish. */
const STOP_GRACE_MS = 1500;

function messageFor(code: string): string | null {
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
      return 'The microphone was busy. Tap the mic to try again.';
    case 'language-not-supported':
      return "English speech recognition isn't available on this device.";
    default:
      return 'Voice input failed. Tap the mic to try again.';
  }
}

/**
 * Joins recogniser segments into one transcript. iOS sometimes reports cumulative segments
 * ("dinner", "dinner 84", "dinner 84 with Rahul") — keep the longer one instead of repeating words.
 */
export function mergeSegments(segments: string[]): string {
  const parts: string[] = [];
  for (const raw of segments) {
    const t = raw.trim();
    if (!t) continue;
    const last = parts[parts.length - 1];
    if (last && t.toLowerCase().startsWith(last.toLowerCase())) parts[parts.length - 1] = t;
    else if (last && last.toLowerCase().includes(t.toLowerCase())) continue;
    else parts.push(t);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ---- minimal typing for the browser's SpeechRecognition (not in every TS DOM lib) ----
interface WebSpeechAlternative {
  transcript: string;
}
interface WebSpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: WebSpeechAlternative;
}
interface WebSpeechResultEvent {
  results: { length: number; [index: number]: WebSpeechResult };
}
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: WebSpeechResultEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type WebSpeechCtor = new () => WebSpeechRecognition;

function webSpeechCtor(): WebSpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: WebSpeechCtor; webkitSpeechRecognition?: WebSpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function detach(rec: WebSpeechRecognition | null) {
  if (!rec) return;
  rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
  try {
    rec.abort();
  } catch {
    // ignore
  }
}

/**
 * Google-style voice search: start() → live transcript → onFinal(text) when listening finishes.
 *
 * Web: drives the browser's SpeechRecognition directly, one instance per session, so late events
 * from a previous (force-stopped) session can never leak into a new one. start() runs synchronously
 * inside the tap (Safari only allows mic access from a direct gesture). Continuous mode + our own
 * silence timer, so a mid-sentence pause doesn't end listening.
 * Native: expo-speech-recognition (iOS SFSpeechRecognizer), same timing rules.
 * Listening always ends (timers + grace period), so the UI can't get stuck on "Listening…".
 */
export function useVoiceInput(onFinal: (text: string) => void, contextualStrings: string[] = []): VoiceInput {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const text = useRef('');
  const cancelled = useRef(false);
  const finished = useRef(true);
  const webRec = useRef<WebSpeechRecognition | null>(null);
  /** Native: ignore stray end/error events until this session's own "start" arrives. */
  const nativeStarted = useRef(false);
  const nativeFinals = useRef<string[]>([]);
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

  const forceOff = () => {
    if (Platform.OS === 'web') {
      detach(webRec.current);
      webRec.current = null;
    } else {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // ignore
      }
    }
  };

  /** Ends a listening session exactly once. */
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    clearTimers();
    setListening(false);
    if (Platform.OS === 'web') {
      detach(webRec.current); // make sure the mic is released
      webRec.current = null;
    }
    if (cancelled.current) return;
    const heard = text.current.trim();
    if (heard) onFinalRef.current(heard);
    else setError(prev => prev ?? "Didn't hear anything. Tap the mic and try again.");
  }, []);

  const requestStop = useCallback(() => {
    if (finished.current) return;
    try {
      if (Platform.OS === 'web') webRec.current?.stop();
      else ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore — the grace timer still finishes
    }
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => {
      forceOff(); // the recogniser ignored stop(): turn the mic off ourselves
      finish();
    }, STOP_GRACE_MS);
  }, [finish]);

  const onHeard = useCallback(
    (full: string) => {
      if (finished.current) return;
      text.current = full;
      setTranscript(full);
      if (full) {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(requestStop, SILENCE_AFTER_SPEECH_MS);
      }
    },
    [requestStop]
  );

  const onProblem = useCallback(
    (code: string) => {
      if (finished.current) return;
      const msg = messageFor(code);
      if (msg) setError(msg);
      if (code !== 'aborted' && code !== 'no-speech') finish();
    },
    [finish]
  );

  // ---- native events (expo-speech-recognition); unused on web ----
  useSpeechRecognitionEvent('start', () => {
    if (Platform.OS === 'web' || finished.current) return;
    nativeStarted.current = true;
  });
  useSpeechRecognitionEvent('result', event => {
    if (Platform.OS === 'web' || finished.current || !nativeStarted.current) return;
    const piece = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      nativeFinals.current = [...nativeFinals.current, piece];
      onHeard(mergeSegments(nativeFinals.current));
    } else {
      onHeard(mergeSegments([...nativeFinals.current, piece]));
    }
  });
  useSpeechRecognitionEvent('error', event => {
    if (Platform.OS === 'web' || !nativeStarted.current) return;
    onProblem(event.error);
  });
  useSpeechRecognitionEvent('end', () => {
    if (Platform.OS === 'web' || !nativeStarted.current) return;
    finish();
  });

  const start = useCallback(() => {
    clearTimers();
    forceOff(); // release anything left from a previous session
    setError(null);
    setTranscript('');
    text.current = '';
    nativeFinals.current = [];
    nativeStarted.current = false;
    cancelled.current = false;
    finished.current = false;
    setListening(true);
    silenceTimer.current = setTimeout(requestStop, NO_SPEECH_MS);
    maxTimer.current = setTimeout(requestStop, MAX_LISTEN_MS);

    if (Platform.OS === 'web') {
      const Ctor = webSpeechCtor();
      if (!Ctor) {
        setError("Voice input isn't available in this browser. You can still use the keyboard's mic in any field.");
        finish();
        return;
      }
      const rec = new Ctor();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      // every handler checks it still belongs to the current session
      rec.onresult = ev => {
        if (webRec.current !== rec) return;
        const segments: string[] = [];
        for (let i = 0; i < ev.results.length; i++) segments.push(ev.results[i][0]?.transcript ?? '');
        onHeard(mergeSegments(segments));
      };
      rec.onerror = ev => {
        if (webRec.current !== rec) return;
        onProblem(ev.error);
      };
      rec.onend = () => {
        if (webRec.current !== rec) return;
        finish();
      };
      webRec.current = rec;
      try {
        rec.start(); // synchronous, inside the tap
      } catch {
        setError('The microphone was busy. Tap the mic to try again.');
        finish();
      }
      return;
    }

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Voice input isn't available on this device.");
      finish();
      return;
    }
    const options: ExpoSpeechRecognitionOptions = {
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      addsPunctuation: false,
      // bias recognition toward the user's friends and payment words
      contextualStrings: [...contextualStrings, 'Zelle', 'Apple Pay', 'Venmo', 'tax'].slice(0, 100),
    };
    ExpoSpeechRecognitionModule.requestPermissionsAsync()
      .then(perm => {
        if (finished.current) return;
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
  }, [contextualStrings, requestStop, finish, onHeard, onProblem]);

  const stop = useCallback(() => requestStop(), [requestStop]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    finished.current = true;
    clearTimers();
    forceOff();
    setListening(false);
    setTranscript('');
  }, []);

  // never leave the mic running if the screen goes away
  useEffect(
    () => () => {
      cancelled.current = true;
      finished.current = true;
      clearTimers();
      forceOff();
    },
    []
  );

  return { listening, transcript, error, start, stop, cancel };
}

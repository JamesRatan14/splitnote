import { Alert, AlertButton, Platform } from 'react-native';

/**
 * Drop-in replacement for `Alert.alert` that also works on web.
 * react-native-web's Alert is a silent no-op, so on web we fall back to the browser's
 * blocking `window.confirm` / `window.alert`. The chosen button's `onPress` is called
 * synchronously so browser-gesture-gated actions (e.g. opening a file picker) still work.
 *
 * Web mapping: with a cancel button plus an action button, OK = the first non-cancel
 * button and Cancel = the cancel button. With a single button, it is an info alert.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];
  const cancel = list.find(b => b.style === 'cancel');
  const action = list.find(b => b.style !== 'cancel');

  if (list.length < 2 || !action) {
    window.alert(text);
    (action ?? cancel)?.onPress?.();
    return;
  }

  if (window.confirm(text)) {
    action.onPress?.();
  } else {
    cancel?.onPress?.();
  }
}

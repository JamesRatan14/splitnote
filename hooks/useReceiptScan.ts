import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { todayISO } from '../utils/formatters';
import { AiError, AiResult, AiSettings, aiReadReceipt } from '../utils/ai/client';

/** Claude reads receipts fine at this size; it also keeps uploads well under the server's 4.5 MB limit. */
const MAX_SIDE = 1568;

export type ReceiptOutcome =
  | { kind: 'ok'; result: AiResult }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

async function pickImage(source: 'camera' | 'library'): Promise<ImagePicker.ImagePickerAsset | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  // On web the picker must open inside the tap (no awaits before it), and permissions don't apply.
  if (Platform.OS !== 'web') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new AiError('server', `Allow ${source === 'camera' ? 'camera' : 'photo'} access in Settings → SplitNote.`);
  }
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled || !result.assets?.[0] ? null : result.assets[0];
}

async function toJpegBase64(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const w = asset.width || 0;
  const h = asset.height || 0;
  if (Math.max(w, h) > MAX_SIDE) ctx.resize(w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new AiError('server', 'Could not prepare the photo');
  return saved.base64.replace(/^data:image\/\w+;base64,/, '');
}

/** Photo → resized JPEG → Claude (via the proxy) → validated expense fields. */
export function useReceiptScan(ai: AiSettings) {
  const [busy, setBusy] = useState(false);

  const scan = useCallback(
    async (source: 'camera' | 'library'): Promise<ReceiptOutcome> => {
      let asset: ImagePicker.ImagePickerAsset | null;
      try {
        asset = await pickImage(source);
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : 'Could not open the camera' };
      }
      if (!asset) return { kind: 'cancelled' };

      setBusy(true);
      try {
        const base64 = await toJpegBase64(asset);
        const result = await aiReadReceipt(ai, base64, 'image/jpeg', todayISO());
        return { kind: 'ok', result };
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : 'Could not read the receipt' };
      } finally {
        setBusy(false);
      }
    },
    [ai]
  );

  return { scan, busy };
}

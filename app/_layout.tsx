import { Stack } from 'expo-router';
import { Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Colors } from '../constants/Colors';
import { initAutoBackup } from '../utils/autoBackup';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
  });
}

export default function RootLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  useEffect(() => {
    initAutoBackup().catch(console.error);
  }, []);

  // Web: paint the page itself in the app background, so no white strip shows around the app
  // (e.g. under the home indicator in iOS home-screen mode).
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = colors.background;
      document.body.style.backgroundColor = colors.background;
    }
  }, [colors.background]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="transaction/new"
          options={{
            headerShown: false,
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="transaction/[id]"
          options={{
            title: 'Expense Detail',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}

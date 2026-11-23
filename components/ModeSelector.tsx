import React from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { PaymentMode } from '../types';
import { PAYMENT_MODES } from '../constants/PaymentModes';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

interface ModeSelectorProps {
  selected: PaymentMode;
  onSelect: (mode: PaymentMode) => void;
}

export function ModeSelector({ selected, onSelect }: ModeSelectorProps) {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {PAYMENT_MODES.map(mode => {
        const isSelected = mode === selected;
        return (
          <TouchableOpacity
            key={mode}
            onPress={() => onSelect(mode)}
            style={[
              styles.pill,
              {
                backgroundColor: isSelected ? colors.primary : colors.surfaceHigh,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.pillText,
                {
                  color: isSelected ? '#FFFFFF' : colors.textSecondary,
                  fontWeight: isSelected ? '600' : '400',
                },
              ]}
            >
              {mode}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  pill: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    ...Typography.body,
  },
});

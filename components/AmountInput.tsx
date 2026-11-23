import React, { forwardRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  useColorScheme,
  TextInputProps,
} from 'react-native';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

interface AmountInputProps {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  placeholder?: string;
}

export const AmountInput = forwardRef<TextInput, AmountInputProps>(
  ({ value, onChangeText, error, placeholder = '0' }, ref) => {
    const colorScheme = useColorScheme() ?? 'dark';
    const colors = Colors[colorScheme];

    const handleChange = (text: string) => {
      // Allow digits and a single decimal point
      const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1');
      onChangeText(cleaned);
    };

    return (
      <View>
        <View
          style={[
            styles.inputRow,
            {
              backgroundColor: colors.surfaceHigh,
              borderColor: error ? colors.danger : colors.border,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={[styles.prefix, { color: colors.primary }]}>$</Text>
          <TextInput
            ref={ref}
            value={value}
            onChangeText={handleChange}
            keyboardType="decimal-pad"
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text }]}
            returnKeyType="done"
            maxLength={10} // e.g. "1000000.00"
          />
        </View>
        {error ? (
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
        ) : null}
      </View>
    );
  }
);

AmountInput.displayName = 'AmountInput';

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    height: 52,
  },
  prefix: {
    ...Typography.h2,
    marginRight: Spacing.xs,
  },
  input: {
    flex: 1,
    ...Typography.h2,
    paddingVertical: 0,
  },
  errorText: {
    ...Typography.caption,
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
  },
});

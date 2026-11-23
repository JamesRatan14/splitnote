import React from 'react';

interface Props {
  value: string; // YYYY-MM-DD
  max: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
  backgroundColor: string;
  borderColor: string;
  color: string;
  dark: boolean;
}

/** Browser-native date input. Used only on web, where @react-native-community/datetimepicker is unsupported. */
export default function WebDateInput({ value, max, onChange, backgroundColor, borderColor, color, dark }: Props) {
  return React.createElement('input', {
    type: 'date',
    value,
    max,
    onChange: (e: { target: { value: string } }) => {
      if (e.target.value) onChange(e.target.value);
    },
    style: {
      width: '100%',
      boxSizing: 'border-box',
      padding: 12,
      fontSize: 15,
      borderRadius: 12,
      border: `1px solid ${borderColor}`,
      backgroundColor,
      color,
      colorScheme: dark ? 'dark' : 'light',
      fontFamily: 'inherit',
    },
  });
}

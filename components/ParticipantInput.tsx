import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

interface ParticipantInputProps {
  participants: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  getSuggestions: (query: string) => string[];
  error?: string;
}

export function ParticipantInput({
  participants,
  onAdd,
  onRemove,
  getSuggestions,
  error,
}: ParticipantInputProps) {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const suggestions = getSuggestions(query).filter(
    s => !participants.map(p => p.toLowerCase()).includes(s.toLowerCase())
  );

  const handleAdd = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // Dedup case-insensitive
      const alreadyAdded = participants.some(
        p => p.toLowerCase() === trimmed.toLowerCase()
      );
      if (!alreadyAdded && participants.length < 20) {
        onAdd(trimmed);
      }
      setQuery('');
      setShowDropdown(false);
    },
    [participants, onAdd]
  );

  const handleSubmitEditing = () => {
    if (query.trim()) {
      handleAdd(query);
    }
  };

  return (
    <View>
      {/* Pills for added participants */}
      {participants.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillsScroll}
          contentContainerStyle={styles.pillsContainer}
        >
          {participants.map(name => (
            <View
              key={name}
              style={[styles.pill, { backgroundColor: colors.primaryLight }]}
            >
              <Text
                style={[styles.pillText, { color: colors.primary }]}
                numberOfLines={1}
              >
                {name}
              </Text>
              <TouchableOpacity
                onPress={() => onRemove(name)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={14} color={colors.primary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Text input */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.surfaceHigh,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      >
        <TextInput
          value={query}
          onChangeText={text => {
            setQuery(text);
            setShowDropdown(text.trim().length > 0 || getSuggestions('').length > 0);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => {
            // Delay to allow tap on suggestion
            setTimeout(() => setShowDropdown(false), 200);
          }}
          onSubmitEditing={handleSubmitEditing}
          placeholder={
            participants.length === 0
              ? 'Type friend name and press return'
              : 'Add another friend...'
          }
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.text }]}
          returnKeyType="done"
          blurOnSubmit={false}
          autoCapitalize="words"
        />
        {query.trim().length > 0 && (
          <TouchableOpacity
            onPress={() => handleAdd(query)}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Autocomplete dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <View
          style={[
            styles.dropdown,
            {
              backgroundColor: colors.surfaceHigh,
              borderColor: colors.border,
            },
          ]}
        >
          {suggestions.map(suggestion => (
            <TouchableOpacity
              key={suggestion}
              style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
              onPress={() => handleAdd(suggestion)}
            >
              <Ionicons
                name="person-outline"
                size={14}
                color={colors.textSecondary}
                style={{ marginRight: Spacing.sm }}
              />
              <Text style={[styles.suggestionText, { color: colors.text }]}>
                {suggestion}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error ? (
        <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pillsScroll: {
    marginBottom: Spacing.sm,
  },
  pillsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    gap: Spacing.xs,
    maxWidth: 150,
  },
  pillText: {
    ...Typography.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    height: 52,
  },
  input: {
    flex: 1,
    ...Typography.body,
    paddingVertical: 0,
  },
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: {
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing.xs,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    ...Typography.body,
  },
  errorText: {
    ...Typography.caption,
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
  },
});

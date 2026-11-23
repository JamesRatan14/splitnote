import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useColorScheme,
  Animated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Transaction } from '../types';
import { getTotalToCollect } from '../utils/calculations';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

interface TransactionCardProps {
  transaction: Transaction;
  onMarkSynced?: (id: string) => void;
  onDelete?: (id: string) => void;
  showSwipe?: boolean;
}

export function TransactionCard({
  transaction,
  onMarkSynced,
  onDelete,
  showSwipe = true,
}: TransactionCardProps) {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const swipeableRef = useRef<Swipeable>(null);

  const totalToCollect = getTotalToCollect(transaction);
  const isPending = transaction.syncStatus === 'pending';

  const handlePress = () => {
    router.push(`/transaction/${transaction.id}`);
  };

  const renderLeftActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [0.8, 1],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        style={[
          styles.swipeAction,
          styles.syncAction,
          { transform: [{ scale }] },
        ]}
      >
        <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
        <Text style={styles.swipeActionText}>Synced</Text>
      </Animated.View>
    );
  };

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.8],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        style={[
          styles.swipeAction,
          styles.deleteAction,
          { transform: [{ scale }] },
        ]}
      >
        <Ionicons name="trash" size={22} color="#FFFFFF" />
        <Text style={styles.swipeActionText}>Delete</Text>
      </Animated.View>
    );
  };

  const card = (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {/* Content row with left accent bar */}
      <View style={styles.contentRow}>
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: colors.primary }]} />

        {/* Main content */}
        <View style={styles.mainContent}>
          <View style={styles.topRow}>
            <Text
              style={[styles.title, { color: colors.text }]}
              numberOfLines={2}
            >
              {transaction.title}
            </Text>
            <Text style={[styles.amount, { color: colors.primary }]}>
              {formatCurrency(transaction.amount + (transaction.tax ?? 0))}
            </Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {formatDate(transaction.date)} · {transaction.mode}
            </Text>
          </View>

          {transaction.participants.length > 0 && (
            <Text style={[styles.participants, { color: colors.textSecondary }]} numberOfLines={1}>
              with {transaction.participants.slice(0, 2).join(', ')}
              {transaction.participants.length > 2
                ? ` +${transaction.participants.length - 2}`
                : ''}
            </Text>
          )}

          <View style={styles.bottomRow}>
            {totalToCollect > 0 && (
              <Text style={[styles.toCollect, { color: colors.primary }]}>
                Collect {formatCurrency(totalToCollect)}
              </Text>
            )}

            {isPending ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.pendingLight }]}>
                <View style={[styles.statusDot, { backgroundColor: colors.pending }]} />
                <Text style={[styles.statusBadgeText, { color: colors.pending }]}>PENDING</Text>
              </View>
            ) : (
              <View style={[styles.statusBadge, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="checkmark-circle" size={11} color={colors.success} />
                <Text style={[styles.statusBadgeText, { color: colors.success }]}>SYNCED</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );

  if (!showSwipe) {
    return <View style={styles.wrapper}>{card}</View>;
  }

  return (
    <View style={styles.wrapper}>
      <Swipeable
        ref={swipeableRef}
        renderLeftActions={onMarkSynced ? renderLeftActions : undefined}
        renderRightActions={onDelete ? renderRightActions : undefined}
        onSwipeableOpen={(direction, swipeable) => {
          if (direction === 'left' && onMarkSynced) {
            swipeable.close();
            onMarkSynced(transaction.id);
          } else if (direction === 'right' && onDelete) {
            swipeable.close();
            onDelete(transaction.id);
          }
        }}
        friction={2}
        leftThreshold={60}
        rightThreshold={60}
      >
        {card}
      </Swipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  contentRow: {
    flexDirection: 'row',
    padding: Spacing.lg,
  },
  accentBar: {
    width: 3,
    borderRadius: 2,
    alignSelf: 'stretch',
    marginRight: Spacing.md,
  },
  mainContent: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  title: {
    ...Typography.h3,
    flex: 1,
  },
  amount: {
    ...Typography.amountSm,
    flexShrink: 0,
  },
  metaRow: {
    marginBottom: Spacing.xs,
  },
  metaText: {
    ...Typography.caption,
  },
  participants: {
    ...Typography.caption,
    marginBottom: Spacing.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  toCollect: {
    ...Typography.caption,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusBadgeText: {
    ...Typography.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
  },
  syncAction: {
    backgroundColor: '#00D4B8',
    marginRight: Spacing.xs,
  },
  deleteAction: {
    backgroundColor: '#FF5C5C',
    marginLeft: Spacing.xs,
  },
  swipeActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});

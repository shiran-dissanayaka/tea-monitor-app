import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';

/**
 * Content stops widening past this. On a tablet a full-width row would leave a
 * hand's width of empty space between a label and its value, which is harder
 * to read, not easier.
 */
export const MAX_CONTENT = 620;
export const GUTTER = 18;

/**
 * One place that knows about screen size and system bars.
 *
 * insets matter on three counts: the status bar and notch at the top, the
 * three-button navigation bar at the bottom, and — once rotation is allowed —
 * the notch moving to the left or right edge in landscape. Hard-coded padding
 * gets all three wrong on some phone.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usable = width - insets.left - insets.right;
  return {
    width,
    height,
    insets,
    usable,
    contentWidth: Math.min(usable, MAX_CONTENT),
    /** Tablet-sized, or a phone held landscape. */
    wide: usable >= 700,
    landscape: width > height,
  };
}

/** Scrollable page with the standard margins. Use for anything not a list. */
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { insets } = useLayout();
  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[
        s.scroll,
        {
          paddingTop: insets.top + 8,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[s.content, style]}>{children}</View>
    </ScrollView>
  );
}

/** Padding for a list that manages its own scrolling (SectionList, FlatList). */
export function useListPadding() {
  const { insets } = useLayout();
  return {
    style: s.root,
    contentContainerStyle: {
      alignItems: 'center' as const,
      paddingTop: insets.top + 8,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: 28,
    },
    itemStyle: s.content,
  };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.shell },
  scroll: { alignItems: 'center', paddingBottom: 28 },
  content: { width: '100%', maxWidth: MAX_CONTENT, paddingHorizontal: GUTTER },
});

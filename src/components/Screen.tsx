import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, ViewStyle } from 'react-native';
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
 * Centring is done with padding, not by nesting a width-capped view inside a
 * centred container. The nested approach broke flexible rows: a child with
 * flex: 1 inside it collapsed to nothing, which is why alert text vanished
 * while the pip and timestamp still showed.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usable = width - insets.left - insets.right;
  const side = Math.max(GUTTER, (usable - MAX_CONTENT) / 2 + GUTTER);

  return {
    width,
    height,
    insets,
    usable,
    /** Horizontal padding that both pads and centres. */
    side,
    /** Width actually available to content, after that padding. */
    contentWidth: Math.min(usable, MAX_CONTENT) - GUTTER * 2,
    /** Tablet-sized, or a phone held landscape. */
    wide: usable >= 700,
    landscape: width > height,
  };
}

/** Scrollable page with standard margins. Use for anything that is not a list. */
export function Screen({
  children,
  contentStyle,
}: {
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}) {
  const { insets, side } = useLayout();
  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[
        {
          paddingTop: insets.top + 8,
          paddingBottom: 28,
          paddingLeft: insets.left + side,
          paddingRight: insets.right + side,
        },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** Same padding for a list that manages its own scrolling. */
export function useListPadding() {
  const { insets, side } = useLayout();
  return {
    style: s.root,
    contentContainerStyle: {
      paddingTop: insets.top + 8,
      paddingBottom: 28,
      paddingLeft: insets.left + side,
      paddingRight: insets.right + side,
    },
  };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.shell },
});

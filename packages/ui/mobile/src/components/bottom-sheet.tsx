import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetFooter as GBottomSheetFooter,
  BottomSheetView as GBottomSheetView,
  useBottomSheetModal,
} from "@gorhom/bottom-sheet";
import {
  SCROLLABLE_TYPE,
  createBottomSheetScrollableComponent,
} from "@gorhom/bottom-sheet";
import { useTheme } from "@react-navigation/native";
import * as Slot from "@rn-primitives/slot";
import * as React from "react";
import { memo } from "react";
import { Keyboard, Platform, Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Reanimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { cn } from "@turbostarter/ui";

import { Text } from "./text";

import type {
  BottomSheetScrollViewMethods,
  BottomSheetScrollView as GBottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import type {
  BottomSheetBackdropProps,
  BottomSheetFooterProps as GBottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import type { BottomSheetModalMethods } from "@gorhom/bottom-sheet/lib/typescript/types";
import type { GestureResponderEvent, ViewStyle } from "react-native";
import type { KeyboardAwareScrollViewProps } from "react-native-keyboard-controller";

interface BottomSheetContext {
  sheetRef: React.RefObject<BottomSheetModal | null>;
}

const BottomSheetContext = React.createContext<BottomSheetContext | null>(null);

function BottomSheet({ ...props }: React.ComponentProps<typeof View>) {
  const sheetRef = React.useRef<BottomSheetModal>(null);

  return (
    <BottomSheetContext.Provider value={{ sheetRef: sheetRef }}>
      <View {...props} />
    </BottomSheetContext.Provider>
  );
}

function useBottomSheetContext() {
  const context = React.useContext(BottomSheetContext);
  if (!context) {
    throw new Error(
      "BottomSheet compound components cannot be rendered outside the BottomSheet component",
    );
  }
  return context;
}

const CLOSED_INDEX = -1;

type BottomSheetContentRef = React.ComponentRef<typeof BottomSheetModal>;

type BottomSheetContentProps = Omit<
  React.ComponentProps<typeof BottomSheetModal>,
  "backdropComponent"
> & {
  backdropProps?: Partial<React.ComponentProps<typeof BottomSheetBackdrop>>;
};

const BottomSheetContent = React.forwardRef<
  BottomSheetContentRef,
  BottomSheetContentProps
>(
  (
    {
      enablePanDownToClose = true,
      enableDynamicSizing = true,
      backdropProps,
      backgroundStyle,
      android_keyboardInputMode = "adjustResize",
      ...props
    },
    ref,
  ) => {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { sheetRef } = useBottomSheetContext();

    React.useImperativeHandle(ref, () => {
      if (!sheetRef.current) {
        return {} as BottomSheetModalMethods;
      }
      return sheetRef.current;
    }, [sheetRef]);

    const renderBackdrop = React.useCallback(
      (props: BottomSheetBackdropProps) => {
        const {
          pressBehavior = "close",
          disappearsOnIndex = CLOSED_INDEX,
          style,
          onPress,
          ...rest
        } = {
          ...props,
          ...backdropProps,
        };
        return (
          <BottomSheetBackdrop
            disappearsOnIndex={disappearsOnIndex}
            pressBehavior={pressBehavior}
            style={style}
            onPress={() => {
              if (Keyboard.isVisible()) {
                Keyboard.dismiss();
              }
              onPress?.();
            }}
            {...rest}
          />
        );
      },
      [backdropProps],
    );

    return (
      <BottomSheetModal
        ref={sheetRef}
        index={0}
        enablePanDownToClose={enablePanDownToClose}
        backdropComponent={renderBackdrop}
        enableDynamicSizing={enableDynamicSizing}
        backgroundStyle={[{ backgroundColor: colors.card }, backgroundStyle]}
        handleIndicatorStyle={{
          backgroundColor: colors.border,
        }}
        topInset={insets.top}
        android_keyboardInputMode={android_keyboardInputMode}
        {...props}
      />
    );
  },
);

function BottomSheetOpenTrigger({
  onPress,
  asChild = false,
  ...props
}: React.ComponentProps<typeof Pressable> & {
  asChild?: boolean;
}) {
  const { sheetRef } = useBottomSheetContext();
  function handleOnPress(ev: GestureResponderEvent) {
    sheetRef.current?.present();
    onPress?.(ev);
  }
  const Trigger = asChild ? Slot.Pressable : Pressable;
  return <Trigger onPress={handleOnPress} {...props} />;
}

function BottomSheetCloseTrigger({
  onPress,
  asChild = false,
  ...props
}: React.ComponentProps<typeof Pressable> & {
  asChild?: boolean;
}) {
  const { dismiss } = useBottomSheetModal();
  function handleOnPress(ev: GestureResponderEvent) {
    dismiss();
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
    }
    onPress?.(ev);
  }
  const Trigger = asChild ? Slot.Pressable : Pressable;
  return <Trigger onPress={handleOnPress} {...props} />;
}

const BOTTOM_SHEET_HEADER_HEIGHT = 60; // BottomSheetHeader height

function BottomSheetView({
  className,
  children,
  hadHeader = false,
  style,
  ...props
}: Omit<React.ComponentProps<typeof GBottomSheetView>, "style"> & {
  hadHeader?: boolean;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const paddingBottom =
    insets.bottom +
    (Platform.select({
      ios: 4,
      android: 16,
    }) ?? 0) +
    (hadHeader ? BOTTOM_SHEET_HEADER_HEIGHT : 0);

  return (
    <GBottomSheetView
      style={[
        {
          paddingBottom,
        },
        style,
      ]}
      className={cn(`gap-4 px-6 pt-4`, className)}
      {...props}
    >
      {children}
    </GBottomSheetView>
  );
}

type BottomSheetScrollViewProps = Omit<
  React.ComponentPropsWithoutRef<typeof GBottomSheetScrollView>,
  "style"
> & {
  hadHeader?: boolean;
  className?: string;
  contentContainerClassName?: string;
  style?: ViewStyle;
};

const BottomSheetKeyboardAwareScrollView = memo(
  createBottomSheetScrollableComponent<
    BottomSheetScrollViewMethods,
    BottomSheetScrollViewProps
  >(
    SCROLLABLE_TYPE.SCROLLVIEW,
    Reanimated.createAnimatedComponent<KeyboardAwareScrollViewProps>(
      KeyboardAwareScrollView,
    ),
  ),
);

const StyledBottomSheetKeyboardAwareScrollView = withUniwind(
  BottomSheetKeyboardAwareScrollView,
);

function BottomSheetScrollView({
  children,
  hadHeader = false,
  style,
  className,
  contentContainerClassName,
  ...props
}: BottomSheetScrollViewProps) {
  const insets = useSafeAreaInsets();
  const paddingBottom =
    insets.bottom +
    (Platform.select({
      ios: 8,
      android: 16,
    }) ?? 0) +
    (hadHeader ? BOTTOM_SHEET_HEADER_HEIGHT : 0);

  return (
    <StyledBottomSheetKeyboardAwareScrollView
      className={cn("h-full px-6 pt-4", className)}
      contentContainerClassName={cn("gap-4", contentContainerClassName)}
      keyboardShouldPersistTaps="handled"
      bounces={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        {
          gap: 16,
          paddingBottom,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </StyledBottomSheetKeyboardAwareScrollView>
  );
}

function BottomSheetHeader({
  className,
  ...props
}: React.ComponentProps<typeof View>) {
  return <View className={cn("items-start gap-0.5", className)} {...props} />;
}

/**
 * To be used in a useCallback function as a props to BottomSheetContent
 */
function BottomSheetFooter({
  bottomSheetFooterProps,
  children,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<typeof View>, "style"> & {
  bottomSheetFooterProps: GBottomSheetFooterProps;
  children?: React.ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <GBottomSheetFooter {...bottomSheetFooterProps}>
      <View
        style={[{ paddingBottom: insets.bottom + 6 }, style]}
        className={cn("px-6 pt-1.5", className)}
        {...props}
      >
        {children}
      </View>
    </GBottomSheetFooter>
  );
}

function BottomSheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn(
        "font-sans-semibold text-xl leading-tight tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function BottomSheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function useBottomSheet() {
  const ref = React.useRef<BottomSheetContentRef>(null);

  const open = React.useCallback(() => {
    ref.current?.present();
  }, []);

  const close = React.useCallback(() => {
    ref.current?.dismiss();
  }, []);

  return { ref, open, close };
}

export {
  BottomSheet,
  BottomSheetCloseTrigger,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetView,
  BottomSheetTitle,
  BottomSheetDescription,
  type BottomSheetContentRef,
  useBottomSheet,
};

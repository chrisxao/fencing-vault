import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: PropsWithChildren<{ scroll?: boolean; contentStyle?: StyleProp<ViewStyle> }>) {
  const { colors } = useTheme();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.screenContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, styles.flex, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.flex, { backgroundColor: colors.background }]}>
      {content}
    </SafeAreaView>
  );
}

export function PageTitle({ children, subtitle }: PropsWithChildren<{ subtitle?: string }>) {
  const { colors } = useTheme();
  return (
    <View style={styles.titleBlock}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{children}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Panel({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  autoCapitalize = 'none',
  editable = true,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  editable?: boolean;
} & Omit<TextInputProps, 'style' | 'value' | 'onChangeText'>) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        editable={editable}
        style={[
          styles.input,
          multiline && styles.multiline,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.elevated },
        ]}
      />
    </View>
  );
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  compact,
}: PropsWithChildren<{
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}>) {
  const { colors } = useTheme();
  const primary = variant === 'primary';
  const danger = variant === 'danger';
  const backgroundColor = primary ? colors.accent : 'transparent';
  const foreground = primary ? colors.accentText : danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        {
          backgroundColor,
          borderColor: danger ? colors.danger : primary ? colors.accent : colors.border,
          opacity: disabled || busy ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: foreground }]}>{children}</Text>
      )}
    </Pressable>
  );
}

export function Pill({
  children,
  selected,
  onPress,
  color,
}: PropsWithChildren<{
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}>) {
  const { colors } = useTheme();
  const tint = color ?? colors.accent;
  const content = (
    <Text style={[styles.pillText, { color: selected ? tint : colors.muted }]}>{children}</Text>
  );
  if (!onPress) {
    return (
      <View style={[styles.pill, { borderColor: selected ? tint : colors.border }]}>{content}</View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: selected ? tint : colors.border, opacity: pressed ? 0.65 : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

export function ChoiceRow({ children }: { children: ReactNode }) {
  return <View style={styles.choiceRow}>{children}</View>;
}

export function Message({ children, error }: PropsWithChildren<{ error?: boolean }>) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.message, { color: error ? colors.danger : colors.success }]}>{children}</Text>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={[styles.subtitle, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenContent: { padding: 18, gap: 16, paddingBottom: 36 },
  titleBlock: { gap: 4, marginVertical: 4 },
  pageTitle: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.7 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  multiline: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  button: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { minHeight: 36, paddingHorizontal: 12 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  pill: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  message: { fontSize: 14, lineHeight: 20 },
  loading: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
});

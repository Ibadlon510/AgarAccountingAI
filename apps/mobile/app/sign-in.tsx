import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSignIn, useAuth } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';
import { useTheme } from '../src/theme/useTheme';
import { fonts, spacing, radius } from '../src/theme/tokens';

export default function SignInScreen() {
  const { colors } = useTheme();
  const { isSignedIn } = useAuth();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isSignedIn) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    if (!isLoaded || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const attempt = await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
      } else {
        setError('Additional verification is required. Finish signing in on the web app for now.');
      }
    } catch (err) {
      const message = err && typeof err === 'object' && 'errors' in err
        ? (err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message
        : undefined;
      setError(message ?? 'Sign-in failed. Check your email and password and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.accent, fontFamily: fonts.mono }]}>
          REVIEW DESK
        </Text>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: fonts.display }]}>
          AgarAccounting AI
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: fonts.sans }]}>
          Sign in to open your private bookkeeping review desk.
        </Text>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium }]}>
            Email address
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@company.com"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card, fontFamily: fonts.sans },
            ]}
          />
          <Text style={[styles.label, { color: colors.foreground, fontFamily: fonts.sansMedium, marginTop: spacing.md }]}>
            Password
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card, fontFamily: fonts.sans },
            ]}
          />

          {error && (
            <Text style={[styles.error, { color: colors.destructive, fontFamily: fonts.sans }]}>{error}</Text>
          )}

          <Pressable
            onPress={submit}
            disabled={submitting || !email || !password}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary, opacity: submitting || !email || !password ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.buttonLabel, { color: colors.primaryForeground, fontFamily: fonts.sansSemibold }]}>
              {submitting ? 'Signing in…' : 'Continue'}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.footnote, { color: colors.mutedForeground, fontFamily: fonts.mono }]}>
          SECURE SESSION · HUMAN APPROVAL STAYS IN CONTROL
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, marginBottom: spacing.sm },
  title: { fontSize: 30, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: spacing.xl },
  form: { gap: spacing.xs },
  label: { fontSize: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  error: { fontSize: 12, marginTop: spacing.sm },
  button: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonLabel: { fontSize: 14 },
  footnote: { fontSize: 10, letterSpacing: 1, textAlign: 'center', marginTop: spacing.xxl },
});

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { db } from '../lib/db';
import { signIn, signUp } from '../lib/api';
import { WEAPONS, type Weapon } from '../lib/fencing';
import { useTheme } from '../lib/theme';
import { Button, ChoiceRow, Field, Message, Panel, Pill, Screen } from '../components/ui';

export function AuthScreen() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [weapon, setWeapon] = useState<Weapon>('foil');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    setBusy(true);
    try {
      if (!email.trim() || !password) throw new Error('Email and password are required.');
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      if (mode === 'signup' && !name.trim()) throw new Error('Name is required.');
      const result =
        mode === 'signup'
          ? await signUp({
              email: email.trim(),
              password,
              name: name.trim(),
              defaultWeapon: weapon,
            })
          : await signIn({ email: email.trim(), password });
      await db.auth.signInWithToken(result.token);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.brand}>
        <View style={[styles.mark, { borderColor: colors.accent }]}>
          <Text style={[styles.markText, { color: colors.accent }]}>FV</Text>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Fencing Vault</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Upload bouts, break down every touch, track your game.
        </Text>
      </View>

      <Panel>
        <ChoiceRow>
          <Pill selected={mode === 'signin'} onPress={() => setMode('signin')}>
            Sign in
          </Pill>
          <Pill selected={mode === 'signup'} onPress={() => setMode('signup')}>
            Create account
          </Pill>
        </ChoiceRow>

        {mode === 'signup' ? (
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            autoCapitalize="words"
            textContentType="name"
          />
        ) : null}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@club.com"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
          secureTextEntry
          textContentType={mode === 'signup' ? 'newPassword' : 'password'}
        />
        {mode === 'signup' ? (
          <View style={styles.group}>
            <Text style={[styles.label, { color: colors.muted }]}>DEFAULT WEAPON</Text>
            <ChoiceRow>
              {WEAPONS.map((option) => (
                <Pill
                  key={option.id}
                  selected={weapon === option.id}
                  onPress={() => setWeapon(option.id)}
                >
                  {option.name}
                </Pill>
              ))}
            </ChoiceRow>
          </View>
        ) : null}
        {error ? <Message error>{error}</Message> : null}
        <Button onPress={submit} busy={busy}>
          {mode === 'signup' ? 'Create account' : 'Sign in'}
        </Button>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', maxWidth: 540, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center', gap: 8, marginBottom: 8 },
  mark: {
    height: 56,
    width: 56,
    borderWidth: 1.5,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: 19, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { textAlign: 'center', fontSize: 14, lineHeight: 20, maxWidth: 320 },
  group: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
});

import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { id, type User } from '@instantdb/react-native';
import { changeEmail, changePassword } from '../lib/api';
import { db } from '../lib/db';
import { WEAPONS, type Weapon } from '../lib/fencing';
import { useTheme, type ThemeMode } from '../lib/theme';
import {
  Button,
  ChoiceRow,
  Field,
  Loading,
  Message,
  PageTitle,
  Panel,
  Pill,
  Screen,
} from '../components/ui';

export function SettingsScreen({ user }: { user: User }) {
  const { colors, mode, setMode } = useTheme();
  const query = db.useQuery({
    profiles: { $: { where: { '$user.id': user.id } } },
  });
  const profile = query.data?.profiles[0];
  const [name, setName] = useState('');
  const [weapon, setWeapon] = useState<Weapon>('foil');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [email, setEmail] = useState(user.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    if (WEAPONS.some((option) => option.id === profile.defaultWeapon)) {
      setWeapon(profile.defaultWeapon as Weapon);
    }
  }, [profile]);

  useEffect(() => setEmail(user.email ?? ''), [user.email]);

  async function saveProfile() {
    setProfileMessage('');
    setProfileError('');
    setProfileBusy(true);
    try {
      if (!name.trim()) throw new Error('Name is required.');
      const now = Date.now();
      if (profile) {
        await db.transact(
          db.tx.profiles[profile.id].update({
            name: name.trim(),
            defaultWeapon: weapon,
            updatedAt: now,
          }),
        );
      } else {
        await db.transact(
          db.tx.profiles[id()]
            .update({
              name: name.trim(),
              defaultWeapon: weapon,
              createdAt: now,
              updatedAt: now,
            })
            .link({ $user: user.id }),
        );
      }
      setProfileMessage('Profile saved.');
    } catch (value) {
      setProfileError(value instanceof Error ? value.message : 'Could not save profile.');
    } finally {
      setProfileBusy(false);
    }
  }

  async function saveEmail() {
    setEmailMessage('');
    setEmailBusy(true);
    try {
      if (!user.refresh_token) throw new Error('Missing session token. Sign in again.');
      const result = await changeEmail(user.refresh_token, {
        email: email.trim(),
        password: emailPassword,
      });
      if (result.token) await db.auth.signInWithToken(result.token);
      setEmailPassword('');
      setEmailMessage('Email updated.');
    } catch (value) {
      setEmailMessage(value instanceof Error ? value.message : 'Could not update email.');
    } finally {
      setEmailBusy(false);
    }
  }

  async function savePassword() {
    setPasswordMessage('');
    setPasswordBusy(true);
    try {
      if (!user.refresh_token) throw new Error('Missing session token. Sign in again.');
      if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
      if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');
      await changePassword(user.refresh_token, {
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated.');
    } catch (value) {
      setPasswordMessage(value instanceof Error ? value.message : 'Could not update password.');
    } finally {
      setPasswordBusy(false);
    }
  }

  function signOut() {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => db.auth.signOut() },
    ]);
  }

  if (query.isLoading) return <Loading label="Loading settings…" />;

  return (
    <Screen>
      <PageTitle subtitle="Account, preferences, and security">Settings</PageTitle>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile</Text>
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          textContentType="name"
        />
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
        {profileError ? <Message error>{profileError}</Message> : null}
        {profileMessage ? <Message>{profileMessage}</Message> : null}
        <Button onPress={saveProfile} busy={profileBusy}>
          Save profile
        </Button>
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
        <ChoiceRow>
          {(['system', 'light', 'dark'] as ThemeMode[]).map((option) => (
            <Pill key={option} selected={mode === option} onPress={() => setMode(option)}>
              {option[0].toUpperCase() + option.slice(1)}
            </Pill>
          ))}
        </ChoiceRow>
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Email</Text>
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Confirm with password"
          value={emailPassword}
          onChangeText={setEmailPassword}
          secureTextEntry
          textContentType="password"
        />
        {emailMessage ? (
          <Message error={!emailMessage.endsWith('updated.')}>{emailMessage}</Message>
        ) : null}
        <Button onPress={saveEmail} busy={emailBusy} disabled={!email.trim() || !emailPassword}>
          Update email
        </Button>
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Password</Text>
        <Text style={[styles.help, { color: colors.muted }]}>
          Legacy magic-code accounts can leave the current password blank when setting their first
          password.
        </Text>
        <Field
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          textContentType="password"
        />
        <Field
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
        />
        <Field
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          textContentType="newPassword"
        />
        {passwordMessage ? (
          <Message error={!passwordMessage.endsWith('updated.')}>{passwordMessage}</Message>
        ) : null}
        <Button
          onPress={savePassword}
          busy={passwordBusy}
          disabled={!newPassword || !confirmPassword}
        >
          Update password
        </Button>
      </Panel>

      <Button variant="danger" onPress={signOut}>
        Sign out
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  group: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  help: { fontSize: 13, lineHeight: 19 },
});

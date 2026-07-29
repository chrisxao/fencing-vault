import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { id, type User } from '@instantdb/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { db, instantAppId } from './src/lib/db';
import { DEFAULT_LABELS } from './src/lib/fencing';
import { ThemeProvider, useTheme } from './src/lib/theme';
import type { MainTabParamList, RootStackParamList } from './src/navigation';
import { AuthScreen } from './src/screens/AuthScreen';
import { BoutScreen } from './src/screens/BoutScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { Loading, Message, Screen } from './src/components/ui';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { colors, isDark } = useTheme();
  if (!instantAppId) {
    return (
      <Screen contentStyle={styles.configScreen}>
        <Text style={[styles.configTitle, { color: colors.text }]}>Mobile setup required</Text>
        <Message error>
          Copy mobile/.env.example to mobile/.env and set EXPO_PUBLIC_INSTANT_APP_ID and
          EXPO_PUBLIC_API_URL.
        </Message>
      </Screen>
    );
  }
  return (
    <>
      <AuthGate />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

function AuthGate() {
  const { colors, isDark } = useTheme();
  const auth = db.useAuth();
  if (auth.isLoading) return <Loading label="Opening your vault…" />;
  if (auth.error) {
    return (
      <Screen>
        <Message error>{auth.error.message}</Message>
      </Screen>
    );
  }
  if (!auth.user) return <AuthScreen />;

  const base = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme: NavigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <SeedUserData user={auth.user} />
      <RootStack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <RootStack.Screen name="Main" options={{ headerShown: false }}>
          {(props) => <MainTabs {...props} user={auth.user!} />}
        </RootStack.Screen>
        <RootStack.Screen
          name="Bout"
          options={({ route }) => ({ title: route.params.title, headerBackTitle: 'Bouts' })}
        >
          {(props) => <BoutScreen {...props} user={auth.user!} />}
        </RootStack.Screen>
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

function MainTabs({
  user,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Main'> & { user: User }) {
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: ({ color }) => (
          <Text style={[styles.tabIcon, { color }]}>
            {route.name === 'Dashboard' ? '◇' : route.name === 'Stats' ? '▥' : '⚙︎'}
          </Text>
        ),
      })}
    >
      <Tabs.Screen name="Dashboard" options={{ title: 'Bouts' }}>
        {() => <DashboardScreen user={user} navigation={navigation} />}
      </Tabs.Screen>
      <Tabs.Screen name="Stats">{() => <StatsScreen user={user} />}</Tabs.Screen>
      <Tabs.Screen name="Settings">{() => <SettingsScreen user={user} />}</Tabs.Screen>
    </Tabs.Navigator>
  );
}

function SeedUserData({ user }: { user: User }) {
  const seeded = useRef(false);
  const query = db.useQuery({
    profiles: { $: { where: { '$user.id': user.id } } },
    labels: { $: { where: { 'owner.id': user.id } } },
  });

  useEffect(() => {
    if (query.isLoading || !query.data || seeded.current) return;
    seeded.current = true;
    const now = Date.now();
    const transactions = [];
    if (!query.data.profiles.length) {
      transactions.push(
        db.tx.profiles[id()]
          .update({
            name: user.email?.split('@')[0] || 'Fencer',
            createdAt: now,
            updatedAt: now,
          })
          .link({ $user: user.id }),
      );
    }
    const names = new Set(query.data.labels.map((label) => label.name.toLowerCase()));
    for (const [name, category] of DEFAULT_LABELS) {
      if (!names.has(name.toLowerCase())) {
        transactions.push(
          db.tx.labels[id()]
            .update({ name, category, isCustom: false })
            .link({ owner: user.id }),
        );
      }
    }
    if (transactions.length) db.transact(transactions);
  }, [query.data, query.isLoading, user.email, user.id]);

  return null;
}

const styles = StyleSheet.create({
  configScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  configTitle: { fontSize: 24, fontWeight: '700' },
  tabIcon: { fontSize: 20, fontWeight: '700' },
});

const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

const sceneConfigurationMethod = `  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }
`;

const sceneDelegateClass = `class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory else {
      fatalError("SceneDelegate could not access the React Native factory")
    }

    let nextWindow = UIWindow(windowScene: windowScene)
    window = nextWindow
    appDelegate.window = nextWindow
    factory.startReactNative(
      withModuleName: "main",
      in: nextWindow,
      launchOptions: nil)

    route(urlContexts: connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach(route(userActivity:))
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    route(urlContexts: URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    route(userActivity: userActivity)
  }

  private func route(urlContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }

    for context in urlContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = appDelegate.application(
        UIApplication.shared,
        open: context.url,
        options: options)
    }
  }

  private func route(userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    _ = appDelegate.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}
`;

function withSceneManifest(config) {
  return withInfoPlist(config, (nextConfig) => {
    nextConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return nextConfig;
  });
}

function patchAppDelegate(contents) {
  if (contents.includes('class SceneDelegate: UIResponder, UIWindowSceneDelegate')) {
    return contents;
  }

  const startupBlockPattern =
    /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif/;

  if (!startupBlockPattern.test(contents)) {
    throw new Error(
      'Could not find the Expo AppDelegate startup block required for the iOS scene lifecycle patch.',
    );
  }

  let nextContents = contents.replace(
    startupBlockPattern,
    `#if os(iOS) || os(tvOS)
    if #unavailable(iOS 13.0) {
      window = UIWindow(frame: UIScreen.main.bounds)
      factory.startReactNative(
        withModuleName: "main",
        in: window,
        launchOptions: launchOptions)
    }
#endif`,
  );

  const linkingMarker = '\n  // Linking API';
  if (!nextContents.includes(linkingMarker)) {
    throw new Error('Could not find the Expo AppDelegate linking section.');
  }
  nextContents = nextContents.replace(
    linkingMarker,
    `\n${sceneConfigurationMethod}\n  // Linking API`,
  );

  const reactNativeDelegateMarker =
    '\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate';
  if (!nextContents.includes(reactNativeDelegateMarker)) {
    throw new Error('Could not find ReactNativeDelegate in the generated AppDelegate.');
  }
  return nextContents.replace(
    reactNativeDelegateMarker,
    `\n${sceneDelegateClass}${reactNativeDelegateMarker}`,
  );
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (nextConfig) => {
    if (nextConfig.modResults.language !== 'swift') {
      throw new Error('The iOS scene lifecycle plugin requires a Swift AppDelegate.');
    }
    nextConfig.modResults.contents = patchAppDelegate(
      nextConfig.modResults.contents,
    );
    return nextConfig;
  });
}

module.exports = function withIosSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};

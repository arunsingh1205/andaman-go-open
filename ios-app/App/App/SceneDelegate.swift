import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)

        // Real native Liquid Glass chrome (a floating tab bar and back
        // button — see AppRootViewController.swift) only on iOS 26+, where
        // UIGlassEffect actually exists. Everything below that stays
        // exactly the bare CAPBridgeViewController setup this app has
        // always used — untouched, not a reduced version of the new one.
        if #available(iOS 26.0, *) {
            window?.rootViewController = AppRootViewController()
        } else {
            window?.rootViewController = CAPBridgeViewController()
        }
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

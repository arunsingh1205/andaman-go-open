import UIKit
import WebKit
import Capacitor

/// Embeds Capacitor's own bridge view controller, pinning its top edge to
/// the safe area instead of letting it run full-bleed under the notch and
/// status bar. Before this, SceneDelegate used a bare CAPBridgeViewController
/// as the root — same as the traveller app before its own fix (see
/// ios-app/App/App/AppRootViewController.swift's header comment for the full
/// investigation there). ios.contentInset: "always" (capacitor.config.ts)
/// alone was not enough: it insets the WebView's *scroll content*, a
/// separate coordinate system from CSS position: sticky, so the header's own
/// sticky positioning and --safe-top padding couldn't reliably keep its
/// background below the status bar — on scroll, the header visibly slid up
/// past it instead of staying frozen underneath. Pinning the WebView's own
/// frame below the notch removes the need for that CSS/contentInset
/// coordination entirely, the same way it did for the traveller app.
///
/// Deliberately much smaller than AppRootViewController: the partner app has
/// no native tab bar or back button — its nav is entirely web-rendered (the
/// teal pill bar visible in every screenshot) — so this only has to solve
/// the notch, not float any native chrome on top of the WebView.
class PartnerRootViewController: UIViewController {
    private let bridgeViewController = CAPBridgeViewController()

    /// A second splash, drawn over everything — see the note in viewDidLoad
    /// for why @capacitor/splash-screen's own rendering can't be trusted
    /// once the WebView's frame is pinned below the notch, same reasoning
    /// as AppRootViewController's own splashOverlay.
    private let splashOverlay = UIImageView(image: UIImage(named: "Splash"))

    override func viewDidLoad() {
        super.viewDidLoad()

        // Matches capacitor.config.ts's chromeColor (#F2F6F5 — --color-ground,
        // same light background the partner dashboard's own screens actually
        // use; this used to be the brand teal on the theory that partner
        // screens were dark, which they aren't). The strip between the true
        // top of the screen and the WebView's now safe-area-inset frame is
        // real, empty space this controller's own view paints — not
        // something the WebView draws — so it needs to match, or it would
        // read as a teal band around a light app. splashOverlay (below)
        // fully covers this view for as long as the branded teal splash is
        // showing, so this color is never visible until after that overlay
        // fades — by which point the real page underneath is already this
        // same light background.
        view.backgroundColor = UIColor(red: 0xF2 / 255, green: 0xF6 / 255, blue: 0xF5 / 255, alpha: 1)

        addChild(bridgeViewController)
        bridgeViewController.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bridgeViewController.view)
        NSLayoutConstraint.activate([
            bridgeViewController.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bridgeViewController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bridgeViewController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridgeViewController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        bridgeViewController.didMove(toParent: self)

        // @capacitor/splash-screen's own plugin hardcodes
        // bridge?.viewController?.view (the WebView) as its splash's parent,
        // and sizes the splash image to the full window height regardless of
        // that parent's actual frame. That was fine when the WebView was
        // full-bleed; now that its top is pinned below the notch, a child
        // sized to the full window but positioned inside a shorter, offset
        // parent renders shifted down — the "logo isn't centered" symptom
        // (confirmed: exactly the same bug, same fix, as the traveller app's
        // AppRootViewController). There's no parentView the plugin can be
        // told to use instead — it's hardcoded — so this draws a second
        // splash directly against this controller's own full-bleed view,
        // added last so it's above the WebView. It's hidden once
        // partner-splash.tsx confirms the page is up (see the message
        // handler below); the plugin's own (mispositioned) splash is still
        // doing its own thing underneath, invisibly, since this covers it
        // completely.
        splashOverlay.contentMode = .scaleAspectFill
        splashOverlay.clipsToBounds = true
        // UIImageView doesn't intercept touches by default — without this, a
        // tap during the splash would pass straight through to whatever's
        // loading underneath instead of being safely swallowed.
        splashOverlay.isUserInteractionEnabled = true
        splashOverlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(splashOverlay)
        NSLayoutConstraint.activate([
            splashOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            splashOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            splashOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            splashOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // Wrapped in a weak proxy: WKUserContentController retains whatever
        // it's given strongly, and self (transitively, through
        // bridgeViewController's WebView) owns the content controller —
        // registering self directly would be a reference cycle.
        bridgeViewController.webView?.configuration.userContentController.add(
            WeakScriptMessageHandler(delegate: self),
            name: "splashHide"
        )
    }
}

extension PartnerRootViewController: WKScriptMessageHandler {
    /// partner-splash.tsx posts here right after it calls the plugin's own
    /// SplashScreen.hide() — this is the one thing that actually needs to
    /// hear about it, so a small dedicated channel is simpler than reusing
    /// AppRootViewController's broader nativeChrome one (which also carries
    /// tab-bar/back-button state this app doesn't have).
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "splashHide" else { return }
        UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseOut]) {
            self.splashOverlay.alpha = 0
        } completion: { _ in
            self.splashOverlay.removeFromSuperview()
        }
    }
}

/// See AppRootViewController.swift's identical type for why this exists —
/// same reasoning, separate target, so it's redeclared rather than shared.
private class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

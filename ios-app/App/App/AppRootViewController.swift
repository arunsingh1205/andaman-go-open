import UIKit
import WebKit
import Capacitor

// The native container for iOS 26's Liquid Glass chrome — a floating tab
// bar and a floating back button on sub-pages — around the app's one
// persistent WebView. A native profile button used to live here too;
// removed once it turned out to visually double up with the web's own
// profile icon on Home instead of cleanly replacing it (the glass
// material is translucent, so the web icon underneath showed straight
// through it), and the web icon works fine on its own with nothing native
// needed to hide it. Only ever instantiated on iOS 26+ (see SceneDelegate.swift);
// everything here can assume UIGlassEffect and UIButton's glass
// configuration exist. iOS <26 keeps the exact pre-existing bare
// CAPBridgeViewController setup untouched.
//
// Not a UITabBarController: that expects one real child view controller per
// tab, and there is only one WebView here, not four — the "tabs" are routes
// inside one SPA, not separate screens. So this embeds the single
// CAPBridgeViewController full-bleed (unchanged sizing from the pre-26
// setup) and floats native chrome as overlay subviews on top, the same way
// the CSS capsule (app/bottom-nav.tsx) floats over scrollable content
// today: the overlay views only capture touches within their own bounds,
// so the page beneath stays fully scrollable and tappable everywhere else.
//
// Route awareness is event-driven, not guessed on a timer: two earlier
// versions of this file tried to learn "does this page want chrome" by
// polling evaluateJavaScript after each navigation, on the theory that a
// few hundred ms of retries would always outlast React's render. In
// practice a slow cold launch outlasted the polling window too, and the
// tab bar just stayed hidden — indistinguishable, from the traveller's
// side, from it being broken. So instead: app/native-bridge.tsx posts a
// message the *instant* the page itself knows its own chrome state (on
// mount and on every DOM change, via a MutationObserver — see that file),
// over a WKScriptMessageHandler channel named "nativeChrome". Native only
// ever reacts to what it's told; it never has to guess how long to wait.
// Tab taps still go the other way via a custom DOM event
// (app/native-bridge.tsx), and the back button skips JS entirely, calling
// webView.goBack() directly against the native back-forward list.
@available(iOS 26.0, *)
class AppRootViewController: UIViewController {

    private let bridgeViewController = CAPBridgeViewController()
    private let tabBar = GlassTabBar()
    private let backButton = GlassIconButton(systemImage: "chevron.left", accessibilityLabel: "Back")

    /// A second splash, drawn over everything else — see its own setup in
    /// viewDidLoad for why @capacitor/splash-screen's own rendering can't be
    /// trusted here.
    private let splashOverlay = UIImageView(image: UIImage(named: "Splash"))

    /// Flips once, the first time the chrome message handler below fires —
    /// see the comment on view.backgroundColor's initial assignment in
    /// viewDidLoad for what this is switching from and why once is enough.
    private var hasSyncedBackgroundColor = false

    override func viewDidLoad() {
        super.viewDidLoad()

        addChild(bridgeViewController)

        // The WebView's top edge is pinned to safeAreaLayoutGuide, not
        // view's own edge — deliberately not full-bleed at the top (bottom/
        // leading/trailing still are). Three different attempts to make the
        // WebView correctly inset *its own content* below the status bar —
        // Capacitor's contentInsetAdjustmentBehavior, CSS's own
        // env(safe-area-inset-top), and finally an explicit pixel value
        // pushed in from Swift — all failed to fix it on-device, which only
        // makes sense if something more fundamental than any single one of
        // those mechanisms was the problem. So this stops asking the
        // WebView to leave room for the notch at all: its *frame* now
        // starts below it, a plain Auto Layout constraint with no
        // dependency on WebKit computing or reporting anything correctly.
        // It is not possible for content to render under the status bar
        // when the WebView's own bounds never reach that far up the screen.
        //
        // view.backgroundColor starts out matching the native splash
        // screen (Assets.xcassets' Splash image, teal — the same brandColor
        // capacitor.config.ts uses), not the WebView's own light background:
        // that splash is still covering the WebView entirely at this point
        // (launchAutoHide: false keeps it up until native-bridge.tsx
        // explicitly hides it), so this strip needs to match *it*, not
        // whatever comes after it. It switches to the WebView's actual
        // background in the chrome message handler below, once the page has
        // confirmed real content is up — by which point the splash has
        // already been told to hide, so the switch itself is never visible.
        bridgeViewController.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bridgeViewController.view)
        NSLayoutConstraint.activate([
            bridgeViewController.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bridgeViewController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bridgeViewController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridgeViewController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        bridgeViewController.didMove(toParent: self)
        view.backgroundColor = UIColor(red: 0x0C / 255, green: 0x43 / 255, blue: 0x4C / 255, alpha: 1)

        // The web's own bottom bar and back buttons must never be able to
        // paint at all, not just get hidden a moment after the fact — an
        // eval() run after a page loads is a race against that page's own
        // first paint, and on a cold launch it reliably lost that race
        // (chrome stayed hidden until the traveller navigated away and
        // back, because nothing had told CSS to hide the web ones in the
        // meantime — see the fix this replaces). A WKUserScript injected
        // atDocumentStart runs before any of the page's own scripts or
        // rendering, on every navigation this WebView ever does — including
        // the very first one — so :root[data-native-chrome] in
        // app/globals.css is already true by the time .glass-nav or
        // [data-page-back] exist to be hidden. Set once here: pushState
        // navigations never replace document.documentElement, so the
        // attribute persists for the rest of the SPA session without
        // needing to be re-set per route.
        let hideWebChrome = WKUserScript(
            source: "document.documentElement.dataset.nativeChrome = '1';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        bridgeViewController.webView?.configuration.userContentController.addUserScript(hideWebChrome)

        // Wrapped in a weak proxy: WKUserContentController retains whatever
        // it's given strongly, and self is what owns bridgeViewController
        // (and therefore the WebView, and therefore the content
        // controller) — registering self directly would be a reference
        // cycle. This controller does live for the app's whole lifetime in
        // practice, so it's mostly a formality, but there's no reason to
        // rely on that.
        bridgeViewController.webView?.configuration.userContentController.add(
            WeakScriptMessageHandler(delegate: self),
            name: "nativeChrome"
        )

        view.addSubview(tabBar)
        view.addSubview(backButton)
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        backButton.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            // Floating capsule: centered, inset from the edges, capped at
            // the same 420pt the CSS capsule uses — matches
            // :root[data-native] .glass-nav in app/globals.css.
            tabBar.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            tabBar.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
            tabBar.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16),
            tabBar.widthAnchor.constraint(lessThanOrEqualToConstant: 420),

            backButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
        ])

        tabBar.onSelect = { [weak self] href in
            self?.navigate(to: href)
        }
        backButton.onTap = { [weak self] in
            self?.bridgeViewController.webView?.goBack()
        }

        // Hidden until the web side's first message confirms what it
        // actually wants — otherwise both float over the native splash
        // screen and the JS splash (app/app-splash.tsx), neither of which
        // this controller has any way to know is still covering the
        // WebView on its own. Alpha starts at 0 too, not just isHidden —
        // setVisible()'s fade-in animates *to* alpha 1, so without this the
        // very first reveal would have nothing to animate from and would
        // just pop in at full opacity the one time it matters least to get
        // right and most to be noticed, right as real content appears.
        for chromeView in [tabBar, backButton] {
            chromeView.isHidden = true
            chromeView.alpha = 0
        }

        // @capacitor/splash-screen's own plugin (SplashScreenPlugin.swift)
        // adds its splash image as a subview of bridge?.viewController?.view
        // — the WebView itself — sized to the full window height. That was
        // fine when the WebView was full-bleed; now that its top edge is
        // pinned below the status bar (above), a child sized to the full
        // window but positioned within a shorter, offset parent renders the
        // whole splash shifted down by the status bar's height, with the
        // bottom clipped off — the "logo isn't centered" bug. There's no
        // parentView the plugin can be told to use instead — it's hardcoded
        // — so instead of fighting a third-party plugin's assumptions, this
        // draws a second splash directly on top of everything, correctly
        // positioned against this controller's own full-bleed view rather
        // than the WebView's now-inset one, added last so it's above the
        // WebView, the tab bar and the back button alike. It's hidden the
        // same moment the background color sync below fires; the plugin's
        // own (mispositioned) splash is still doing its own thing
        // underneath, invisibly, since this covers it completely.
        splashOverlay.contentMode = .scaleAspectFill
        splashOverlay.clipsToBounds = true
        // UIImageView doesn't intercept touches by default (unlike most
        // UIView subclasses) — without this, a tap during the splash would
        // pass straight through to whatever's loading underneath instead
        // of being safely swallowed, the way the plugin's own splash blocks
        // interaction via parentView.isUserInteractionEnabled = false.
        splashOverlay.isUserInteractionEnabled = true
        splashOverlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(splashOverlay)
        NSLayoutConstraint.activate([
            splashOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            splashOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            splashOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            splashOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func navigate(to href: String) {
        let js = "window.dispatchEvent(new CustomEvent('native-tab-navigate',{detail:{href:'\(href)'}}))"
        bridgeViewController.bridge?.eval(js: js)
    }
}

@available(iOS 26.0, *)
extension AppRootViewController: WKScriptMessageHandler {
    /// The other half of app/native-bridge.tsx's MutationObserver — it
    /// posts {tabBar, back, path} to this channel on mount and on every DOM
    /// change, so this only ever reacts to what the page just told it,
    /// never to a timer this controller set for itself. WKScriptMessage
    /// bridges a JS object literal straight to a Swift dictionary, so
    /// there's no JSON parsing to do here.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeChrome", let body = message.body as? [String: Any] else { return }

        // The page reporting its own chrome state at all means real content
        // is up — by now native-bridge.tsx has already told the plugin's
        // own (mispositioned, invisible underneath this) splash to hide, so
        // neither of these is a visible change on top of whatever the
        // traveller was already looking at.
        if !hasSyncedBackgroundColor {
            hasSyncedBackgroundColor = true
            view.backgroundColor = bridgeViewController.webView?.backgroundColor ?? .systemBackground
            UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseOut]) {
                self.splashOverlay.alpha = 0
            } completion: { _ in
                self.splashOverlay.removeFromSuperview()
            }
        }

        let showTabBar = body["tabBar"] as? Bool ?? false
        let showBack = body["back"] as? Bool ?? false
        let path = body["path"] as? String

        setVisible(tabBar, showTabBar)
        setVisible(backButton, showBack)
        if showTabBar {
            tabBar.setSelected(href: path)
        }
    }

    /// A fade, not the instant isHidden snap this used to be — a plain
    /// `view.isHidden = !show` reads as broken glass rather than glass:
    /// the capsule just vanishes and reappears mid-frame with no transition
    /// at all, which is exactly what "not smooth" was describing.
    /// .beginFromCurrentState matters here specifically because
    /// app/native-bridge.tsx's MutationObserver can genuinely fire back to
    /// back — without it, a new animation starting while the previous one
    /// is still mid-flight jumps to that previous animation's target alpha
    /// before animating from there, instead of continuing smoothly from
    /// whatever's actually on screen at that instant.
    private func setVisible(_ view: UIView, _ show: Bool) {
        if show {
            view.isHidden = false
            UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) {
                view.alpha = 1
            }
        } else {
            UIView.animate(
                withDuration: 0.16, delay: 0, options: [.curveEaseIn, .beginFromCurrentState],
                animations: { view.alpha = 0 },
                completion: { finished in
                    // Only if this exact animation ran to completion — an
                    // interrupting "show" call already set isHidden = false
                    // itself, and this shouldn't undo that.
                    if finished { view.isHidden = true }
                }
            )
        }
    }
}

/// WKUserContentController retains whatever it's given strongly, and self
/// is what (transitively, through bridgeViewController's WebView) owns the
/// content controller — registering AppRootViewController directly as its
/// own message handler would be a reference cycle. This just forwards.
@available(iOS 26.0, *)
private class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

/// A single floating Liquid Glass capsule holding the four tab items — not
/// a UITabBar, whose floating/glass behavior on iOS 26 is orchestrated by
/// UITabBarController and isn't guaranteed on a bare, unowned instance.
/// Building the capsule directly from UIGlassEffect sidesteps that
/// uncertainty and gives full control over the geometry, matching the CSS
/// capsule's look exactly.
@available(iOS 26.0, *)
private class GlassTabBar: UIView {

    private struct Item {
        let href: String
        let label: String
        let systemImage: String
    }

    // Same four destinations, same order, as app/bottom-nav.tsx.
    private static let items: [Item] = [
        Item(href: "/explore", label: "Home", systemImage: "house"),
        Item(href: "/bookings", label: "Bookings", systemImage: "ticket"),
        Item(href: "/help", label: "Help", systemImage: "bubble.left.and.bubble.right"),
        Item(href: "/profile", label: "Profile", systemImage: "person"),
    ]

    var onSelect: ((String) -> Void)?

    private var itemButtons: [UIButton] = []

    init() {
        super.init(frame: .zero)

        let glass = UIVisualEffectView(effect: UIGlassEffect())
        glass.translatesAutoresizingMaskIntoConstraints = false
        glass.layer.cornerRadius = 28
        glass.clipsToBounds = true
        addSubview(glass)
        NSLayoutConstraint.activate([
            glass.topAnchor.constraint(equalTo: topAnchor),
            glass.bottomAnchor.constraint(equalTo: bottomAnchor),
            glass.leadingAnchor.constraint(equalTo: leadingAnchor),
            glass.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        glass.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor, constant: -6),
            stack.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor, constant: -6),
        ])

        for item in Self.items {
            let button = Self.makeItemButton(item) { [weak self] in
                self?.onSelect?(item.href)
            }
            stack.addArrangedSubview(button)
            itemButtons.append(button)
        }

        heightAnchor.constraint(equalToConstant: 64).isActive = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private static func makeItemButton(_ item: Item, action: @escaping () -> Void) -> UIButton {
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: item.systemImage)
        config.title = item.label
        config.imagePlacement = .top
        config.imagePadding = 4
        config.baseForegroundColor = .secondaryLabel
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 10.5, weight: .semibold)
            return outgoing
        }

        let button = UIButton(configuration: config)
        button.accessibilityLabel = item.label
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    func setSelected(href: String?) {
        for (index, item) in Self.items.enumerated() {
            itemButtons[index].configuration?.baseForegroundColor = item.href == href ? .tintColor : .secondaryLabel
        }
    }
}

/// A single floating glass icon button — currently just the back button
/// (top-left), though written to take any icon/label so another one could
/// reuse it later. Deliberately its own isolated UIButton.Configuration
/// .glass() control rather than sharing the tab bar's capsule — four
/// independently-glassed buttons side by side would render as separate
/// translucent blobs, but one isolated button is exactly what that
/// configuration is for.
@available(iOS 26.0, *)
private class GlassIconButton: UIView {

    var onTap: (() -> Void)?

    init(systemImage: String, accessibilityLabel: String) {
        super.init(frame: .zero)

        var config = UIButton.Configuration.glass()
        config.image = UIImage(systemName: systemImage)
        config.cornerStyle = .capsule

        let button = UIButton(configuration: config)
        button.accessibilityLabel = accessibilityLabel
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addAction(UIAction { [weak self] _ in self?.onTap?() }, for: .touchUpInside)

        addSubview(button)
        NSLayoutConstraint.activate([
            button.topAnchor.constraint(equalTo: topAnchor),
            button.bottomAnchor.constraint(equalTo: bottomAnchor),
            button.leadingAnchor.constraint(equalTo: leadingAnchor),
            button.trailingAnchor.constraint(equalTo: trailingAnchor),
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

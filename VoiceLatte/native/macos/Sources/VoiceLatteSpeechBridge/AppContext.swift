import AppKit
import ApplicationServices
import os

private let axLogger = Logger(subsystem: "com.hibachi.voicelatte", category: "AppContext")

struct AppContext: Sendable {
    enum Category: String, CaseIterable, Sendable {
        case chat, email, code, terminal, notes, browser, generic
    }

    let appName: String
    let bundleIdentifier: String?
    let category: Category
    let siteDomain: String?
    let screenContext: String?
    let displayX: Double?
    let displayY: Double?

    /// Display key for prompt lookup: "gmail.com" for browser sites, "Safari" for browsers without domain, "Slack" for native apps.
    var promptKey: String {
        siteDomain ?? appName
    }

    /// Effective category: URL-based override for browser sites, otherwise app-based.
    var effectiveCategory: Category {
        if let domain = siteDomain {
            return Self.classifyByURL(domain) ?? category
        }
        return category
    }

    static var current: AppContext? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let appName = app.localizedName else { return nil }
        let category = classify(appName: appName, bundleID: app.bundleIdentifier)
        let domain = shouldCaptureSiteDomain(for: category) ? siteKey(pid: app.processIdentifier) : nil
        let displayPoint = activeDisplayPoint(pid: app.processIdentifier)
        return AppContext(
            appName: appName,
            bundleIdentifier: app.bundleIdentifier,
            category: category,
            siteDomain: domain,
            screenContext: screenContext(
                pid: app.processIdentifier,
                bundleID: app.bundleIdentifier,
                category: category
            ),
            displayX: displayPoint.map { Double($0.x) },
            displayY: displayPoint.map { Double($0.y) }
        )
    }

    static func forTesting(appName: String, bundleID: String?, siteDomain: String? = nil) -> AppContext {
        AppContext(
            appName: appName,
            bundleIdentifier: bundleID,
            category: classify(appName: appName, bundleID: bundleID),
            siteDomain: siteDomain,
            screenContext: nil,
            displayX: nil,
            displayY: nil
        )
    }

    static func shouldCaptureSiteDomainForTesting(appName: String, bundleID: String?) -> Bool {
        shouldCaptureSiteDomain(for: classify(appName: appName, bundleID: bundleID))
    }

    // MARK: - Visible window context via AXUIElement

    private static let sensitiveBundleIDs = [
        "com.1password.1password",
        "com.bitwarden.desktop",
        "com.apple.keychainaccess",
    ]
    private static let contextRoles: Set<String> = ["AXStaticText", "AXHeading", "AXTextArea", "AXTextField"]

    private static func activeDisplayPoint(pid: pid_t) -> CGPoint? {
        if AXIsProcessTrusted() {
            let app = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(app, 0.1)
            if let window = elementAttribute(app, kAXFocusedWindowAttribute),
               let windowFrame = frame(of: window) {
                return CGPoint(x: windowFrame.midX, y: windowFrame.midY)
            }
        }
        guard let screen = NSScreen.main,
              let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
        let bounds = CGDisplayBounds(CGDirectDisplayID(number.uint32Value))
        return CGPoint(x: bounds.midX, y: bounds.midY)
    }

    private struct ContextBudget {
        let deadline = CFAbsoluteTimeGetCurrent() + 0.2
        var visited = 0
        var chunks: [String] = []
        var seen: Set<String> = []
    }

    private static func screenContext(pid: pid_t, bundleID: String?, category: Category) -> String? {
        guard AXIsProcessTrusted(), category != .terminal else { return nil }
        if let bundleID, sensitiveBundleIDs.contains(where: { bundleID.hasPrefix($0) }) { return nil }

        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.1)
        guard let window = elementAttribute(app, kAXFocusedWindowAttribute),
              let windowFrame = frame(of: window) else { return nil }
        let focused = elementAttribute(app, kAXFocusedUIElementAttribute)
        var budget = ContextBudget()
        collectVisibleText(
            from: window,
            focused: focused,
            windowFrame: windowFrame,
            depth: 0,
            budget: &budget
        )

        let joined = budget.chunks.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !joined.isEmpty else { return nil }
        return maskSensitiveText(String(joined.suffix(1_500)))
    }

    private static func collectVisibleText(
        from element: AXUIElement,
        focused: AXUIElement?,
        windowFrame: CGRect,
        depth: Int,
        budget: inout ContextBudget
    ) {
        guard depth <= 12, budget.visited < 400, CFAbsoluteTimeGetCurrent() < budget.deadline else { return }
        budget.visited += 1
        if let focused, CFEqual(element, focused) { return }
        if boolAttribute(element, kAXHiddenAttribute) == true { return }
        if let elementFrame = frame(of: element), !windowFrame.intersects(elementFrame) { return }

        let role = stringAttribute(element, kAXRoleAttribute) ?? ""
        if role == "AXSecureTextField" { return }
        if contextRoles.contains(role) {
            var settable = DarwinBoolean(false)
            let editable = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
            if !editable, let text = stringAttribute(element, kAXValueAttribute) ?? stringAttribute(element, kAXTitleAttribute) {
                let normalized = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !normalized.isEmpty {
                    let chunk = String(normalized.prefix(200))
                    if budget.seen.insert(chunk).inserted { budget.chunks.append(chunk) }
                }
            }
        }

        guard let children = arrayAttribute(element, kAXChildrenAttribute) else { return }
        for child in children {
            collectVisibleText(from: child, focused: focused, windowFrame: windowFrame, depth: depth + 1, budget: &budget)
            if budget.visited >= 400 || CFAbsoluteTimeGetCurrent() >= budget.deadline { return }
        }
    }

    private static func elementAttribute(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    private static func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private static func boolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? Bool
    }

    private static func arrayAttribute(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? [AXUIElement]
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        var positionRef: CFTypeRef?
        var sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let positionRef, let sizeRef,
              CFGetTypeID(positionRef) == AXValueGetTypeID(),
              CFGetTypeID(sizeRef) == AXValueGetTypeID() else { return nil }
        var position = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionRef as! AXValue, .cgPoint, &position),
              AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: position, size: size)
    }

    private static func maskSensitiveText(_ text: String) -> String {
        [
            #"(?i)\b(?:sk-|ghp_|github_pat_|AIzaSy)[A-Za-z0-9_\-]{8,}\b"#,
            #"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"#,
            #"\b\d{12,}\b"#,
        ].reduce(text) { result, pattern in
            result.replacingOccurrences(of: pattern, with: "[非表示]", options: .regularExpression)
        }
    }

    // MARK: - Site key via AXUIElement (domain + first path for multi-service hosts)

    private static let multiServiceHosts: Set<String> = [
        "docs.google.com", "drive.google.com",
    ]

    private static func siteKey(pid: pid_t) -> String? {
        guard AXIsProcessTrusted() else { return nil }
        let appRef = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(appRef, 0.5)
        var windowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appRef, kAXFocusedWindowAttribute as CFString, &windowRef) == .success else {
            axLogger.debug("siteKey: no focused window for pid \(pid)")
            return nil
        }
        guard let ref = windowRef, CFGetTypeID(ref) == AXUIElementGetTypeID() else {
            axLogger.debug("siteKey: windowRef nil or type mismatch")
            return nil
        }
        let window = ref as! AXUIElement

        // Pass 1: address bar (most reliable source of current page URL)
        if let url = findAddressBarURL(window, maxDepth: 6) {
            let key = siteKeyFrom(url)
            axLogger.info("siteKey(addressBar): url=\(url) → key=\(key ?? "nil")")
            return key
        }
        // Pass 2: AXURL attribute on any element (Safari AXWebArea, Comet AXGroup, etc.)
        if let url = findAXURL(window, maxDepth: 8) {
            let key = siteKeyFrom(url)
            axLogger.info("siteKey(AXURL): url=\(url) → key=\(key ?? "nil")")
            return key
        }
        axLogger.debug("siteKey: no URL found in AX tree for pid \(pid)")
        return nil
    }

    // MARK: - URL-based category classification

    private static let urlCategoryRules: [(Category, [String])] = [
        (.email, ["mail.google.com", "outlook.live.com", "outlook.office.com",
                  "mail.yahoo.com", "mail.proton.me", "fastmail.com"]),
        (.chat,  ["messenger.com", "web.whatsapp.com", "discord.com",
                  "teams.microsoft.com", "slack.com", "web.telegram.org",
                  "chat.openai.com", "claude.ai", "chatgpt.com"]),
        (.notes, ["notion.so", "docs.google.com", "onenote.com",
                  "evernote.com", "obsidian.md", "coda.io"]),
        (.code,  ["github.com", "gitlab.com", "bitbucket.org", "codepen.io",
                  "codesandbox.io", "replit.com", "stackblitz.com"]),
    ]

    static func classifyByURL(_ siteKey: String) -> Category? {
        let lower = siteKey.lowercased()
        for (category, patterns) in urlCategoryRules {
            if patterns.contains(where: { lower.hasPrefix($0) }) {
                return category
            }
        }
        return nil
    }

    // Pass 1: find address bar (AXTextField with AXURLField/AXSearchField subrole)
    private static func findAddressBarURL(_ element: AXUIElement, maxDepth: Int) -> String? {
        guard maxDepth > 0 else { return nil }

        var roleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
        let role = roleRef as? String ?? ""

        if role == "AXTextField" {
            var subroleRef: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subroleRef)
            let subrole = subroleRef as? String ?? ""
            if subrole == "AXURLField" || subrole == "AXSearchField" {
                var valueRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef) == .success,
                   let value = valueRef as? String, !value.isEmpty {
                    // AXURLField content is always a URL; AXSearchField needs validation
                    if subrole == "AXURLField" || looksLikeURL(value) {
                        return value
                    }
                }
            }
        }

        var childrenRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else { return nil }
        for child in children.prefix(20) {
            if let url = findAddressBarURL(child, maxDepth: maxDepth - 1) { return url }
        }
        return nil
    }

    // Pass 2: find AXURL attribute on any element (Safari AXWebArea, Comet AXGroup, etc.)
    private static func findAXURL(_ element: AXUIElement, maxDepth: Int) -> String? {
        guard maxDepth > 0 else { return nil }

        var urlRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, "AXURL" as CFString, &urlRef) == .success,
           let url = urlRef {
            if let cfURL = url as? URL { return cfURL.absoluteString }
            if CFGetTypeID(url) == CFURLGetTypeID() {
                return CFURLGetString(url as! CFURL) as String
            }
        }

        var childrenRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else { return nil }
        for child in children.prefix(20) {
            if let url = findAXURL(child, maxDepth: maxDepth - 1) { return url }
        }
        return nil
    }

    private static func looksLikeURL(_ text: String) -> Bool {
        guard text.contains("."), !text.contains(" ") else { return false }
        return text.hasPrefix("http://") || text.hasPrefix("https://")
            || text.range(of: #"^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}"#, options: .regularExpression) != nil
    }

    private static func siteKeyFrom(_ urlString: String) -> String? {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let scheme = URLComponents(string: trimmed)?.scheme,
           scheme != "http", scheme != "https" {
            return nil
        }

        let normalized = trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://")
            ? trimmed
            : "https://\(trimmed)"
        guard let comps = URLComponents(string: normalized), let host = comps.host else { return nil }
        let domain = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        guard domain == "localhost" || domain.contains(".") else { return nil }
        // Include first path segment for multi-service hosts (docs.google.com/spreadsheets vs /document)
        if multiServiceHosts.contains(domain),
           let path = comps.path.split(separator: "/").first {
            return "\(domain)/\(path)"
        }
        return domain
    }

    static func siteKeyForTesting(from urlString: String) -> String? {
        siteKeyFrom(urlString)
    }

    // MARK: - App classification

    private static func shouldCaptureSiteDomain(for category: Category) -> Bool {
        category == .browser
    }

    private static func classify(appName: String, bundleID: String?) -> Category {
        let haystack = "\(bundleID ?? "") \(appName)".lowercased()
        let rules: [(Category, [String])] = [
            (.email, ["mail", "outlook", "superhuman", "spark", "airmail"]),
            (.chat, ["slack", "discord", "teams", "wechat", "weixin", "telegram",
                     "whatsapp", "messages", "line", "claude", "anthropic"]),
            (.code, ["xcode", "cursor", "visualstudiocode", "vscode", "jetbrains",
                     "intellij", "pycharm", "webstorm", "sublime", "zed", "nova", "codex"]),
            (.terminal, ["terminal", "iterm", "warp", "ghostty", "kitty", "alacritty"]),
            (.notes, ["notes", "notion", "obsidian", "bear", "evernote", "onenote", "craft"]),
            (.browser, ["safari", "chrome", "firefox", "edge", "arc", "brave", "orion", "comet"]),
        ]
        for (category, keywords) in rules {
            if keywords.contains(where: { haystack.contains($0) }) {
                return category
            }
        }
        return .generic
    }
}

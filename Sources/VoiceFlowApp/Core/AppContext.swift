import AppKit

struct AppContext: Sendable {
    enum Category: String, Sendable {
        case chat, email, code, terminal, notes, browser, generic
    }

    let appName: String
    let bundleIdentifier: String?
    let category: Category

    static var current: AppContext? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let appName = app.localizedName else { return nil }
        return AppContext(
            appName: appName,
            bundleIdentifier: app.bundleIdentifier,
            category: classify(appName: appName, bundleID: app.bundleIdentifier)
        )
    }

    static func forTesting(appName: String, bundleID: String?) -> AppContext {
        AppContext(
            appName: appName,
            bundleIdentifier: bundleID,
            category: classify(appName: appName, bundleID: bundleID)
        )
    }

    private static func classify(appName: String, bundleID: String?) -> Category {
        let haystack = "\(bundleID ?? "") \(appName)".lowercased()
        let rules: [(Category, [String])] = [
            (.email, ["mail", "outlook", "superhuman", "spark", "airmail"]),
            (.chat, ["slack", "discord", "teams", "wechat", "weixin", "telegram",
                     "whatsapp", "messages", "line"]),
            (.code, ["xcode", "cursor", "visualstudiocode", "vscode", "jetbrains",
                     "intellij", "pycharm", "webstorm", "sublime", "zed", "nova"]),
            (.terminal, ["terminal", "iterm", "warp", "ghostty", "kitty", "alacritty"]),
            (.notes, ["notes", "notion", "obsidian", "bear", "evernote", "onenote", "craft"]),
            (.browser, ["safari", "chrome", "firefox", "edge", "arc", "brave", "orion"]),
        ]
        for (category, keywords) in rules {
            if keywords.contains(where: { haystack.contains($0) }) {
                return category
            }
        }
        return .generic
    }
}

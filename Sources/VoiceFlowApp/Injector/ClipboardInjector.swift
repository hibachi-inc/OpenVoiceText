import AppKit

struct ClipboardInjector: TextInjecting {
    func inject(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

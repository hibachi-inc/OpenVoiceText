import AppKit
import Speech
import AVFoundation
import Carbon.HIToolbox

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let coordinator = RecordingCoordinator()
    private let mainWindow = MainWindowController()
    private var hotkeyMonitor: Any?
    private var hotkeyActive = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        coordinator.setup()
        coordinator.onStateChanged = { [weak self] in self?.updateStatusIcon() }
        setupStatusItem()
        setupHotkey()
        Task { await requestPermissions() }
    }

    // MARK: - Status Bar

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "mic.fill", accessibilityDescription: "OpenVoiceText"
        )
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        rebuildMenu()
    }

    private func rebuildMenu() {
        guard let menu = statusItem.menu else { return }
        menu.removeAllItems()

        let title = coordinator.isRecording ? "Stop Recording" : "Start Recording (⌥Space)"
        let item = NSMenuItem(title: title, action: #selector(toggleRecording), keyEquivalent: "")
        item.target = self
        menu.addItem(item)

        menu.addItem(.separator())

        if !hotkeyActive {
            let warning = NSMenuItem(
                title: "⚠ Hotkey requires Input Monitoring permission",
                action: nil, keyEquivalent: ""
            )
            warning.isEnabled = false
            menu.addItem(warning)

            let fix = NSMenuItem(
                title: "Open Input Monitoring Settings...",
                action: #selector(openInputMonitoringSettings),
                keyEquivalent: ""
            )
            fix.target = self
            menu.addItem(fix)
        } else {
            let info = NSMenuItem(title: "⌥Space to toggle recording", action: nil, keyEquivalent: "")
            info.isEnabled = false
            menu.addItem(info)
        }

        menu.addItem(.separator())
        let settings = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit OpenVoiceText", action: #selector(terminateApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    @objc private func openSettings() {
        mainWindow.show()
    }

    // MARK: - Hotkey

    private func setupHotkey() {
        let prefs = PreferencesStore.shared
        hotkeyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let expectedKey = prefs.hotkeyKey.keyCode
            let expectedMod = prefs.hotkeyModifier.eventModifier
            if event.keyCode == expectedKey && event.modifierFlags.contains(expectedMod) {
                Task { @MainActor in
                    self?.hotkeyActive = true
                    self?.toggleRecording()
                }
            }
        }

        // Check if input monitoring is likely available by testing accessibility
        // addGlobalMonitorForEvents silently fails without the permission
        Task {
            try? await Task.sleep(for: .seconds(2))
            if !hotkeyActive {
                coordinator.showPermissionError("Grant Input Monitoring to enable ⌥Space hotkey")
            }
        }
    }

    @objc private func toggleRecording() {
        coordinator.toggle()
    }

    @objc private func openInputMonitoringSettings() {
        NSWorkspace.shared.open(
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!
        )
    }

    private func updateStatusIcon() {
        let name = coordinator.isRecording ? "mic.fill.badge.plus" : "mic.fill"
        statusItem.button?.image = NSImage(
            systemSymbolName: name, accessibilityDescription: "OpenVoiceText"
        )
        rebuildMenu()
    }

    // MARK: - Permissions

    private nonisolated func requestPermissions() async {
        let speech = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        if speech != .authorized {
            await MainActor.run { coordinator.showPermissionError("Speech recognition permission required.") }
        }
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        if !mic {
            await MainActor.run { coordinator.showPermissionError("Microphone permission required.") }
        }
    }

    @objc private func terminateApp() {
        coordinator.disconnect()
        NSApplication.shared.terminate(nil)
    }
}

extension AppDelegate: NSMenuDelegate {
    nonisolated func menuWillOpen(_ menu: NSMenu) {
        Task { @MainActor in self.rebuildMenu() }
    }
}

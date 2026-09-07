import Foundation
import Speech
import AVFoundation
import AppKit
import ApplicationServices
import CoreAudio

private struct BridgeRequest: Decodable {
    let id: Int
    let command: String
    let locale: String?
    let vocabulary: [String]?
    let text: String?
    let category: String?
    let prompt: String?
    let shortcut: String?
    let shortcuts: [String]?
    let deviceUID: String?
    let muteOtherAudio: Bool?
    let permission: String?
    let autoPaste: Bool?
    let audioPath: String?
    let cloudProvider: String?
    let screenContext: String?
}

private struct AudioDeviceResponse: Encodable {
    let uid: String
    let name: String
}

private struct BridgeResponse: Encodable {
    let id: Int
    let type: String
    var platform = "macos"
    var backend: String? = nil
    var modelState: String? = nil
    var supportsStreaming: Bool? = nil
    var message: String? = nil
    var text: String? = nil
    var level: Float? = nil
    var appName: String? = nil
    var bundleID: String? = nil
    var category: String? = nil
    var promptKey: String? = nil
    var screenContext: String? = nil
    var displayX: Double? = nil
    var displayY: Double? = nil
    var shortcut: String? = nil
    var devices: [AudioDeviceResponse]? = nil
    var microphonePermission: String? = nil
    var speechPermission: String? = nil
    var accessibilityPermission: String? = nil
}

private final class Output: @unchecked Sendable {
    private let lock = NSLock()

    func send(_ response: BridgeResponse) {
        guard let data = try? JSONEncoder().encode(response),
              let line = String(data: data, encoding: .utf8) else { return }
        lock.withLock {
            print(line)
            fflush(stdout)
        }
    }
}

private final class Bridge: @unchecked Sendable {
    private let output = Output()
    private lazy var speech = SpeechSession { [weak self] event in self?.handle(event) }
    private var hotkey: ModifierHotkey?
    private let lock = NSLock()
    private var recordingID = 0
    private var mutedOutputDeviceID: AudioDeviceID?
    private var pasteTargetPID: pid_t?

    func handle(_ request: BridgeRequest) async {
        switch request.command {
        case "status":
            await emitStatus(id: request.id, localeID: request.locale ?? "ja-JP")
        case "warm_up":
            speech.warmUp(locale: request.locale ?? "ja-JP", engine: "enhanced")
            output.send(.init(id: request.id, type: "ready", message: "音声認識を準備しました"))
        case "install_model":
            await installModel(id: request.id, localeID: request.locale ?? "ja-JP")
        case "context":
            let context = await MainActor.run { AppContext.current }
            output.send(.init(
                id: request.id,
                type: "context",
                appName: context?.appName ?? "Unknown",
                bundleID: context?.bundleIdentifier,
                category: context?.effectiveCategory.rawValue ?? "generic",
                promptKey: context?.promptKey,
                screenContext: context?.screenContext,
                displayX: context?.displayX,
                displayY: context?.displayY
            ))
        case "settings_status":
            emitSettingsStatus(id: request.id)
        case "request_permission":
            await requestPermission(id: request.id, permission: request.permission ?? "")
        case "start":
            await start(request)
        case "stop", "cancel":
            stop(id: request.id)
        case "refine":
            let text = request.text ?? ""
            let refined = await TextRefiner.refine(text: text, context: [
                RefinerContextKey.category: request.category ?? "generic",
                RefinerContextKey.customPrompt: request.prompt ?? "",
                RefinerContextKey.screenContext: request.screenContext ?? "",
            ])
            output.send(.init(id: request.id, type: "refined", text: refined))
        case "insert":
            insert(request.text ?? "", autoPaste: request.autoPaste != false)
            output.send(.init(id: request.id, type: "inserted", text: request.text ?? ""))
        case "configure_shortcut":
            await MainActor.run {
                let shortcuts = request.shortcuts ?? request.shortcut.map { [$0] } ?? []
                if shortcuts.isEmpty {
                    hotkey?.disable()
                    return
                }
                if hotkey == nil {
                    hotkey = ModifierHotkey { [weak self] shortcut, state in
                        self?.output.send(.init(id: 0, type: "shortcut", message: state, shortcut: shortcut))
                    }
                }
                hotkey?.configure(shortcuts)
            }
            output.send(.init(id: request.id, type: "ready", message: "ショートカットを設定しました"))
        default:
            output.send(.init(id: request.id, type: "error", message: "Unsupported command: \(request.command)"))
        }
    }

    private func start(_ request: BridgeRequest) async {
        pasteTargetPID = await MainActor.run { NSWorkspace.shared.frontmostApplication?.processIdentifier }
        let microphoneAllowed = await AVCaptureDevice.requestAccess(for: .audio)
        let isCloud = request.audioPath?.isEmpty == false
        let speechAllowed = isCloud ? true : await requestSpeechPermission()
        guard speechAllowed, microphoneAllowed else {
            output.send(.init(id: request.id, type: "error", message: "マイクと音声認識の許可が必要です"))
            return
        }

        lock.withLock { recordingID = request.id }
        setOtherAudioMuted(request.muteOtherAudio == true)
        if let audioPath = request.audioPath, !audioPath.isEmpty {
            speech.startCloudCapture(
                path: audioPath,
                provider: request.cloudProvider ?? "cloud",
                deviceID: AudioInputDeviceCatalog.deviceID(forUID: request.deviceUID ?? "") ?? 0
            ) { [weak self] in
                self?.output.send(.init(id: request.id, type: "started", message: "聞き取り中"))
            }
            return
        }
        speech.startRecording(
            locale: request.locale ?? "ja-JP",
            engine: "enhanced",
            deviceID: AudioInputDeviceCatalog.deviceID(forUID: request.deviceUID ?? "") ?? 0,
            vocabulary: request.vocabulary ?? []
        ) { [weak self] in
            self?.output.send(.init(id: request.id, type: "started", message: "聞き取り中"))
        }
    }

    private func stop(id: Int) {
        speech.stopRecording { [weak self] text in
            guard let self else { return }
            self.restoreOutputAudio()
            self.output.send(.init(id: id, type: "final", text: text ?? ""))
            self.lock.withLock { self.recordingID = 0 }
        }
    }

    private func handle(_ event: SpeechSession.Event) {
        let id = lock.withLock { recordingID }
        guard id != 0 else { return }
        switch event {
        case .engine(let engine):
            output.send(.init(
                id: id,
                type: "engine",
                backend: engine == "enhanced" ? "apple-speech-analyzer" : engine == "classic" ? "apple-speech-classic" : engine
            ))
        case .transcript(let text):
            output.send(.init(id: id, type: "transcript", text: text))
        case .audioLevel(let level):
            output.send(.init(id: id, type: "audio_level", level: level))
        case .error(let message):
            restoreOutputAudio()
            output.send(.init(id: id, type: "error", message: message))
        }
    }

    func shutdown() {
        restoreOutputAudio()
    }

    private func emitSettingsStatus(id: Int) {
        output.send(.init(
            id: id,
            type: "settings",
            devices: AudioInputDeviceCatalog.devices().map { .init(uid: $0.uid, name: $0.name) },
            microphonePermission: permissionName(AVCaptureDevice.authorizationStatus(for: .audio)),
            speechPermission: permissionName(SFSpeechRecognizer.authorizationStatus()),
            accessibilityPermission: AXIsProcessTrusted() ? "authorized" : "denied"
        ))
    }

    private func requestPermission(id: Int, permission: String) async {
        switch permission {
        case "microphone":
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .audio)
            } else {
                openPrivacySettings("Privacy_Microphone")
            }
        case "speech":
            if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
                _ = await requestSpeechPermission()
            } else {
                openPrivacySettings("Privacy_SpeechRecognition")
            }
        case "accessibility":
            let promptKey = "AXTrustedCheckOptionPrompt" as CFString
            AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
        default:
            break
        }
        output.send(.init(id: id, type: "ready"))
    }

    private func openPrivacySettings(_ pane: String) {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") else { return }
        NSWorkspace.shared.open(url)
    }

    private func permissionName(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: "authorized"
        case .notDetermined: "not-determined"
        case .denied, .restricted: "denied"
        @unknown default: "denied"
        }
    }

    private func permissionName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .authorized: "authorized"
        case .notDetermined: "not-determined"
        case .denied, .restricted: "denied"
        @unknown default: "denied"
        }
    }

    private func setOtherAudioMuted(_ shouldMute: Bool) {
        restoreOutputAudio()
        guard shouldMute, let deviceID = AudioOutput.defaultDeviceID(), !AudioOutput.isMuted(deviceID) else { return }
        if AudioOutput.setMuted(true, deviceID: deviceID) {
            mutedOutputDeviceID = deviceID
        }
    }

    private func restoreOutputAudio() {
        guard let deviceID = mutedOutputDeviceID else { return }
        _ = AudioOutput.setMuted(false, deviceID: deviceID)
        mutedOutputDeviceID = nil
    }

    private func emitStatus(id: Int, localeID: String) async {
        let locale = Locale(identifier: localeID)
        if #available(macOS 26.0, *) {
            let tag = locale.identifier(.bcp47)
            let supported = await SpeechTranscriber.supportedLocales.contains {
                $0.identifier(.bcp47) == tag
            }
            if supported {
                let installed = await SpeechTranscriber.installedLocales.contains {
                    $0.identifier(.bcp47) == tag
                }
                output.send(.init(
                    id: id,
                    type: "status",
                    backend: "apple-speech-analyzer",
                    modelState: installed ? "ready" : "download-required",
                    supportsStreaming: true,
                    message: installed ? "Apple高精度モデルを利用できます" : "Apple高精度モデルの追加が必要です"
                ))
                return
            }
        }

        let classic = SFSpeechRecognizer(locale: locale)
        output.send(.init(
            id: id,
            type: "status",
            backend: "apple-speech-classic",
            modelState: classic?.supportsOnDeviceRecognition == true ? "ready" : "unsupported",
            supportsStreaming: classic != nil,
            message: classic?.supportsOnDeviceRecognition == true
                ? "Apple標準音声認識を利用できます"
                : "この言語ではオンデバイス音声認識を利用できません"
        ))
    }

    private func installModel(id: Int, localeID: String) async {
        guard #available(macOS 26.0, *) else {
            output.send(.init(id: id, type: "error", message: "このmacOSでは高精度モデルを追加できません"))
            return
        }
        do {
            let transcriber = SpeechTranscriber(
                locale: Locale(identifier: localeID),
                preset: .progressiveTranscription
            )
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
            output.send(.init(id: id, type: "installed", message: "高精度モデルを追加しました"))
        } catch {
            output.send(.init(id: id, type: "error", message: "モデルを追加できません: \(error.localizedDescription)"))
        }
    }

    private func requestSpeechPermission() async -> Bool {
        if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    private func insert(_ text: String, autoPaste: Bool) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        guard autoPaste, AXIsProcessTrusted() else { return }
        // 録音開始時に前面だったアプリへ戻してからペーストする
        if let pid = pasteTargetPID, pid != getpid(),
           let target = NSRunningApplication(processIdentifier: pid), !target.isTerminated {
            if Thread.isMainThread {
                _ = target.activate()
            } else {
                DispatchQueue.main.sync { _ = target.activate() }
            }
            Thread.sleep(forTimeInterval: 0.15)
        }
        let source = CGEventSource(stateID: .hidSystemState)
        let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false)
        down?.flags = .maskCommand
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }
}

private struct AudioInputDevice {
    let id: AudioDeviceID
    let uid: String
    let name: String
}

private enum AudioInputDeviceCatalog {
    static func devices() -> [AudioInputDevice] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { id in
            guard hasInput(id),
                  let uid = stringProperty(kAudioDevicePropertyDeviceUID, deviceID: id),
                  let name = stringProperty(kAudioObjectPropertyName, deviceID: id) else { return nil }
            return .init(id: id, uid: uid, name: name)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func deviceID(forUID uid: String) -> AudioDeviceID? {
        guard !uid.isEmpty else { return nil }
        return devices().first { $0.uid == uid }?.id
    }

    private static func hasInput(_ deviceID: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        return AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr
            && size >= MemoryLayout<AudioStreamID>.size
    }

    private static func stringProperty(_ selector: AudioObjectPropertySelector, deviceID: AudioDeviceID) -> String? {
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeUnretainedValue() as String?
    }
}

private enum AudioOutput {
    static func defaultDeviceID() -> AudioDeviceID? {
        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID) == noErr else { return nil }
        return deviceID
    }

    static func isMuted(_ deviceID: AudioDeviceID) -> Bool {
        var muted: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        var address = muteAddress()
        return AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &muted) == noErr && muted != 0
    }

    static func setMuted(_ muted: Bool, deviceID: AudioDeviceID) -> Bool {
        var value: UInt32 = muted ? 1 : 0
        var address = muteAddress()
        return AudioObjectSetPropertyData(
            deviceID, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value
        ) == noErr
    }

    private static func muteAddress() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
    }
}

@MainActor
private final class ModifierHotkey {
    private let emit: @Sendable (String, String) -> Void
    private var timer: Timer?
    private var targets: [String: NSEvent.ModifierFlags] = [:]
    private var pressed: Set<String> = []

    init(emit: @escaping @Sendable (String, String) -> Void) {
        self.emit = emit
    }

    func configure(_ shortcuts: [String]) {
        disable()
        for shortcut in Set(shortcuts) {
            targets[shortcut] = switch shortcut {
            case "Option": .option
            case "Command": .command
            case "Shift": .shift
            default: .control
            }
        }
        let monitoredTargets = targets
        timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in
            let flags = NSEvent.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let states = monitoredTargets.map { ($0.key, flags.contains($0.value)) }
            Task { @MainActor [weak self] in states.forEach { self?.handle($0.0, pressed: $0.1) } }
        }
    }

    func disable() {
        timer?.invalidate()
        timer = nil
        pressed.removeAll()
        targets.removeAll()
    }

    private func handle(_ shortcut: String, pressed nowPressed: Bool) {
        guard nowPressed != pressed.contains(shortcut) else { return }
        if nowPressed { pressed.insert(shortcut) } else { pressed.remove(shortcut) }
        emit(shortcut, nowPressed ? "Pressed" : "Released")
    }
}

@main
private enum VoiceLatteSpeechBridge {
    static func main() {
        let bridge = Bridge()
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let request = try? JSONDecoder().decode(BridgeRequest.self, from: data) else {
                    continue
                }
                Task { await bridge.handle(request) }
            }
            bridge.shutdown()
            exit(EXIT_SUCCESS)
        }
        RunLoop.main.run()
    }
}

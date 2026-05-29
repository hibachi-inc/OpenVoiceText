import Carbon.HIToolbox
import AppKit

@MainActor
final class GlobalHotkey {
    private var hotkeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private var callback: (() -> Void)?

    private static let hotkeyID = EventHotKeyID(
        signature: OSType(0x4F565478), // "OVTx" — OpenVoiceText
        id: 1
    )

    func register(keyCode: UInt32, modifiers: UInt32, callback: @escaping () -> Void) {
        unregister()
        self.callback = callback

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        let handler: EventHandlerUPP = { _, event, userData -> OSStatus in
            guard let userData else { return OSStatus(eventNotHandledErr) }
            let instance = Unmanaged<GlobalHotkey>.fromOpaque(userData).takeUnretainedValue()
            Task { @MainActor in
                instance.callback?()
            }
            return noErr
        }

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(
            GetApplicationEventTarget(),
            handler,
            1,
            &eventType,
            selfPtr,
            &handlerRef
        )

        var id = Self.hotkeyID // RegisterEventHotKey requires inout
        RegisterEventHotKey(
            keyCode,
            modifiers,
            id,
            GetApplicationEventTarget(),
            0,
            &hotkeyRef
        )
    }

    func unregister() {
        if let hotkeyRef {
            UnregisterEventHotKey(hotkeyRef)
            self.hotkeyRef = nil
        }
        if let handlerRef {
            RemoveEventHandler(handlerRef)
            self.handlerRef = nil
        }
        callback = nil
    }
}

// Carbon modifier flag conversion
extension HotkeyModifier {
    var carbonModifier: UInt32 {
        switch self {
        case .option: UInt32(optionKey)
        case .control: UInt32(controlKey)
        case .command: UInt32(cmdKey)
        }
    }
}

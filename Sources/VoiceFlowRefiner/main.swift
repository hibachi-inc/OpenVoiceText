import Foundation
import VoiceFlowProtocol

final class RefinerServiceDelegate: NSObject, NSXPCListenerDelegate {
    func listener(
        _ listener: NSXPCListener,
        shouldAcceptNewConnection connection: NSXPCConnection
    ) -> Bool {
        let serviceInterface = NSXPCInterface(with: RefinerServiceProtocol.self)
        connection.exportedInterface = serviceInterface
        connection.exportedObject = RefinerService()

        connection.resume()
        return true
    }
}

let delegate = RefinerServiceDelegate()
let listener = NSXPCListener.service()
listener.delegate = delegate
listener.resume()

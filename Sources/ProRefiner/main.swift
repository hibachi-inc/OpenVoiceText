import Foundation
import VoiceFlowProtocol

final class ProRefinerServiceDelegate: NSObject, NSXPCListenerDelegate {
    func listener(
        _ listener: NSXPCListener,
        shouldAcceptNewConnection connection: NSXPCConnection
    ) -> Bool {
        let serviceInterface = NSXPCInterface(with: RefinerServiceProtocol.self)
        connection.exportedInterface = serviceInterface
        connection.exportedObject = ProRefinerService()
        connection.resume()
        return true
    }
}

let delegate = ProRefinerServiceDelegate()
let listener = NSXPCListener.service()
listener.delegate = delegate
listener.resume()

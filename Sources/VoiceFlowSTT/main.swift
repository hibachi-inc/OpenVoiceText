import Foundation
import VoiceFlowProtocol

final class STTServiceDelegate: NSObject, NSXPCListenerDelegate {
    func listener(
        _ listener: NSXPCListener,
        shouldAcceptNewConnection connection: NSXPCConnection
    ) -> Bool {
        let serviceInterface = NSXPCInterface(with: STTServiceProtocol.self)
        connection.exportedInterface = serviceInterface
        connection.exportedObject = STTService(connection: connection)

        let clientInterface = NSXPCInterface(with: STTClientProtocol.self)
        connection.remoteObjectInterface = clientInterface

        connection.resume()
        return true
    }
}

let delegate = STTServiceDelegate()
let listener = NSXPCListener.service()
listener.delegate = delegate
listener.resume()

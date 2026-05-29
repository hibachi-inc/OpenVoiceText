import Foundation

/// Wraps an XPC reply-based call with a timeout.
/// If the XPC service dies or hangs, returns `fallback` after `seconds`.
func withXPCTimeout<T: Sendable>(
    seconds: TimeInterval,
    fallback: T,
    operation: @Sendable @escaping (@Sendable @escaping (T) -> Void) -> Void
) async -> T {
    await withCheckedContinuation { continuation in
        nonisolated(unsafe) var resumed = false
        let lock = NSLock()

        let safeResume: @Sendable (T) -> Void = { value in
            lock.lock()
            defer { lock.unlock() }
            guard !resumed else { return }
            resumed = true
            continuation.resume(returning: value)
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + seconds) {
            safeResume(fallback)
        }

        operation(safeResume)
    }
}

import Foundation
import Security
import os

#if !DIRECT
import StoreKit
#endif

private let logger = Logger(subsystem: "com.hibachi.voicelatte", category: "ProUpgrade")

@MainActor
@Observable
final class ProUpgradeManager {
    static let shared = ProUpgradeManager()

    private(set) var isPro = false
    private(set) var purchaseState: PurchaseState = .unknown

    enum PurchaseState {
        case unknown, loading, available, purchased, failed(String)
    }

    var isLoading: Bool {
        if case .loading = purchaseState { return true }
        return false
    }

    private let defaults = UserDefaults.standard

    #if DEVTOOLS
    // MARK: - Dev: Pro status override (excluded from release builds)

    private static let devProOverrideKey = "devProOverride"

    /// Toggle Pro status for development.
    /// `defaults write com.hibachi.voicelatte devProOverride -bool YES`
    /// `defaults write com.hibachi.voicelatte devProOverride -bool NO`
    /// `defaults delete com.hibachi.voicelatte devProOverride` → normal Polar flow
    var devOverrideActive: Bool {
        defaults.object(forKey: Self.devProOverrideKey) != nil
    }

    func devSetPro(_ enabled: Bool) {
        defaults.set(enabled, forKey: Self.devProOverrideKey)
        isPro = enabled
        purchaseState = enabled ? .purchased : .available
        logger.info("Dev override: isPro = \(enabled)")
    }

    func devClearOverride() {
        defaults.removeObject(forKey: Self.devProOverrideKey)
        logger.info("Dev override cleared")
    }
    #endif

    #if DIRECT
    // MARK: - DMG: Polar License Key

    private static let polarOrgID = "45255454-9dd3-4919-9b62-f286ea3cff29"
    static let purchaseURL = URL(string: "https://polar.sh/checkout?productId=be98eb3b-a65b-45a7-8388-48d5d4f839db")!

    private static let keychainService = "com.hibachi.voicelatte.license"
    private static let keychainLicenseAccount = "licenseKey"
    private static let keychainActivationAccount = "activationID"
    private static let proValidatedKey = "polarProValidated"
    private static let lastValidatedKey = "polarLastValidated"
    private static let gracePeriodDays = 7

    var licenseKey: String {
        Self.keychainRead(account: Self.keychainLicenseAccount) ?? ""
    }

    private var activationID: String? {
        get { Self.keychainRead(account: Self.keychainActivationAccount) }
        set {
            if let newValue {
                Self.keychainWrite(account: Self.keychainActivationAccount, value: newValue)
            } else {
                Self.keychainDelete(account: Self.keychainActivationAccount)
            }
        }
    }

    private init() {
        #if DEVTOOLS
        if let override = defaults.object(forKey: Self.devProOverrideKey) as? Bool {
            isPro = override
            purchaseState = override ? .purchased : .available
            logger.info("Dev override active: isPro = \(override)")
            return
        }
        #endif
        if defaults.bool(forKey: Self.proValidatedKey) && !licenseKey.isEmpty && !isGracePeriodExpired {
            isPro = true
            purchaseState = .purchased
        }
        Task { await revalidateIfNeeded() }
    }

    func activate(key: String) async {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isLoading else { return }
        purchaseState = .loading

        let deviceName = Host.current().localizedName ?? "Mac"
        let (actID, error) = await polarActivate(key: trimmed, label: deviceName)

        if let actID {
            Self.keychainWrite(account: Self.keychainLicenseAccount, value: trimmed)
            activationID = actID
            defaults.set(true, forKey: Self.proValidatedKey)
            defaults.set(Date().timeIntervalSince1970, forKey: Self.lastValidatedKey)
            isPro = true
            purchaseState = .purchased
            logger.info("License activated")
        } else {
            let msg = error ?? String(localized: "pro.invalid_key")
            purchaseState = .failed(msg)
            logger.error("Activation failed: \(msg)")
        }
    }

    func deactivate() async {
        guard !licenseKey.isEmpty else { return }
        if let actID = activationID {
            let success = await polarDeactivate(key: licenseKey, activationID: actID)
            guard success else {
                purchaseState = .failed(String(localized: "pro.network_error"))
                return
            }
        }
        Self.keychainDelete(account: Self.keychainLicenseAccount)
        Self.keychainDelete(account: Self.keychainActivationAccount)
        defaults.set(false, forKey: Self.proValidatedKey)
        defaults.removeObject(forKey: Self.lastValidatedKey)
        isPro = false
        purchaseState = .available
        logger.info("License deactivated")
    }

    private var isGracePeriodExpired: Bool {
        let lastValidated = defaults.double(forKey: Self.lastValidatedKey)
        guard lastValidated > 0 else { return true }
        let elapsed = Date().timeIntervalSince1970 - lastValidated
        return elapsed > Double(Self.gracePeriodDays) * 86400
    }

    private func revalidateIfNeeded() async {
        guard !licenseKey.isEmpty else { return }
        let valid = await polarValidate(key: licenseKey, activationID: activationID)
        if valid {
            defaults.set(true, forKey: Self.proValidatedKey)
            defaults.set(Date().timeIntervalSince1970, forKey: Self.lastValidatedKey)
            isPro = true
            purchaseState = .purchased
        } else if isGracePeriodExpired {
            defaults.set(false, forKey: Self.proValidatedKey)
            isPro = false
            purchaseState = .available
            logger.warning("Grace period expired, license locked")
        }
    }

    // MARK: - Keychain

    private static func keychainWrite(account: String, value: String) {
        keychainDelete(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func keychainRead(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func keychainDelete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Polar API

    private func polarValidate(key: String, activationID: String?) async -> Bool {
        var body: [String: Any] = [
            "key": key,
            "organization_id": Self.polarOrgID
        ]
        if let actID = activationID {
            body["activation_id"] = actID
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
        var request = URLRequest(url: URL(string: "https://api.polar.sh/v1/customer-portal/license-keys/validate")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data

        do {
            let (responseData, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return false }
            if let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
               let status = json["status"] as? String, status == "granted" {
                return true
            }
            return false
        } catch {
            return false
        }
    }

    private func polarActivate(key: String, label: String) async -> (String?, String?) {
        let body: [String: Any] = [
            "key": key,
            "organization_id": Self.polarOrgID,
            "label": label
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            return (nil, "Invalid request")
        }
        var request = URLRequest(url: URL(string: "https://api.polar.sh/v1/customer-portal/license-keys/activate")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data

        do {
            let (responseData, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return (nil, "Invalid response") }
            if http.statusCode == 200 {
                if let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
                   let actID = json["id"] as? String {
                    return (actID, nil)
                }
                return (nil, String(localized: "pro.invalid_key"))
            }
            if let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
               let detail = json["detail"] as? String {
                return (nil, detail)
            }
            return (nil, String(localized: "pro.invalid_key"))
        } catch {
            return (nil, String(localized: "pro.network_error"))
        }
    }

    private func polarDeactivate(key: String, activationID: String) async -> Bool {
        let body: [String: Any] = [
            "key": key,
            "organization_id": Self.polarOrgID,
            "activation_id": activationID
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
        var request = URLRequest(url: URL(string: "https://api.polar.sh/v1/customer-portal/license-keys/deactivate")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 204
        } catch {
            return false
        }
    }

    #else
    // MARK: - MAS: StoreKit 2

    static let productID = "com.hibachi.voicelatte.pro"

    private(set) var product: Product?
    private var updatesTask: Task<Void, Never>?

    private init() {
        updatesTask = Task {
            for await update in Transaction.updates {
                switch update {
                case .verified(let transaction):
                    await refreshPurchaseState()
                    await transaction.finish()
                case .unverified(_, let error):
                    logger.warning("Unverified transaction: \(error.localizedDescription)")
                    await refreshPurchaseState()
                }
            }
        }
        Task {
            await loadProduct()
            await refreshPurchaseState()
        }
    }

    func loadProduct() async {
        purchaseState = .loading
        do {
            let products = try await Product.products(for: [Self.productID])
            product = products.first
            if product != nil && !isPro {
                purchaseState = .available
            }
        } catch {
            logger.error("Failed to load products: \(error.localizedDescription)")
            purchaseState = .failed(error.localizedDescription)
        }
    }

    func purchase() async {
        guard let product else { return }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try verification.payloadValue
                await refreshPurchaseState()
                await transaction.finish()
                logger.info("Purchase successful")
            case .userCancelled:
                logger.info("Purchase cancelled by user")
            case .pending:
                logger.info("Purchase pending approval")
            @unknown default:
                break
            }
        } catch {
            logger.error("Purchase failed: \(error.localizedDescription)")
            purchaseState = .failed(error.localizedDescription)
            await refreshPurchaseState()
        }
    }

    func restorePurchases() async {
        do {
            try await AppStore.sync()
            await refreshPurchaseState()
        } catch {
            logger.error("Restore failed: \(error.localizedDescription)")
        }
    }

    private var refreshTask: Task<Void, Never>?

    func refreshPurchaseState() async {
        refreshTask?.cancel()
        let task = Task {
            defer { refreshTask = nil }
            var found = false
            for await entitlement in Transaction.currentEntitlements {
                guard !Task.isCancelled else { return }
                if let transaction = try? entitlement.payloadValue,
                   transaction.productID == Self.productID {
                    found = true
                    break
                }
            }
            guard !Task.isCancelled else { return }
            isPro = found
            if found {
                purchaseState = .purchased
                logger.info("Pro entitlement verified")
            } else if product != nil {
                purchaseState = .available
            }
        }
        refreshTask = task
        await task.value
    }
    #endif
}

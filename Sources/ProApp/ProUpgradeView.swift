import SwiftUI

struct ProUpgradeView: View {
    @State private var upgradeManager = ProUpgradeManager.shared

    #if DIRECT
    @State private var keyInput = ""
    #endif

    var body: some View {
        ScrollView {
            VStack(spacing: DS.Spacing.xl) {
                heroSection
                if !upgradeManager.isPro {
                    featuresGrid
                    purchaseSection
                } else {
                    activeSection
                }
            }
            .padding(DS.Spacing.xl)
        }
        .navigationTitle(String(localized: "sidebar.pro"))
    }

    // MARK: - Hero

    private var heroSection: some View {
        HStack(spacing: DS.Spacing.lg) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [DS.Colors.accent.opacity(0.25), DS.Colors.accent.opacity(0.0)],
                            center: .center, startRadius: 0, endRadius: 28
                        )
                    )
                    .frame(width: 56, height: 56)

                Image(systemName: upgradeManager.isPro ? "checkmark.seal.fill" : "sparkles")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(upgradeManager.isPro ? DS.Colors.success : DS.Colors.accent)
                    .symbolEffect(.pulse, isActive: !upgradeManager.isPro)
            }

            VStack(alignment: .leading, spacing: DS.Spacing.xs) {
                Text("pro.title")
                    .font(.system(size: 18, weight: .bold))

                if upgradeManager.isPro {
                    Text("pro.activated")
                        .font(DS.Font.caption)
                        .foregroundStyle(DS.Colors.success)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(DS.Colors.success.opacity(0.1))
                        .clipShape(Capsule())
                } else {
                    Text("pro.upgrade_prompt")
                        .font(DS.Font.body)
                        .foregroundStyle(DS.Colors.secondary)
                }
            }

            Spacer()
        }
        .padding(DS.Spacing.lg)
        .background(
            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                .fill(DS.Colors.cardBg)
        )
    }

    // MARK: - Features

    private var featuresGrid: some View {
        VStack(spacing: 0) {
            FeatureRow(icon: "globe", titleKey: "pro.feature_translation", color: .green)
            FeatureRow(icon: "slider.horizontal.3", titleKey: "pro.feature_custom_refine", color: .blue)
        }
        .background(DS.Colors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
    }

    // MARK: - Purchase

    private var purchaseSection: some View {
        VStack(spacing: DS.Spacing.md) {
            #if DIRECT
            VStack(spacing: DS.Spacing.sm) {
                TextField("pro.enter_license.placeholder", text: $keyInput)
                    .textFieldStyle(.plain)
                    .font(.system(.body, design: .monospaced))
                    .padding(8)
                    .background(DS.Colors.fieldBg)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(DS.Colors.secondary.opacity(0.3))
                    )

                HStack(spacing: DS.Spacing.md) {
                    Button(action: {
                        Task { await upgradeManager.activate(key: keyInput) }
                    }) {
                        HStack(spacing: DS.Spacing.sm) {
                            if case .loading = upgradeManager.purchaseState {
                                ProgressView()
                                    .controlSize(.small)
                                Text("pro.validating")
                            } else {
                                Image(systemName: "key.fill")
                                Text("pro.activate")
                            }
                        }
                        .font(DS.Font.bodyMedium)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                              || upgradeManager.isLoading)

                    Link(destination: ProUpgradeManager.purchaseURL) {
                        HStack(spacing: 4) {
                            Image(systemName: "cart.fill")
                            Text("pro.buy_license")
                        }
                        .font(DS.Font.bodyMedium)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.bordered)
                }
            }
            #else
            Button(action: { Task { await upgradeManager.purchase() } }) {
                HStack(spacing: DS.Spacing.sm) {
                    Image(systemName: "sparkles")
                    if let product = upgradeManager.product {
                        Text("pro.upgrade \(product.displayPrice)")
                    } else {
                        Text("pro.loading")
                    }
                }
                .font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(upgradeManager.product == nil)

            Button("pro.restore") {
                Task { await upgradeManager.restorePurchases() }
            }
            .buttonStyle(.plain)
            .font(DS.Font.caption)
            .foregroundStyle(DS.Colors.secondary)
            #endif

            if case .failed(let message) = upgradeManager.purchaseState {
                Text(message)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.error)
                    .padding(DS.Spacing.sm)
                    .frame(maxWidth: .infinity)
                    .background(DS.Colors.error.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
            }
        }
    }

    // MARK: - Active

    private var activeSection: some View {
        VStack(spacing: DS.Spacing.md) {
            ActiveFeatureRow(icon: "globe", titleKey: "pro.translation_active")
            ActiveFeatureRow(icon: "slider.horizontal.3", titleKey: "pro.custom_refine_active")

            #if DIRECT
            Divider()
                .padding(.vertical, DS.Spacing.sm)

            Button("pro.deactivate", role: .destructive) {
                Task { await upgradeManager.deactivate() }
            }
            .buttonStyle(.plain)
            .font(DS.Font.caption)
            #endif
        }
        .padding(DS.Spacing.lg)
        .background(DS.Colors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
    }
}

// MARK: - Feature Row

private struct FeatureRow: View {
    let icon: String
    let titleKey: LocalizedStringKey
    let color: Color

    var body: some View {
        HStack(spacing: DS.Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 28, height: 28)
                .background(color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

            Text(titleKey)
                .font(DS.Font.body)

            Spacer()
        }
        .padding(.horizontal, DS.Spacing.md)
        .padding(.vertical, 10)
    }
}

// MARK: - Active Feature Row

private struct ActiveFeatureRow: View {
    let icon: String
    let titleKey: LocalizedStringKey

    var body: some View {
        HStack(spacing: DS.Spacing.md) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 16))
                .foregroundStyle(DS.Colors.success)

            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(DS.Colors.secondary)
                .frame(width: 24)

            Text(titleKey)
                .font(DS.Font.bodyMedium)

            Spacer()
        }
    }
}
